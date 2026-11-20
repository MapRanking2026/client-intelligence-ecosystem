import { internalTaskText } from "@/src/lib/contracts/client-content";
import { clientZone } from "@/src/lib/contracts/client-time-zone";
import type { ClientAgendaEmail } from "@/src/lib/contracts/prep-brief";

/**
 * The client-facing agenda email: what it says, and the branded HTML a client's inbox receives.
 *
 * This is the only thing in the whole Monthly Touch that a client reads in our words before the
 * call, so three rules shape the file.
 *
 * **Every fact comes from a record.** The date, the time, the meeting link, the client's name and
 * the account manager's sign-off are read from the touch, the calendar event and the AM's profile.
 * Nothing here will invent a meeting link, a duration or a contact name -- a wrong hour in this
 * email is the single most expensive mistake the step can make, so a fact we do not hold becomes a
 * blocking gap rather than a plausible default.
 *
 * **The agenda items are the agent's, the decoration is ours.** The preparation writes between one
 * and five items as plain sentences. The numbered circles, the emoji and the split into a bold
 * line plus an explanation are presentation applied to those sentences; they add no claim. The
 * emoji is chosen from the item's own words and falls back to a neutral bullet, because an emoji
 * that misreads an item is noise, not a lie.
 *
 * **Table-based, inline-styled, no external CSS.** Gmail, Outlook and Apple Mail each throw away
 * something different from a modern layout; tables and inline styles are what all of them keep.
 * The one external reference is the logo, which has to be a public URL -- a `cid:` attachment or a
 * data URI is stripped or flagged by at least one of them.
 */

/** Map Ranking's client-facing palette, as the design hands it over. Not the app's tokens. */
const BLUE = "#1A73E8";
const NAVY = "#0D1B2A";
const BODY = "#444444";
const HAIR = "#C8D8F0";
const PALE = "#E8F0FD";
const ACCENT_BAR = "#2979FF";

export interface AgendaTopic {
  /** One short emoji, or an empty string when none fits. */
  emoji: string;
  /** The bold line. */
  title: string;
  /** The one-line explanation under it, or empty. */
  line: string;
}

export interface AgendaEmailFacts {
  /** The client's business, as the subject and title name it. */
  businessName: string;
  /** Who it is addressed to. Empty produces a neutral greeting rather than "Hi ,". */
  contactFirstName: string;
  /** `July 2026` -- the month of the call, for the eyebrow. */
  monthLabel: string;
  /** `Fri, July 3`. */
  dateLabel: string;
  /** `10:00 AM PT`. */
  timeLabel: string;
  /** `About 40 min`, or empty when no length is known. */
  lengthLabel: string;
  /** The line under the greeting. */
  intro: string;
  topics: AgendaTopic[];
  /** The one thing to bring, or empty to leave the box out. */
  ask: string;
  /** The Google Meet link. Empty leaves the button out rather than linking nowhere. */
  meetingUrl: string;
  /** The AM's sign-off, one line per line. */
  signoff: string[];
  /** The same sign-off with the formatting they gave it in Settings, ready to drop into the body. */
  signoffHtml?: string;
  /** Absolute https URL of the logo, or empty to render the wordmark as text only. */
  logoUrl: string;
}

