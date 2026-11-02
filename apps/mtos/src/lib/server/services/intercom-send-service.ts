import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getIntegrationConnection, getIntegrationCredentials } from "@/src/lib/server/integrations";
import { findContactIds, intercomPost } from "@/src/lib/server/services/intercom-service";

/**
 * Sending the client-facing agenda email through the account manager's own Intercom.
 *
 * Intercom rather than Gmail, because that is where the account managers actually answer client
 * email: a thread started in Intercom comes back to the Intercom inbox, and a reply to a Gmail send
 * lands somewhere nobody is watching. The handoff asks for it from `support@mapranking.com`
 * **through the AM's own Intercom seat**, which is exactly what `from: {type: "admin", id}` does --
 * the shared address goes out, the AM owns the conversation, and the reply reaches them.
 *
 * Three things this deliberately does not do.
 *
 * It does not send without a stated recipient, and it never derives an address from the business
 * name. An agenda that reaches a stranger is worse than one the AM has to address by hand.
 *
 * It does not pretend when a permission is missing. The Intercom app in a tenant may have been
 * installed with read permissions only; Intercom then refuses with a 403 and this reports which
 * permission to grant, leaving the draft intact and sendable later. Nothing is marked sent.
 *
 * It does not retry blind. Intercom's message endpoint takes no idempotency key, so the guard is
 * the conversation id stored on the touch: a send is refused outright when one is already there.
 * That is checked by the caller before this is reached and again here, because the cost of being
 * wrong is a second email in a client's inbox.
 */

const INTERCOM_API_VERSION_NOTE =
  "The connected Intercom app needs the \"Write conversations\" permission (sometimes shown as \"Send messages\"). Change it in Intercom, then reconnect Intercom in MTOS Settings → Integrations.";

export type IntercomSendOutcome =
  | {
      sent: true;
      conversationId: string;
      /** `Intercom (jordan@mapranking.com)` -- who the client sees it come from. */
      sentVia: string;
      detail: string;
    }
  | {
      sent: false;
      /** Plain English: what stopped it, and what the AM should do now. */
      detail: string;
      /** True when sending it by hand is the right next move rather than retrying. */
      sendItYourself: boolean;
    };

interface IntercomAdmin {
  id: string;
  email: string;
  name: string;
}

/**
 * The AM's own Intercom seat.
 *
 * Matched on the email address they signed in to MTOS with, because that is the only identifier
 * the two systems share. An AM with no Intercom seat is a real situation -- a new hire, or an AM
 * whose Intercom address differs from their Google one -- and it is reported as such rather than
 * silently falling back to whichever admin the token belongs to. Sending as somebody else would
 * route the client's reply to the wrong person's inbox, which is the one thing this is for.
 */
async function findAdminByEmail(
  token: string,
  email: string,
): Promise<{ admin: IntercomAdmin } | { error: string }> {
  try {
    const response = await fetch("https://api.intercom.io/admins", {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "Intercom-Version": "2.11",
      },
    });
    if (!response.ok) {
      if (response.status === 403) {
        return {
          error:
            "Intercom refused to list the team (403). The connected Intercom app needs the \"Read admins\" permission so MTOS can send as you rather than as the app.",
        };
      }
      return { error: `Intercom returned ${response.status} when listing the team.` };
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const rows = Array.isArray(payload.admins) ? (payload.admins as Record<string, unknown>[]) : [];
    const wanted = email.trim().toLowerCase();
    const match = rows.find((row) => String(row.email || "").trim().toLowerCase() === wanted);
    if (!match) {
      return {
        error: `No Intercom seat is registered to ${email}, so MTOS cannot send as you. Ask whoever administers Intercom to add you, or send the agenda from Intercom yourself.`,
      };
    }
    return {
      admin: {
        id: String(match.id || ""),
        email: String(match.email || ""),
        name: String(match.name || "").trim(),
      },
    };
  } catch (error) {
    return {
      error: `Intercom could not be reached: ${error instanceof Error ? error.message : "unknown error"}.`,
    };
  }
}

