import { nanoid } from "nanoid";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { ConfirmationEmailState } from "@/src/lib/contracts/prep-workflow";
import type { ClientRecord, MonthlyTouchRecord } from "@/src/lib/mtos-data";
import { getServerEnv } from "@/src/lib/server/env";
import {
  getIntegrationConnection,
  getIntegrationCredentials,
  getMissingIntegrationScopes,
} from "@/src/lib/server/integrations";
import { callLlmForJson, getNowIso, hasAnyLlmProvider } from "@/src/lib/server/services/mtos-ai";

/**
 * Step 2 of the preparation workflow: the client confirmation email.
 *
 * It is deliberately its own stage. The original prompt sends the client-facing agenda 24-48 hours
 * before the call, built from the agenda the preparation actually produced -- so it cannot be
 * written before the account review, and it must not be folded into the same click as the
 * preparation notes or the ClickUp filing. An AM has to be able to read it, edit it and approve it
 * before a client sees anything.
 *
 * Three facts are kept apart here, because conflating them is how a system starts lying:
 *   - generated: MTOS wrote a draft.
 *   - approved: the AM read it and signed off on the wording.
 *   - sent: a transport confirmed delivery, or the AM says they sent it themselves.
 * Approving is never sending, and a failed send stays failed and retryable.
 */

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/** `Tue, Nov 5, 2026 at 2:00 PM PT` -- how the client reads it, in their own zone. */
function formatMeetingWhen(iso: string | undefined, timeZone: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  } catch {
    // An unknown zone string must not take the whole stage down; fall back and let the gap list say so.
    return new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "short" }).format(date);
  }
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** Addresses that belong to us, never to the client. */
function isInternalAddress(address: string): boolean {
  return /@(mapranking|maprankings)\./i.test(address);
}

/**
 * Find the client's email address in what we already hold.
 *
 * Only ever extracted from a real source -- the synced ClickUp record or the Client's Book pages
 * the prep read. Never assembled from the business name, because an invented address that bounces
 * (or worse, reaches a stranger) is far more damaging than an honest gap the AM fills in.
 */
export function resolveRecipient(
  client: ClientRecord,
  touch: MonthlyTouchRecord,
): { recipient: string; recipientSource: string } {
  const payload = client.rawPayload;
  if (payload) {
    const fields = Array.isArray((payload as Record<string, unknown>).custom_fields)
      ? ((payload as Record<string, unknown>).custom_fields as Record<string, unknown>[])
      : [];
    for (const field of fields) {
      const name = String(field.name ?? "").toLowerCase();
      const value = typeof field.value === "string" ? field.value : "";
      if (!value) continue;
      const match = value.match(EMAIL_PATTERN);
      if (match && (name.includes("email") || name.includes("contact")) && !isInternalAddress(match[0])) {
        return {
          recipient: match[0],
          recipientSource: `Taken from the "${String(field.name ?? "").trim()}" field on this client's ClickUp record.`,
        };
      }
    }
  }

  const bookPages = touch.prepPack?.clickupContext?.clientsBook ?? [];
  for (const page of bookPages) {
    const match = (page.content || "").match(EMAIL_PATTERN);
    if (match && !isInternalAddress(match[0])) {
      return {
        recipient: match[0],
        recipientSource: `Found on the "${page.pageName}" page of this client's Client's Book in ClickUp.`,
      };
    }
  }

  return {
    recipient: "",
    recipientSource:
      "No client email address is recorded on the ClickUp client record or in the Client's Book, so MTOS has none. Type the address you use for this client before sending.",
  };
}

/**
 * The channel the client prefers, when we know it.
 *
 * Stakeholder-map communication preference is captured in the post-meeting workflow, so for many
 * clients this is genuinely unknown -- and that is what it says, rather than defaulting to email
 * and implying we checked.
 */