/** HTML-escape. Applied to every interpolated value without exception. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Only an https link ever reaches a client's inbox from here. */
function safeUrl(value: string): string {
  const trimmed = value.trim();
  return /^https:\/\/[^\s"<>]+$/i.test(trimmed) ? trimmed : "";
}

const EMOJI_RULES: { pattern: RegExp; emoji: string }[] = [
  { pattern: /\b(results?|performance|ranks?|ranking|rankings|visibility|traffic|growth|months?)\b/i, emoji: "📈" },
  { pattern: /\b(fix|fixes|fixed|broken|forms?|website|bugs?|issues?|errors?)\b/i, emoji: "🛠️" },
  { pattern: /\b(calls?|phones?|answer|callbacks?|call-backs?|voicemails?)\b/i, emoji: "📞" },
  { pattern: /\b(ads?|campaigns?|budgets?|spend|google ads|meta)\b/i, emoji: "📍" },
  { pattern: /\b(goals?|targets?|quarters?|objectives?)\b/i, emoji: "🎯" },
  { pattern: /\b(next steps?|who does what|actions?|follow)\b/i, emoji: "✅" },
  { pattern: /\b(reviews?|reputation|ratings?)\b/i, emoji: "⭐" },
  { pattern: /\b(leads?|enquir|inquir|bookings?|booked|jobs?)\b/i, emoji: "📥" },
  { pattern: /\b(billing|invoices?|payments?|prices?|plans?)\b/i, emoji: "💳" },
];

/** A leading emoji the preparation already wrote, if there is one. */
const LEADING_EMOJI = /^(\p{Extended_Pictographic}(?:️)?(?:‍\p{Extended_Pictographic}(?:️)?)*)\s*/u;

/**
 * One agenda sentence turned into a topic row.
 *
 * The split is on an em or en dash, or a colon, which is how the preparation prompt asks for these
 * items ("Your June results — more patients calling you from Maps"). An item with no separator
 * becomes a bold line on its own: better a topic with no explanation than an explanation invented
 * by cutting a sentence in half.
 */
export function agendaTopic(item: string): AgendaTopic {
  let rest = item.trim();
  let emoji = "";
  const lead = rest.match(LEADING_EMOJI);
  if (lead) {
    emoji = lead[1];
    rest = rest.slice(lead[0].length).trim();
  }
  const separator = rest.match(/\s+[–—]\s+|:\s+/);
  const splits = Boolean(separator && separator.index !== undefined && separator.index > 0);
  const cut = splits ? (separator!.index as number) : 0;
  const title = splits ? rest.slice(0, cut).trim() : rest;
  const line = splits ? rest.slice(cut + separator![0].length).trim() : "";

  if (!emoji) {
    // The title is matched before the explanation, because the title is what the emoji stands for.
    // In "Billing - your plan changes in December" the topic is the billing; the word "plan"
    // further along the sentence must not pick the emoji instead.
    emoji =
      EMOJI_RULES.find((rule) => rule.pattern.test(title))?.emoji ||
      EMOJI_RULES.find((rule) => rule.pattern.test(line))?.emoji ||
      "";
  }

  return { emoji, title, line };
}

export interface AgendaEmailSourceFacts {
  businessName: string;
  contactName?: string;
  /** The scheduled start of the call, ISO. Absent is a blocking gap, never a guessed date. */
  scheduledAt?: string;
  /** The client's recorded IANA zone. An unknown client zone blocks sending. */
  timeZone?: string;
  /** True only when `timeZone` is recorded for this client; working/calendar zones are insufficient. */
  timeZoneIsClients: boolean;
  meetingUrl?: string;
  /** Planned call length in minutes, when the touch has one. */
  lengthMinutes?: number;
  /** The AM's sign-off from their preferences, newline-separated. */
  signoff?: string;
  accountManagerName?: string;
  /** Absolute https base URL of this deployment, for the logo. Empty is handled. */
  appUrl?: string;
}

export interface AgendaEmailDraft {
  subject: string;
  html: string;
  facts: AgendaEmailFacts;
  /**
   * What stops this being sent. Non-empty means the send is refused: send-ready wording with a
   * hole in it reaches the client, and the client is the one person who cannot check it.
   */
  blockingGaps: string[];
}

function formatInZone(iso: string, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, ...options }).format(date);
  } catch {
    // An unusable zone string must not take the draft down; the gap list says the zone is unknown.
    return "";
  }
}

function firstName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  // "Dr. Maya Brooks" -> "Dr. Brooks" is what an AM writes, so an honorific keeps the surname.
  const parts = trimmed.split(/\s+/);
  if (/^(dr|mr|mrs|ms|miss|prof)\.?$/i.test(parts[0]) && parts.length > 1) {
    return `${parts[0].replace(/\.?$/, ".")} ${parts[parts.length - 1]}`;
  }
  return parts[0];
}

/**
 * The draft, from the preparation's agenda email and the records behind the touch.
 *
 * Never throws and never fills a hole: each missing fact adds a sentence to `blockingGaps` saying
 * what to do about it, and the HTML simply leaves that piece out.
 */