export interface SendAgendaEmailOptions {
  /** The address the AM signed in with, used to find their Intercom seat. */
  accountManagerEmail: string;
  recipient: string;
  /** Other client-side attendees to copy, when the AM's preference says to. */
  cc?: string[];
  subject: string;
  /** The branded HTML, already sanitized by the caller. */
  html: string;
  /** Non-empty refuses the send outright: this email already went out. */
  existingConversationId?: string;
}

/**
 * Deliver the agenda. Never throws, and never reports `sent` without a conversation id from
 * Intercom -- the id is what makes a retry safe, so a send we cannot identify is not a send.
 */
export async function sendAgendaEmailViaIntercom(
  context: TenantContext,
  options: SendAgendaEmailOptions,
): Promise<IntercomSendOutcome> {
  if (options.existingConversationId) {
    return {
      sent: false,
      sendItYourself: false,
      detail:
        "This agenda email already went out once, so nothing was sent again. Open the conversation in Intercom to see what the client received.",
    };
  }

  const recipient = options.recipient.trim();
  if (!recipient) {
    return {
      sent: false,
      sendItYourself: true,
      detail:
        "There is no client address on this touch, so there was nothing to send to. Type the address you use for this client, then approve again.",
    };
  }

  const connection = await getIntegrationConnection(context, "intercom").catch(() => undefined);
  if (!connection || connection.status !== "connected") {
    return {
      sent: false,
      sendItYourself: true,
      detail:
        "Intercom is not connected in MTOS, so MTOS has no way to send this. Send the agenda from Intercom yourself — the draft below is the email.",
    };
  }

  const token = getIntegrationCredentials(connection).accessToken;
  if (!token) {
    return {
      sent: false,
      sendItYourself: false,
      detail: "The Intercom connection has no usable token. Reconnect Intercom in Settings → Integrations, then approve again.",
    };
  }

  if (!options.accountManagerEmail.trim()) {
    return {
      sent: false,
      sendItYourself: true,
      detail:
        "MTOS does not know which email address you sign in with, so it cannot send as you. Send the agenda from Intercom yourself so the client's reply reaches your inbox.",
    };
  }

  const sender = await findAdminByEmail(token, options.accountManagerEmail);
  if ("error" in sender) {
    return { sent: false, sendItYourself: true, detail: sender.error };
  }

  // The contact id when Intercom already knows this address, the address itself when it does not.
  // Intercom matches or creates the contact in the second case, which is what happens when an AM
  // emails a new client from the Intercom inbox by hand -- the same record, made the same way.
  const contacts = await findContactIds(token, recipient);
  const to =
    "ids" in contacts && contacts.ids.length
      ? { type: "user", id: contacts.ids[0] }
      : { type: "user", email: recipient };

  const result = await intercomPost(token, "/messages", {
    message_type: "email",
    subject: options.subject,
    body: options.html,
    // `personal` is the branded-but-from-a-person template; `plain` strips the styling this email
    // exists for.
    template: "personal",
    from: { type: "admin", id: sender.admin.id },
    to,
  });

  if ("error" in result) {
    const detail = /403/.test(result.error) ? `${result.error} ${INTERCOM_API_VERSION_NOTE}` : result.error;
    return { sent: false, sendItYourself: true, detail };
  }

  const conversationId = String(result.payload.conversation_id || result.payload.id || "").trim();
  if (!conversationId) {
    return {
      sent: false,
      sendItYourself: false,
      detail:
        "Intercom accepted the message but returned no conversation id, so MTOS cannot prove what was sent or stop a second send. Check your Intercom inbox: if the client has it, press \"I sent this myself\".",
    };
  }

  const ccNote = options.cc?.length
    ? ` Intercom does not carry a cc, so ${options.cc.join(", ")} ${options.cc.length === 1 ? "was" : "were"} not copied — forward it to them if they need it.`
    : "";

  return {
    sent: true,
    conversationId,
    sentVia: `Intercom (${sender.admin.email})`,
    detail: `Sent to ${recipient} from support@mapranking.com through your Intercom seat. The reply comes back to your Intercom inbox.${ccNote}`,
  };
}
