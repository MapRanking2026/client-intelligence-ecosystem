import { createHash, randomUUID } from "node:crypto";
import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getIntegrationConnection, getIntegrationCredentials, refreshIntegration } from "@/src/lib/server/integrations";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { userIntegrationConnectionPath } from "@/src/lib/server/firebase/collections";
import { htmlToMarkdown, markdownToPlainText } from "@/src/lib/contracts/rich-text";

/** Temporary application-wide sender. Hiver uses this Gmail send-as identity. */
export const SUPPORT_EMAIL = "support@mapranking.com";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const SEND = "https://www.googleapis.com/auth/gmail.send";
const READ = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.modify", "https://mail.google.com/"];
const address = (value: string) => /^[^\s@,;<>\r\n]+@[^\s@,;<>\r\n]+\.[^\s@,;<>\r\n]+$/.test(value);
const headerAddress = (value: string) => (value.match(/<([^<>]+)>/)?.[1] || value).trim().toLowerCase();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const base64 = (value: string) => Buffer.from(value, "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") || "";

export interface GmailMessage { to: string; cc?: string[]; subject: string; body?: string; html?: string; idempotencyKey?: string }
export type GmailSendOutcome = { sent: true; detail: string; sentVia: string; messageId: string; threadId?: string; rfcMessageId: string; mailbox: string }
  | { sent: false; detail: string; deliveryUncertain?: boolean };
type Receipt = Extract<GmailSendOutcome, { sent: true }>;
interface MailRecord { status: "sending" | "sent" | "failed" | "unknown"; fingerprint: string; rfcMessageId: string; to: string; subject: string; updatedAt: string; outcome?: Receipt }

