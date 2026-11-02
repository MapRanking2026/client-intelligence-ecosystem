import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getIntegrationConnection, getIntegrationCredentials } from "@/src/lib/server/integrations";

/**
 * Reading a client's Intercom conversations.
 *
 * Intercom is the shared inbox the account managers actually answer client email in -- mail sent
 * through Hiver shows up there and never reaches the support@ Gmail mailbox. The preparation
 * requirements therefore make Intercom the FIRST place to look before saying anything about whether
 * an email was sent, received, or left unanswered; Gmail is the second. Until this service existed
 * MTOS could not check it at all, so every preparation had to carry the caveat that a missing email
 * was not a finding.
 *
 * The read is deliberately narrow and live, not a synced snapshot: the question is always "what
 * happened with THIS client in the last N days", which a tenant-wide nightly snapshot answers badly.
 * Nothing here writes to Intercom, replies to anyone, or marks a conversation read.
 */

const INTERCOM_API = "https://api.intercom.io";

/** Pinned so a change to Intercom's default version can't silently reshape the response. */
const INTERCOM_VERSION = "2.11";

type JsonRecord = Record<string, unknown>;

/** One conversation, reduced to what the preparation document actually quotes. */
export interface IntercomConversationSummary {
  id: string;
  url: string;
  title: string;
  /** "us" when an account manager opened it, "client" when the client wrote in first. */
  startedBy: "us" | "client" | "unknown";
  createdAt?: string;
  lastAdminReplyAt?: string;
  lastClientReplyAt?: string;
  /** True when the client wrote after our last reply -- an unanswered thread. */
  awaitingUs: boolean;
  state: string;
}

/**
 * The outcome of looking in Intercom for one client.
 *
 * `status` separates the three facts the requirements insist on keeping apart: we read the inbox,
 * we could not read the inbox, or we have no address to look the client up by. Only `checked`
 * licenses a statement about what is or isn't in the inbox.
 */
export interface IntercomInboxRead {
  status: "checked" | "not_connected" | "no_client_address" | "failed";
  /** Plain English, written for the account manager and quotable in the prep document. */
  detail: string;
  /** How the client was found, so the AM can tell a strong match from a weak one. */
  matchedBy?: "contact_email" | "conversation_search";
  conversations: IntercomConversationSummary[];
  /** Conversations where the client is still waiting on us. */
  awaitingUsCount: number;
  /** The window that was searched, so "nothing found" has a stated scope. */
  windowStart?: string;
  windowDays?: number;
}

function unixToIso(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return new Date(value * 1000).toISOString();
}

/**
 * One POST to Intercom, with the permission errors turned into something an AM can act on.
 *
 * Exported because sending the agenda email needs the same error handling as reading the inbox:
 * a 403 from a shared Intercom app always means a missing permission on the app, and saying which
 * one beats a status code twice over.
 */