export function buildAgendaEmailDraft(
  email: ClientAgendaEmail | undefined,
  source: AgendaEmailSourceFacts,
): AgendaEmailDraft {
  const gaps: string[] = [];
  const timeZone = source.timeZoneIsClients ? clientZone(source.timeZone) : undefined;
  if (!timeZone) gaps.push("Set the client's time zone before sending. The calendar or account manager's time zone is not a substitute.");

  const scheduled = source.scheduledAt && !Number.isNaN(new Date(source.scheduledAt).getTime())
    ? source.scheduledAt
    : "";
  if (!scheduled) {
    gaps.push(
      "This touch has no date and time, so the email cannot tell the client when the call is. Set the meeting time first.",
    );
  }

  const dateLabel = scheduled && timeZone
    ? formatInZone(scheduled, timeZone, { weekday: "short", month: "long", day: "numeric" })
    : "";
  const timeLabel = scheduled && timeZone
    ? formatInZone(scheduled, timeZone, { hour: "numeric", minute: "2-digit", timeZoneName: "short" })
    : "";
  const monthLabel = scheduled && timeZone
    ? formatInZone(scheduled, timeZone, { month: "long", year: "numeric" })
    : "";

  const items = email?.items?.filter((item) => item.trim() && !internalTaskText(item)) || [];
  if (!items.length) {
    gaps.push(
      "The preparation produced no agenda items for the client, so there is nothing to tell them you will cover. Re-run the preparation, or write the items yourself before sending.",
    );
  }

  const meetingUrl = safeUrl(source.meetingUrl || "");
  if (!meetingUrl) {
    gaps.push(
      "There is no Google Meet link on this touch, so the email has no join button. Pick the meeting in MTOS, or add the link yourself.",
    );
  }

  const lengthLabel = source.lengthMinutes
    ? `About ${source.lengthMinutes} min`
    : email?.length?.trim() || "";

  const signoff = emailSignatureLines(source.signoff, source.accountManagerName);
  if (!signoff.length) {
    gaps.push("Add your email signature in Settings or write a signature in the draft.");
  }

  const contactName = source.contactName?.trim() || "";
  const contactFirstName = /^(unknown|n\/?a|none|-)$/i.test(contactName) ? "" : firstName(contactName);
  const logoUrl = source.appUrl?.startsWith("https://")
    ? `${source.appUrl.replace(/\/+$/, "")}/brand/mapranking-mark.png`
    : "";

  const facts: AgendaEmailFacts = {
    businessName: source.businessName,
    contactFirstName,
    monthLabel,
    dateLabel,
    timeLabel,
    lengthLabel,
    intro: items.length
      ? `Looking forward to our check-in${dateLabel ? ` on ${dateLabel}` : ""}. Here's what we'll cover:`
      : "",
    topics: items.map(agendaTopic),
    ask: email?.ask && !internalTaskText(email.ask) ? email.ask.trim() : "",
    meetingUrl,
    signoff,
    signoffHtml: emailSignatureHtml(source.signoff, source.accountManagerName),
    logoUrl,
  };

  const subject = agendaSubjectInClientZone(email?.subject?.trim() || `Agenda for our check-in${facts.dateLabel ? ` — ${facts.dateLabel}` : ""}`, facts);

  return {
    subject,
    html: buildAgendaEmailHtml(facts),
    facts,
    // Prep output can be older than the current meeting or recipient. Validate current facts.
    blockingGaps: gaps,
  };
}

export function agendaSubjectInClientZone(subject: string, facts: AgendaEmailFacts): string {
  if (/\b\d{1,2}(?::\d{2})?\s*[ap]m\b|\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day|sday|nesday|rsday|urday)?\b/i.test(subject)) {
    return `Agenda for our check-in${facts.dateLabel ? ` — ${facts.dateLabel}` : ""}${facts.timeLabel ? ` · ${facts.timeLabel}` : ""}`;
  }
  return subject;
}

