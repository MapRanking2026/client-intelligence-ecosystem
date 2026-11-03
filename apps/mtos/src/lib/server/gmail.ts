import type { TenantContext } from "@/src/lib/contracts/mtos";
import {
  getIntegrationConnection,
  getIntegrationCredentials,
  getMissingIntegrationScopes,
} from "@/src/lib/server/integrations";

/**
 * Sending plain-text mail through the AM's own Gmail connection.
 *
 * Lifted out of the confirmation-email stage, which had the only Gmail send path in the codebase,
 * so the notification digests can use it without a second copy of the RFC822 encoding and the
 * scope check. The encoding function is the same one that stage has always used.
 *
 * Nothing here is client-facing. The confirmation email keeps its own send, with its own record of
 * generated / approved / sent, because what MTOS tells a client is not a thing to make generic.
 */

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export function encodeRfc822(from: string, to: string, subject: string, body: string): string {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
  ].join("\r\n");
  const raw = `${headers}\r\n\r\n${body}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

export interface GmailSendOutcome {
  sent: boolean;
  /** How it went, in words an AM can act on. Written on success and on failure alike. */
  detail: string;
  /** The address it went out from, when it went. */
  sentVia?: string;
}

/**
 * Deliver one plain-text message, or say exactly why it could not be delivered.
 *
 * Never throws. Every caller is either a cron or a background step, and a notification that cannot
 * be emailed must leave an honest reason behind rather than take the run down -- the four reasons
 * are each distinct and each has a different fix.
 */
export async function sendGmailText(
  context: TenantContext,
  message: { to: string; subject: string; body: string },
): Promise<GmailSendOutcome> {
  const recipient = message.to.trim();
  if (!recipient) {
    return { sent: false, detail: "No address to send to." };
  }

  const connection = await getIntegrationConnection(context, "gmail").catch(() => undefined);
  if (!connection || connection.status !== "connected") {
    return { sent: false, detail: "Gmail is not connected in MTOS, so nothing was emailed." };
  }

  const missing = getMissingIntegrationScopes("gmail", connection);
  if (missing.includes(GMAIL_SEND_SCOPE) || !(connection.scopes || []).includes(GMAIL_SEND_SCOPE)) {
    return {
      sent: false,
      detail:
        "Your Gmail connection can read mail but not send it, so nothing was emailed. Reconnect Gmail in Settings → Integrations to grant sending.",
    };
  }

  const token = getIntegrationCredentials(connection).accessToken;
  if (!token) {
    return {
      sent: false,
      detail: "The Gmail connection has no usable access token, so nothing was emailed. Reconnect Gmail in Settings.",
    };
  }

  const from = connection.externalAccountId || "me";
  try {
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ raw: encodeRfc822(from, recipient, message.subject, message.body) }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      return { sent: false, detail: `Gmail refused the send (${response.status}): ${detail}` };
    }
    return { sent: true, detail: `Emailed to ${recipient}.`, sentVia: from };
  } catch (error) {
    return {
      sent: false,
      detail: `The send request failed: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}