function resolveChannel(client: ClientRecord, touch: MonthlyTouchRecord): string {
  const preference = touch.postMeeting?.clientIntelligence?.stakeholderMap?.communicationPreference;
  if (preference) return `${preference} (the preference recorded for this client)`;
  const notes = `${client.contextNotes || ""} ${client.sentiment || ""}`.toLowerCase();
  if (/whatsapp/.test(notes)) return "WhatsApp (mentioned in this client's notes — confirm before sending)";
  if (/\btext\b|\bsms\b/.test(notes)) return "Text (mentioned in this client's notes — confirm before sending)";
  return "Email — no channel preference is recorded for this client, so this is the default, not a confirmed choice";
}

/**
 * The time zone the meeting time is stated in.
 *
 * MTOS has no client time-zone field, so this is the Map Ranking working zone until the AM sets it.
 * It is labelled as that rather than presented as the client's zone: a confirmation email that
 * states the wrong hour is the one mistake this step exists to prevent.
 */
function resolveTimeZone(override?: string): { timeZone: string; timeZoneSource: string } {
  if (override?.trim()) {
    return { timeZone: override.trim(), timeZoneSource: "Set by the account manager for this client." };
  }
  return {
    timeZone: "America/Los_Angeles",
    timeZoneSource:
      "Map Ranking's working time zone. MTOS has no time zone on file for this client — check it is the client's zone before sending.",
  };
}

export interface GenerateConfirmationEmailOptions {
  /** The AM can set the client's real zone; it is carried into the stated meeting time. */
  timeZone?: string;
  /** The AM can supply the address when MTOS has none on file. */
  recipient?: string;
}

/**
 * Write the draft from the agenda the account review finalized.
 *
 * The agenda comes from the research stage's snapshot, not from the live touch, so regenerating the
 * draft cannot quietly promise the client a different meeting than the one the preparation planned.
 */