/** Synchronize app-owned schedule facts in saved templates without replacing the AM's prose. */
export function refreshAgendaSchedule(html: string, facts: AgendaEmailFacts): string {
  let updated = html.replace(/<p\b[^>]*data-mtos-field=["']meeting-summary["'][^>]*>[\s\S]*?<\/p>/gi, "");
  const values: [string, string][] = [["date", facts.dateLabel], ["time", facts.timeLabel], ["length", facts.lengthLabel]];
  let found = false;
  for (const [key, value] of values) {
    const marked = new RegExp(`(<div\\b[^>]*data-mtos-field=["']meeting-${key}["'][^>]*>)[\\s\\S]*?(<\\/div>)`, "gi");
    const legacy = new RegExp(`(<div\\b[^>]*>[^<]*\\b${key}\\s*<\\/div>\\s*<div\\b[^>]*>)[\\s\\S]*?(<\\/div>)`, "gi");
    updated = updated.replace(marked, (_, start: string, end: string) => { found = true; return `${start}${esc(value)}${end}`; });
    updated = updated.replace(legacy, (_, start: string, end: string) => { found = true; return `${start}${esc(value)}${end}`; });
  }
  const month = /(<div\b[^>]*>[^<]*Monthly check-in\s*·\s*)[^<]*(<\/div>)/gi;
  updated = updated.replace(month, `$1${esc(facts.monthLabel)}$2`);
  updated = updated.replace(/(<p\b[^>]*>)Looking forward to our check-in[\s\S]*?(<\/p>)/gi, `$1${esc(facts.intro)}$2`);
  if (!found && facts.timeLabel) updated = `<p data-mtos-field="meeting-summary"><strong>Meeting:</strong> ${esc(facts.dateLabel)} · ${esc(facts.timeLabel)}</p>${updated}`;
  return updated;
}

function headerBlock(facts: AgendaEmailFacts): string {
  const mark = facts.logoUrl
    ? `<td style="vertical-align:middle;padding-right:12px"><img src="${esc(facts.logoUrl)}" alt="Map Ranking" width="34" height="39" style="display:block;border:0"></td>`
    : "";
  const facts_row = [
    facts.dateLabel ? ["🗓️ Date", facts.dateLabel] : undefined,
    facts.timeLabel ? ["⏰ Time", facts.timeLabel] : undefined,
    facts.lengthLabel ? ["⏱️ Length", facts.lengthLabel] : undefined,
  ].filter(Boolean) as string[][];

  return [
    `<div style="position:relative;padding:26px 30px 24px;background:#ffffff;overflow:hidden">`,
    `<div style="position:absolute;right:-70px;top:-90px;width:230px;height:230px;border-radius:50%;background:#7EB8FF;opacity:0.22"></div>`,
    `<div style="position:absolute;right:40px;bottom:-120px;width:200px;height:200px;border-radius:50%;background:#A0C4FF;opacity:0.3"></div>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;position:relative"><tr>${mark}<td style="vertical-align:middle;font-size:21px;font-weight:700;letter-spacing:0.3px;color:${NAVY}">MapRanking</td></tr></table>`,
    facts.monthLabel
      ? `<div style="position:relative;margin-top:26px;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;color:${BLUE}">📅 Monthly check-in · ${esc(facts.monthLabel)}</div>`
      : "",
    `<div style="position:relative;margin-top:8px;font-size:28px;line-height:1.15;font-weight:700;color:${NAVY}">Your check-in agenda, ${esc(facts.businessName)}</div>`,
    facts_row.length
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;position:relative;margin-top:16px"><tr>${facts_row
          .map(
            ([label, value], index) =>
              `<td style="${index < facts_row.length - 1 ? "padding-right:26px;" : ""}vertical-align:top"><div style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;font-weight:700;color:${BODY}">${esc(label)}</div><div data-mtos-field="meeting-${/date/i.test(label) ? "date" : /time/i.test(label) ? "time" : "length"}" style="font-size:15px;font-weight:700;color:${NAVY};margin-top:2px">${esc(value)}</div></td>`,
          )
          .join("")}</tr></table>`
      : "",
    `</div>`,
  ].join("");
}

function topicsBlock(topics: AgendaTopic[]): string {
  if (!topics.length) return "";
  const rows = topics
    .map((topic, index) => {
      const heading = `${topic.emoji ? `${esc(topic.emoji)}&nbsp; ` : ""}${esc(topic.title)}`;
      return [
        `<tr>`,
        `<td style="padding:9px 0;vertical-align:middle;width:52px"><div style="width:38px;height:38px;border-radius:38px;background:${BLUE};color:#ffffff;text-align:center;line-height:38px;font-size:17px;font-weight:700">${index + 1}</div></td>`,
        `<td style="padding:9px 0;vertical-align:middle;border-bottom:1px solid ${HAIR}"><div style="font-weight:700;color:${NAVY};font-size:16px">${heading}</div>`,
        topic.line ? `<div style="color:${BODY};font-size:14px;margin-top:2px">${esc(topic.line)}</div>` : "",
        `</td></tr>`,
      ].join("");
    })
    .join("");

  return [
    `<div style="font-size:12px;letter-spacing:1.6px;text-transform:uppercase;font-weight:700;color:${BLUE};padding-bottom:6px;border-bottom:2px solid ${HAIR}">What we&#39;ll cover</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:4px">${rows}</table>`,
  ].join("");
}

/** The whole email body, as a client's inbox receives it. */
export function buildAgendaEmailHtml(facts: AgendaEmailFacts): string {
  const greeting = facts.contactFirstName ? `Hi ${esc(facts.contactFirstName)} 👋` : "Hi 👋";
  const joinUrl = safeUrl(facts.meetingUrl);

  return [
    `<div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid ${HAIR};border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:${NAVY};font-size:15px;line-height:1.55">`,
    `<div style="height:8px;background:${BLUE}"></div>`,
    headerBlock(facts),
    `<div style="padding:4px 30px 8px">`,
    `<p style="margin:18px 0 6px">${greeting}</p>`,
    facts.intro ? `<p style="margin:0 0 14px;color:${BODY}">${esc(facts.intro)}</p>` : "",
    topicsBlock(facts.topics),
    facts.ask
      ? `<div style="margin:22px 0;border-left:5px solid ${ACCENT_BAR};background:${PALE};border-radius:0 12px 12px 0;padding:14px 18px"><div style="font-weight:700;color:${NAVY}">📝 One thing to bring, if you can</div><div style="color:${BODY};margin-top:3px">${esc(facts.ask)}</div></div>`
      : "",
    joinUrl
      ? `<div style="text-align:center;margin:24px 0 20px"><a href="${esc(joinUrl)}" style="display:inline-block;padding:14px 30px;border-radius:10px;background:${BLUE};color:#ffffff;font-weight:700;text-decoration:none;font-size:16px">🎥 Join on Google Meet</a><div style="margin-top:8px;font-size:13px;color:${BODY}">${esc(joinUrl.replace(/^https:\/\//, ""))}</div></div>`
      : "",
    `<p style="margin:0;color:${BODY}">Anything else you&#39;d like to add? Just reply to this email 💬</p>`,
    facts.signoff.length
      ? `<p style="margin:16px 0 22px">${facts.signoffHtml || facts.signoff.map(esc).join("<br>")}</p>`
      : `<div style="height:22px"></div>`,
    `</div>`,
    footerBlock(facts.logoUrl),
    `</div>`,
  ].join("");
}

function footerBlock(logoUrl: string): string {
  const mark = logoUrl
    ? `<td style="padding-right:8px;vertical-align:middle"><span style="display:inline-block;background:#ffffff;border-radius:6px;padding:3px"><img src="${esc(logoUrl)}" alt="" width="16" height="18" style="display:block;border:0"></span></td>`
    : "";
  return [
    `<div style="background:${NAVY};color:#c9d4e3;padding:18px 30px;font-size:12px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>`,
    `<td style="vertical-align:middle"><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${mark}<td style="vertical-align:middle;font-size:14px;font-weight:700;color:#ffffff">MapRanking</td></tr></table></td>`,
    `<td style="vertical-align:middle;text-align:right"><a href="https://mapranking.com" style="color:#8FB8F6;text-decoration:none;font-weight:700">mapranking.com</a> &nbsp;·&nbsp; support@mapranking.com</td>`,
    `</tr></table></div>`,
  ].join("");
}

// ---------------------------------------------------------------------------
// What comes back out of the editor
// ---------------------------------------------------------------------------

const DANGEROUS_ELEMENTS = /<\s*\/?\s*(script|style|iframe|object|embed|link|meta|base|form|input|button|textarea|select|svg|math)\b[^>]*>/gi;
const EVENT_ATTRIBUTES = /\son[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const UNSAFE_HREF = /\s(?:href|src)\s*=\s*(?:"\s*(?!https?:|mailto:|cid:)[^"]*"|'\s*(?!https?:|mailto:|cid:)[^']*'|(?!["']|https?:|mailto:)[^\s>]+)/gi;

/**
 * Clean the HTML that comes back from the editor before it is stored or sent.
 *
 * The account manager wrote it, so this is not defence against an attacker with a keyboard. It is
 * defence against what lands in a `contentEditable` when someone pastes from a web page or a
 * document: scripts, tracking pixels with `javascript:` sources, stylesheet links, form fragments.
 * All of them are inert in a mail client and some of them get the whole message filed as spam, so
 * they are taken out on the way in rather than on the way out -- the stored draft is then the same
 * thing the client receives.
 *
 * Deliberately not a full HTML parser. A parser would also normalise the table markup that makes
 * this email render in Outlook, and the point of the inline-styled tables is that nothing
 * rewrites them.
 */
export function sanitizeAgendaEmailHtml(html: string): string {
  let out = String(html || "");
  // Element removal first: an `onerror` inside a `<script>` body should not be matched separately.
  out = out.replace(/<script\b[\s\S]*?<\/script\s*>/gi, "");
  out = out.replace(/<style\b[\s\S]*?<\/style\s*>/gi, "");
  out = out.replace(DANGEROUS_ELEMENTS, "");
  out = out.replace(EVENT_ATTRIBUTES, "");
  out = out.replace(UNSAFE_HREF, "");
  return out.trim();
}

/** True when there is enough text for this to be worth sending at all. */
export function agendaEmailHasBody(html: string): boolean {
  return sanitizeAgendaEmailHtml(html).replace(/<[^>]*>/g, "").replace(/&[a-z]+;|&#\d+;/gi, " ").trim().length > 40;
}

/**
 * What one attempt to send the client's agenda email did, as five distinct facts.
 *
 * `already_sent` is why this is not a boolean. The agenda can be sent from the review screen with
 * "Approve and Send" and is also sent by the one approval if it is still waiting, so both callers
 * have to be able to tell "I sent it" apart from "it was already gone". Intercom takes no
 * idempotency key on `POST /messages`, so the stored conversation id is the only thing standing
 * between the second press and a second agenda in a client's inbox.
 *
 * Here rather than in the service because the review screen renders `detail` verbatim.
 */
export type AgendaSendStatus = "sent" | "already_sent" | "declined" | "blocked" | "failed";

export interface AgendaSendOutcome {
  status: AgendaSendStatus;
  /** Plain English, written for the AM: what happened, or what to do about it not happening. */
  detail: string;
  sentVia?: string;
  sentAt?: string;
  /** True when MTOS cannot send at all and the AM should send it from their own inbox. */
  sendItYourself?: boolean;
}

/**
 * True when the saved signature was written in the formatted editor rather than typed flat.
 *
 * Matched against the tags that editor can actually produce rather than against "anything in
 * angle brackets": somebody typing "Best <regards>," is writing text, and treating it as markup
 * would hand a mail client an unknown tag, which renders as nothing -- the words would simply
 * vanish from the signature.
 */
const EDITOR_TAGS = /<\/?(?:b|strong|i|em|u|s|strike|span|div|br|p|ul|ol|li|a|font|h[1-6]|img)\b[^>]*>/i;

export function isFormattedSignature(signature?: string): boolean {
  return EDITOR_TAGS.test(signature || "");
}

/**
 * The signature as plain lines -- what a reader needs when it cannot show formatting.
 *
 * A formatted signature is reduced to its text here rather than refused: this is what answers
 * "is there a signature at all" for the blocking gaps, and what a plain-text digest prints. The
 * formatting itself is `emailSignatureHtml`'s job.
 */
export function emailSignatureLines(signature?: string, name?: string): string[] {
  const saved = signature || "";
  const flat = isFormattedSignature(saved)
    ? sanitizeAgendaEmailHtml(saved)
        .replace(/<\/(p|div|h[1-6]|li|tr)\s*>/gi, "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
    : saved;
  const lines = flat.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length) return lines;
  return name?.trim() ? ["Best regards,", name.trim(), "Map Ranking"] : [];
}

/**
 * The signature as it should appear in an email body.
 *
 * An AM who bolds their name in Settings means it to arrive bold. So a signature written in the
 * formatted editor is passed through the same sanitiser the email bodies use and kept as markup,
 * and one typed as flat lines is escaped and joined with breaks exactly as before -- the two
 * shapes produce the same thing for anyone who never opens the formatting toolbar.
 */
export function emailSignatureHtml(signature?: string, name?: string): string {
  if (isFormattedSignature(signature)) {
    const cleaned = sanitizeAgendaEmailHtml(signature || "").trim();
    if (cleaned) return cleaned;
  }
  return emailSignatureLines(signature, name).map(esc).join("<br>");
}

export function isAgendaRecipient(address: string): boolean {
  return /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(address.trim());
}