export async function intercomPost(
  token: string,
  path: string,
  body: JsonRecord,
): Promise<{ payload: JsonRecord } | { error: string }> {
  try {
    const response = await fetch(`${INTERCOM_API}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "content-type": "application/json",
        "Intercom-Version": INTERCOM_VERSION,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = (await response.text()).slice(0, 300);
      // 403 is the common one: the Intercom app was installed without the permission this read
      // needs. Saying which permission beats a bare status code the AM can do nothing with.
      if (response.status === 403) {
        return {
          error:
            "Intercom refused the read (403). The connected Intercom app needs the \"Read conversations\" and \"Read users and companies\" permissions — change them in Intercom, then reconnect Intercom in MTOS.",
        };
      }
      if (response.status === 401) {
        return {
          error: "Intercom rejected the connection (401). Reconnect Intercom in MTOS Settings → Integrations.",
        };
      }
      return { error: `Intercom returned ${response.status}: ${text}` };
    }
    return { payload: (await response.json()) as JsonRecord };
  } catch (error) {
    return {
      error: error instanceof Error ? `Intercom could not be reached: ${error.message}` : "Intercom could not be reached.",
    };
  }
}

/** Contact ids for an email address. Empty means Intercom has no contact with that address. */
export async function findContactIds(token: string, email: string): Promise<{ ids: string[] } | { error: string }> {
  const result = await intercomPost(token, "/contacts/search", {
    query: { field: "email", operator: "=", value: email },
    pagination: { per_page: 25 },
  });
  if ("error" in result) return result;
  const data = Array.isArray(result.payload.data) ? (result.payload.data as JsonRecord[]) : [];
  return { ids: data.map((row) => String(row.id || "")).filter(Boolean) };
}

function summarizeConversation(row: JsonRecord): IntercomConversationSummary {
  const source = (row.source || {}) as JsonRecord;
  const author = (source.author || {}) as JsonRecord;
  const statistics = (row.statistics || {}) as JsonRecord;
  const authorType = String(author.type || "").toLowerCase();
  const lastAdminReplyAt = unixToIso(statistics.last_admin_reply_at);
  const lastClientReplyAt = unixToIso(statistics.last_contact_reply_at);

  return {
    id: String(row.id || ""),
    url: `https://app.intercom.com/a/inbox/_/inbox/conversation/${String(row.id || "")}`,
    title: String(source.subject || row.title || "").trim() || "(no subject)",
    startedBy: authorType === "admin" ? "us" : authorType === "user" || authorType === "lead" ? "client" : "unknown",
    createdAt: unixToIso(row.created_at),
    lastAdminReplyAt,
    lastClientReplyAt,
    // Only a real comparison counts. A thread the client started and we never replied to is also
    // awaiting us, which is why a missing admin reply with a present client reply qualifies.
    awaitingUs: Boolean(lastClientReplyAt && (!lastAdminReplyAt || lastClientReplyAt > lastAdminReplyAt)),
    state: typeof row.state === "string" && row.state ? row.state : row.open === true ? "open" : "closed",
  };
}

async function searchConversations(
  token: string,
  query: JsonRecord,
): Promise<{ conversations: IntercomConversationSummary[] } | { error: string }> {
  const result = await intercomPost(token, "/conversations/search", {
    query,
    pagination: { per_page: 50 },
  });
  if ("error" in result) return result;
  const data = Array.isArray(result.payload.conversations)
    ? (result.payload.conversations as JsonRecord[])
    : Array.isArray(result.payload.data)
      ? (result.payload.data as JsonRecord[])
      : [];
  return { conversations: data.map(summarizeConversation).filter((row) => row.id) };
}

export interface ReadClientInboxOptions {
  clientName: string;
  /** The client's email, traced from a real source. Without it the lookup is a weak name match. */
  clientEmail?: string;
  /** How far back to look. The preparation window is the month since the last touch. */
  windowDays?: number;
}

/**
 * What Intercom holds for one client over the recent window.
 *
 * Never throws: a preparation run must not fail because a shared inbox was unreachable, and the
 * difference between "we looked and found nothing" and "we could not look" is carried in `status`
 * so the document can state which one is true.
 */
export async function readClientInbox(
  context: TenantContext,
  options: ReadClientInboxOptions,
): Promise<IntercomInboxRead> {
  const windowDays = options.windowDays ?? 45;
  const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const base = { conversations: [], awaitingUsCount: 0, windowStart, windowDays };

  const connection = await getIntegrationConnection(context, "intercom").catch(() => undefined);
  if (!connection || connection.status !== "connected") {
    return {
      ...base,
      status: "not_connected",
      detail:
        "Intercom is not connected in MTOS, so the shared client inbox was not checked. Check it by hand before saying an email was or was not sent.",
    };
  }

  const token = getIntegrationCredentials(connection).accessToken;
  if (!token) {
    return {
      ...base,
      status: "not_connected",
      detail:
        "The Intercom connection has no usable token, so the shared client inbox was not checked. Reconnect Intercom in Settings → Integrations.",
    };
  }

  const createdSince = Math.floor(new Date(windowStart).getTime() / 1000);

  // The strong path: find the client's contact record by email, then every conversation that
  // contact is part of. This is what makes "no email was sent to this client" a real finding.
  if (options.clientEmail) {
    const contacts = await findContactIds(token, options.clientEmail);
    if ("error" in contacts) {
      return { ...base, status: "failed", detail: contacts.error };
    }
    if (contacts.ids.length) {
      const found = await searchConversations(token, {
        operator: "AND",
        value: [
          { field: "contact_ids", operator: "IN", value: contacts.ids },
          { field: "created_at", operator: ">", value: createdSince },
        ],
      });
      if ("error" in found) {
        return { ...base, status: "failed", detail: found.error };
      }
      const awaitingUsCount = found.conversations.filter((row) => row.awaitingUs).length;
      return {
        status: "checked",
        matchedBy: "contact_email",
        conversations: found.conversations,
        awaitingUsCount,
        windowStart,
        windowDays,
        detail: found.conversations.length
          ? `The Intercom shared inbox was read for ${options.clientEmail}: ${found.conversations.length} conversation${found.conversations.length === 1 ? "" : "s"} in the last ${windowDays} days${awaitingUsCount ? `, ${awaitingUsCount} still waiting on us` : ", none waiting on us"}.`
          : `The Intercom shared inbox was read for ${options.clientEmail} and has no conversation in the last ${windowDays} days. This is a real finding: no email went through Intercom in that window.`,
      };
    }
    // An address we hold that Intercom has never seen is itself worth knowing -- it usually means
    // the client writes from a different address than the one on the ClickUp record.
    return {
      ...base,
      status: "checked",
      matchedBy: "contact_email",
      detail: `Intercom has no contact for ${options.clientEmail}, so there is no conversation history under that address. The client may write from a different address — check the inbox by hand before saying nothing was sent.`,
    };
  }

  // The weak path: no address on file, so the business name is all there is. Reported as the weak
  // match it is, because a name that doesn't appear in a subject line proves nothing.
  const byName = await searchConversations(token, {
    operator: "AND",
    value: [
      { field: "source.subject", operator: "~", value: options.clientName },
      { field: "created_at", operator: ">", value: createdSince },
    ],
  });
  if ("error" in byName) {
    return { ...base, status: "failed", detail: byName.error };
  }
  if (!byName.conversations.length) {
    return {
      ...base,
      status: "no_client_address",
      detail: `MTOS has no email address on file for ${options.clientName}, so Intercom could only be searched by business name, and that found nothing. That is not evidence either way — look the client up in Intercom by hand.`,
    };
  }
  return {
    status: "checked",
    matchedBy: "conversation_search",
    conversations: byName.conversations,
    awaitingUsCount: byName.conversations.filter((row) => row.awaitingUs).length,
    windowStart,
    windowDays,
    detail: `MTOS has no email address on file for ${options.clientName}, so Intercom was searched by business name: ${byName.conversations.length} conversation${byName.conversations.length === 1 ? "" : "s"} matched in the last ${windowDays} days. A name match can miss threads, so treat this as partial.`,
  };
}