export async function generateConfirmationEmail(
  touch: MonthlyTouchRecord,
  client: ClientRecord,
  options: GenerateConfirmationEmailOptions = {},
): Promise<ConfirmationEmailState> {
  const generatedAt = getNowIso();
  const env = getServerEnv();
  const { timeZone, timeZoneSource } = resolveTimeZone(options.timeZone);
  const scheduledAt = touch.scheduledAt || touch.prepPack?.schedule.scheduledAt;
  const meetingWhen = formatMeetingWhen(scheduledAt, timeZone);
  const resolved = resolveRecipient(client, touch);
  const recipient = options.recipient?.trim() || resolved.recipient;
  const recipientSource = options.recipient?.trim()
    ? "Entered by the account manager."
    : resolved.recipientSource;
  const channel = resolveChannel(client, touch);

  const agenda = touch.prepWorkflow?.research?.agenda?.length
    ? touch.prepWorkflow.research.agenda
    : touch.agenda;

  const gaps: string[] = [];
  if (!recipient) gaps.push("No client email address. Add the address you use for this client.");
  if (meetingWhen === "—") {
    gaps.push(
      "This touch has no scheduled date and time, so the email cannot state when the call is. Set the meeting time first.",
    );
  }
  if (!options.timeZone) {
    gaps.push(
      "The meeting time is stated in Map Ranking's time zone. Confirm the client's zone, or set it, before sending.",
    );
  }

  const base: Omit<ConfirmationEmailState, "subject" | "body" | "model" | "provider"> = {
    channel,
    recipient,
    recipientSource,
    timeZone,
    timeZoneSource,
    meetingWhen,
    status: "draft",
    generatedAt,
    deliveryAttempts: 0,
    // One key per draft. Approving keeps it; regenerating mints a new one, because a rewritten
    // email is a different message and must not inherit the old one's delivery record.
    idempotencyKey: `confirm-${touch.id}-${nanoid(10)}`,
    gaps,
  };

  if (!hasAnyLlmProvider(env)) {
    // Still produce something the AM can edit and send: a deterministic agenda note from the real
    // agenda. Nothing here is invented -- every line comes from the preparation.
    return {
      ...base,
      subject: `Agenda for our check-in — ${meetingWhen}`,
      body: [
        `Hi ${client.contact || "there"},`,
        "",
        `Looking forward to our check-in on ${meetingWhen}. Here is what I would like to cover:`,
        "",
        ...agenda.slice(0, 5).map((item) => `- ${item}`),
        "",
        "If you can, bring your number of calls, booked jobs and approximate revenue this month — it helps us set the right goal for next quarter.",
        "",
        "Talk soon,",
        client.accountManager || "",
      ]
        .filter((line) => line !== undefined)
        .join("\n"),
      gaps: [
        ...gaps,
        "No AI provider is configured, so this is a plain draft built from the agenda. Read it and edit it before you approve it.",
      ],
    };
  }

  const system = [
    "You write the client-facing agenda email an Account Manager at Map Ranking sends 24 to 48 hours before a Monthly Touch call.",
    "",
    "RULES",
    "It is client-facing. No internal notes, no scores, no ticket identifiers, no coaching or retention wording, nothing sensitive, and never any password or login code.",
    "Short, warm, plainly written. Three to five outcome-focused items the client cares about: results, what we are working on, what we need from them, the next 30 days.",
    "State the meeting date and time exactly as given to you. Do not reword, recalculate or convert it, and never invent a meeting link, a duration or a phone number.",
    "Include one ask: their number of calls, booked jobs and approximate revenue this month, because it sets the goal for next quarter.",
    "Only promise what the agenda you were given actually covers. Do not add agenda items.",
    "If a detail is missing, leave it out rather than inventing it. Do not write a placeholder like [link] into send-ready wording.",
    "",
    "OUTPUT",
    'Return a single JSON object and nothing else: {"subject": "...", "body": "..."}',
    "The body is plain text with line breaks, ready to paste into an email. No markdown, no asterisks, no headings.",
  ].join("\n");

  const userText = [
    `Client business: ${client.name}`,
    `Client contact: ${client.contact || "unknown — open with a neutral greeting"}`,
    `Industry: ${client.industry}`,
    `Account manager (signs the email): ${client.accountManager || "unknown — leave the signature off"}`,
    `Meeting date and time, exactly as you must state it: ${meetingWhen}`,
    `Channel this will be sent through: ${channel}`,
    "",
    "The agenda the preparation produced (the email must reflect these and nothing more):",
    ...agenda.map((item) => `- ${item}`),
    "",
    "What the client cares about most, from the account review:",
    ...(touch.prepPack?.focusAreas ?? []).map((item) => `- ${item}`),
    "",
    "Things we need from the client (pending items):",
    ...(touch.prepPack?.openCommitments ?? [])
      .filter((item) => item.category === "Client")
      .map((item) => `- ${item.title} (due ${item.dueDate})`),
  ].join("\n");

  try {
    const { data, model, provider } = await callLlmForJson({
      env,
      system,
      userText,
      maxTokens: 1200,
      temperature: 0.4,
    });
    const subject = typeof data.subject === "string" ? data.subject.trim() : "";
    const body = typeof data.body === "string" ? data.body.trim() : "";
    if (!subject || !body) {
      throw new Error("the model returned an empty subject or body");
    }
    return { ...base, subject, body, model, provider };
  } catch (error) {
    return {
      ...base,
      subject: `Agenda for our check-in — ${meetingWhen}`,
      body: [
        `Hi ${client.contact || "there"},`,
        "",
        `Looking forward to our check-in on ${meetingWhen}. Here is what I would like to cover:`,
        "",
        ...agenda.slice(0, 5).map((item) => `- ${item}`),
        "",
        "If you can, bring your number of calls, booked jobs and approximate revenue this month — it helps us set the right goal for next quarter.",
        "",
        "Talk soon,",
        client.accountManager || "",
      ].join("\n"),
      status: "draft",
      gaps: [
        ...gaps,
        `The AI draft failed (${error instanceof Error ? error.message : "unknown error"}), so this is a plain draft built from the agenda. Read it and edit it before you approve it.`,
      ],
    };
  }
}

export interface SendConfirmationEmailResult {
  email: ConfirmationEmailState;
  /** True only when a transport confirmed the message left. */
  sent: boolean;
  /** What the AM should do next when it did not send. */
  message: string;
}