export function encodeGmailMessage(message: GmailMessage, rfcMessageId: string, fingerprint: string): string {
  if (!address(message.to) || message.cc?.some((item) => !address(item)) || /[\r\n]/.test(message.subject) || /[\r\n]/.test(rfcMessageId)) throw new Error("Invalid email address or subject.");
  const headers = [`From: ${SUPPORT_EMAIL}`, `Reply-To: ${SUPPORT_EMAIL}`, `To: ${message.to}`,
    ...(message.cc?.length ? [`Cc: ${message.cc.join(", ")}`] : []),
    `Subject: =?UTF-8?B?${Buffer.from(message.subject, "utf8").toString("base64")}?=`, `Message-ID: ${rfcMessageId}`, `X-MTOS-Content-Hash: ${fingerprint}`, "MIME-Version: 1.0"];
  const text = message.body ?? markdownToPlainText(htmlToMarkdown(message.html || ""));
  let content: string;
  if (message.html !== undefined) {
    const boundary = `mtos_${fingerprint}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    content = [`--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", base64(text),
      `--${boundary}`, 'Content-Type: text/html; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", base64(message.html), `--${boundary}--`, ""].join("\r\n");
  } else { headers.push('Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64"); content = base64(text); }
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${content}`, "utf8").toString("base64url");
}

export function encodeRfc822(from: string, to: string, subject: string, body: string): string {
  if (from !== SUPPORT_EMAIL) throw new Error(`MTOS temporarily sends only from ${SUPPORT_EMAIL}.`);
  return encodeGmailMessage({ to, subject, body }, `<${randomUUID()}@mapranking.com>`, hash(body));
}

async function gmailAccount(context: TenantContext) {
  if (!context.userId || ["unknown", "system-cron"].includes(context.userId)) throw new Error("Sign in and connect your own Gmail account in Settings → Integrations.");
  let connection = await getIntegrationConnection(context, "gmail");
  if (!connection || connection.status !== "connected") throw new Error("Connect your Gmail account in Settings → Integrations. MTOS temporarily sends all email through Gmail.");
  const scopes = new Set(connection.scopes || []);
  if (![SEND, "https://www.googleapis.com/auth/gmail.modify", "https://mail.google.com/"].some((scope) => scopes.has(scope))) throw new Error("Reconnect Gmail in Settings → Integrations to grant sending permission.");
  if (!READ.some((scope) => scopes.has(scope))) throw new Error("Reconnect Gmail to grant inbox access so MTOS can verify your shared sender and reconcile sent messages.");
  if (connection.tokenExpiresAt && Date.parse(connection.tokenExpiresAt) <= Date.now() + 60000) { await refreshIntegration(context, "gmail"); connection = await getIntegrationConnection(context, "gmail"); }
  let token = getIntegrationCredentials(connection).accessToken;
  if (!token) throw new Error("Reconnect Gmail: your account has no usable access token.");
  async function request(path: string, init?: RequestInit) {
    const execute = () => fetch(`${API}${path}`, { ...init, cache: "no-store", signal: AbortSignal.timeout(30000), headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });
    let result = await execute();
    // Only a definite authentication refusal retries. A network/5xx POST is ambiguous.
    if (result.status === 401) {
      await refreshIntegration(context, "gmail"); token = getIntegrationCredentials(await getIntegrationConnection(context, "gmail")).accessToken;
      if (!token) throw new Error("Reconnect Gmail: the token could not be refreshed.");
      result = await execute();
    }
    return result;
  }
  const response = await request("/settings/sendAs");
  if (!response.ok) throw new Error(`Gmail could not verify your shared sender (${response.status}). Reconnect Gmail and check Settings → Accounts → Send mail as.`);
  const { sendAs = [] } = await response.json() as { sendAs?: { sendAsEmail: string; isPrimary?: boolean; verificationStatus?: string }[] };
  const sender = sendAs.find((item) => item.sendAsEmail.toLowerCase() === SUPPORT_EMAIL);
  if (!sender || (!sender.isPrimary && sender.verificationStatus !== "accepted")) throw new Error(`Set up and verify ${SUPPORT_EMAIL} under Gmail Settings → Accounts → Send mail as (Hiver shared-inbox sender). MTOS will not send from your personal address instead.`);
  const mailbox = sendAs.find((item) => item.isPrimary)?.sendAsEmail;
  if (!mailbox) throw new Error("Gmail did not identify the connected mailbox. Reconnect Gmail before sending.");
  return { request, mailbox };
}

function mailRef(context: TenantContext, key: string) {
  const db = getFirebaseAdminDb();
  if (!db) throw new Error("MTOS storage is unavailable; email was not sent because its delivery record cannot be saved safely.");
  return { db, ref: db.doc(`${userIntegrationConnectionPath(context.tenantId, context.userId, "gmail")}/outboundEmails/${hash(key)}`) };
}

async function reconcile(account: Awaited<ReturnType<typeof gmailAccount>>, record: MailRecord): Promise<Receipt | undefined> {
  const query = new URLSearchParams({ q: `in:sent rfc822msgid:${record.rfcMessageId}`, maxResults: "2" });
  const response = await account.request(`/messages?${query}`);
  if (!response.ok) throw new Error(`Gmail sent-mail lookup failed (${response.status}). Check Sent before retrying.`);
  const { messages = [] } = await response.json() as { messages?: { id: string }[] };
  if (!messages.length) return undefined;
  if (messages.length !== 1) throw new Error("Multiple matching sent messages were found. Check Gmail Sent before proceeding.");
  const result = await account.request(`/messages/${encodeURIComponent(messages[0].id)}?format=metadata`);
  if (!result.ok) throw new Error(`Gmail could not verify the sent message (${result.status}).`);
  const message = await result.json() as { id?: string; threadId?: string; labelIds?: string[]; payload?: { headers?: { name: string; value: string }[] } };
  const header = (name: string) => message.payload?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value || "";
  if (!message.id || !message.labelIds?.includes("SENT") || header("Message-ID") !== record.rfcMessageId || header("X-MTOS-Content-Hash") !== record.fingerprint || headerAddress(header("From")) !== SUPPORT_EMAIL || headerAddress(header("To")) !== record.to.toLowerCase()) throw new Error("The sent message did not match this approved email. Delivery remains unresolved.");
  return { sent: true, messageId: message.id, ...(message.threadId ? { threadId: message.threadId } : {}), mailbox: account.mailbox, rfcMessageId: record.rfcMessageId,
    sentVia: `Gmail (${account.mailbox}; From ${SUPPORT_EMAIL})`, detail: "Verified the existing sent message in Gmail. No additional email was sent." };
}

export async function verifyGmailMessageAccepted(context: TenantContext, key: string) {
  const { ref } = mailRef(context, key);
  const record = (await ref.get()).data() as MailRecord | undefined;
  if (!record) throw new Error("No Gmail delivery attempt is recorded for this email. Review Gmail Sent and the previous transport before taking further action.");
  if (record.status === "sent" && record.outcome) return record.outcome;
  const outcome = await reconcile(await gmailAccount(context), record);
  if (!outcome) throw new Error("Gmail has not returned a matching sent email. Delivery is still unresolved; do not blindly resend.");
  await ref.update({ status: "sent", outcome, updatedAt: new Date().toISOString() }); return outcome;
}

export async function sendGmailMessage(context: TenantContext, message: GmailMessage): Promise<GmailSendOutcome> {
  let remoteStarted = false;
  let unresolved = false;
  let ref: ReturnType<typeof mailRef>["ref"] | undefined;
  try {
    const to = message.to.trim(), cc = [...new Set((message.cc || []).map((item) => item.trim()).filter(Boolean))];
    if (!address(to) || cc.some((item) => !address(item)) || !message.subject.trim() || /[\r\n]/.test(message.subject) || !(message.html || message.body)?.trim()) throw new Error("Provide a valid recipient, subject and email body before sending.");
    const fingerprint = hash(JSON.stringify({ to, cc, subject: message.subject, body: message.body || "", html: message.html || "" }));
    const key = message.idempotencyKey || `text:${new Date().toISOString().slice(0, 10)}:${fingerprint}`;
    const storage = mailRef(context, key); ref = storage.ref;
    const rfcMessageId = `<mtos.${hash(`${context.tenantId}:${context.userId}:${key}`)}@mapranking.com>`;
    const raw = encodeGmailMessage({ ...message, to, cc }, rfcMessageId, fingerprint);
    const account = await gmailAccount(context);
    const existing = await storage.db.runTransaction(async (tx) => {
      const current = (await tx.get(storage.ref)).data() as MailRecord | undefined;
      if (current && current.status !== "failed") {
        if (current.fingerprint !== fingerprint) throw new Error("An earlier version of this email was sent or has unresolved delivery. Check Gmail Sent before changing and resending it.");
        return current;
      }
      tx.set(storage.ref, { status: "sending", fingerprint, rfcMessageId, to, subject: message.subject, updatedAt: new Date().toISOString() } satisfies MailRecord);
      return undefined;
    });
    if (existing) {
      if (existing.status === "sent" && existing.outcome) return { ...existing.outcome, detail: "This email was already accepted by Gmail. Nothing was sent again." };
      unresolved = true;
      const found = await reconcile(account, existing);
      if (found) { await ref.update({ status: "sent", outcome: found, updatedAt: new Date().toISOString() }); return found; }
      return { sent: false, deliveryUncertain: true, detail: "An earlier Gmail send is still unresolved. Check Gmail Sent or use Check existing email; no duplicate was sent." };
    }
    remoteStarted = true;
    const response = await account.request("/messages/send", { method: "POST", body: JSON.stringify({ raw }) });
    const payload = await response.json().catch(() => ({})) as { id?: string; threadId?: string; error?: { message?: string } };
    if (!response.ok || !payload.id) {
      const uncertain = response.ok || response.status >= 500;
      await ref.update({ status: uncertain ? "unknown" : "failed", updatedAt: new Date().toISOString() });
      return { sent: false, ...(uncertain ? { deliveryUncertain: true } : {}), detail: `Gmail did not confirm sending (${response.status}). ${payload.error?.message?.slice(0, 250) || "Check Gmail Sent before retrying if delivery is uncertain."}` };
    }
    const outcome: Receipt = { sent: true, messageId: payload.id, ...(payload.threadId ? { threadId: payload.threadId } : {}), rfcMessageId, mailbox: account.mailbox,
      sentVia: `Gmail (${account.mailbox}; From ${SUPPORT_EMAIL})`, detail: `Gmail accepted the email to ${to} from ${SUPPORT_EMAIL}${cc.length ? `, copying ${cc.join(", ")}` : ""}. Inbox delivery and Hiver synchronization are not confirmed by this receipt.` };
    await ref.update({ status: "sent", outcome, updatedAt: new Date().toISOString() }); return outcome;
  } catch (error) {
    if (remoteStarted && ref) await ref.update({ status: "unknown", updatedAt: new Date().toISOString() }).catch(() => undefined);
    return { sent: false, ...(remoteStarted || unresolved ? { deliveryUncertain: true } : {}), detail: error instanceof Error ? error.message : "Gmail could not send this email." };
  }
}

export const sendGmailText = (context: TenantContext, message: { to: string; subject: string; body: string; idempotencyKey?: string }) => sendGmailMessage(context, message);