function encodeRfc822(from: string, to: string, subject: string, body: string): string {
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

/**
 * Try to deliver the approved email.
 *
 * Gmail is connected with a read-only scope in every tenant that has not re-consented since the
 * send scope was added, so for most AMs this reports honestly that MTOS cannot send and hands the
 * work back -- it does not pretend. The alternative considered was dropping the send button
 * entirely, but then nothing would ever record that the client was actually told, and the stage
 * after this one depends on knowing.
 *
 * Retries are safe: a draft that already reached `sent` is returned unchanged rather than sent
 * again, and one attempt per approved draft is all the idempotency key allows.
 */
export async function sendConfirmationEmail(
  context: TenantContext,
  email: ConfirmationEmailState,
): Promise<SendConfirmationEmailResult> {
  if (email.status === "sent" || email.status === "sent_manually") {
    return {
      email,
      sent: true,
      message: "This email was already sent, so nothing was sent again.",
    };
  }

  if (email.status !== "approved" && email.status !== "failed") {
    return {
      email,
      sent: false,
      message: "This email has not been approved yet. Read it, edit anything that does not fit, then approve it.",
    };
  }

  if (!email.recipient) {
    const failed: ConfirmationEmailState = {
      ...email,
      status: "failed",
      lastError: "There is no recipient address, so there was nothing to send to.",
      deliveryAttempts: email.deliveryAttempts,
    };
    return {
      email: failed,
      sent: false,
      message: "Add the client's email address, then send again.",
    };
  }

  const connection = await getIntegrationConnection(context, "gmail");
  const attempts = email.deliveryAttempts + 1;

  if (!connection || connection.status !== "connected") {
    return {
      email: {
        ...email,
        status: "failed",
        deliveryAttempts: attempts,
        lastError: "Gmail is not connected in MTOS, so MTOS has no way to send this email.",
      },
      sent: false,
      message:
        "Gmail is not connected, so MTOS could not send this. Send it yourself from your usual inbox, then press \"I sent this myself\" so the record is accurate.",
    };
  }

  const missingScopes = getMissingIntegrationScopes("gmail", connection);
  if (missingScopes.includes(GMAIL_SEND_SCOPE) || !(connection.scopes || []).includes(GMAIL_SEND_SCOPE)) {
    return {
      email: {
        ...email,
        status: "failed",
        deliveryAttempts: attempts,
        lastError:
          "The Gmail connection was authorized for reading only, so Google refuses a send on it. Reconnect Gmail in Settings to grant permission to send.",
      },
      sent: false,
      message:
        "Your Gmail connection can read mail but not send it. Reconnect Gmail in Settings → Integrations to grant sending, or send the email yourself and press \"I sent this myself\".",
    };
  }

  const token = getIntegrationCredentials(connection).accessToken;
  if (!token) {
    return {
      email: {
        ...email,
        status: "failed",
        deliveryAttempts: attempts,
        lastError: "The Gmail connection has no usable access token. Reconnect Gmail in Settings.",
      },
      sent: false,
      message: "Reconnect Gmail in Settings → Integrations, then send again.",
    };
  }

  const from = connection.externalAccountId || "me";
  try {
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        raw: encodeRfc822(from, email.recipient, email.subject, email.body),
      }),
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      return {
        email: {
          ...email,
          status: "failed",
          deliveryAttempts: attempts,
          lastError: `Gmail refused the send (${response.status}): ${detail}`,
        },
        sent: false,
        message: "Gmail refused the send. The error is recorded above — fix it and send again, or send it yourself.",
      };
    }

    return {
      email: {
        ...email,
        status: "sent",
        sentAt: getNowIso(),
        sentVia: `Gmail (${from})`,
        deliveryAttempts: attempts,
        lastError: undefined,
      },
      sent: true,
      message: `Sent to ${email.recipient}.`,
    };
  } catch (error) {
    return {
      email: {
        ...email,
        status: "failed",
        deliveryAttempts: attempts,
        lastError: `The send request failed: ${error instanceof Error ? error.message : "unknown error"}`,
      },
      sent: false,
      message: "The send request failed. Try again, or send it yourself and press \"I sent this myself\".",
    };
  }
}
