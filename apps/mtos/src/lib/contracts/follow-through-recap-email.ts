import { sanitizeAgendaEmailHtml } from "@/src/lib/contracts/agenda-email";
import {
  approvedItems,
  itemTitle,
  type FollowThroughItem,
} from "@/src/lib/contracts/follow-through-tickets";
import type { ClientAction, NotesDraft } from "@/src/lib/contracts/follow-through-notes";

/**
 * The recap email: the one thing the client reads in our words after the call.
 *
 * Same design as the agenda email that went out before it -- same palette, same tables, same
 * inline styles -- because the pair should look like two halves of one conversation rather than
 * two systems. The structure is different: the agenda promises, this one reports.
 *
 * What it will not do:
 *
 *  - **Promise work nobody approved.** The numbered list is built from approved tickets only. An
 *    item the AM denied is not in the email, because the email is the commitment.
 *  - **Invent a ship date.** A win with no date ships without one rather than with a guess, and a
 *    commitment with no due date is reported as a gap instead of being quietly written as "soon".
 *  - **Use our words for their work.** The internal ticket title goes in the ticket; the email
 *    gets the client-facing line, which the AM can rewrite. Where there is no separate wording
 *    the ticket's own title is used, because a blank line is worse.
 */

const BLUE = "#1A73E8";
const NAVY = "#0D1B2A";
const BODY = "#444444";
const HAIR = "#C8D8F0";
const PALE = "#E8F0FD";
const ACCENT_BAR = "#2979FF";
const GREEN = "#0E9F6E";

function esc(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeUrl(value: string): string {
  return /^https:\/\//i.test(value.trim()) ? value.trim() : "";
}

// ---------------------------------------------------------------------------
// What goes in it
// ---------------------------------------------------------------------------

export interface RecapWin {
  /** What we shipped, in the client's terms. */
  what: string;
  /** When it shipped. Empty is allowed; a guessed date is not. */
  shipped: string;
}

export interface RecapCommitment {
  /** What we will do, in the client's terms. */
  what: string;
  /** When they will have it. */
  due: string;
}

export interface RecapAsk {
  what: string;
  due: string;
  tentative?: boolean;
}

export interface RecapEmailFacts {
  businessName: string;
  contactFirstName: string;
  /** `Fri, 2 November` -- the call we are recapping. */
  metLabel: string;
  /** The next monthly touch, or empty when none is booked yet. */
  nextCheckInLabel: string;
  nextCheckInUrl: string;
  /** The quarterly goal in one line, for the facts row and the closing line. */
  goalLabel: string;
  intro: string;
  wins: RecapWin[];
  commitments: RecapCommitment[];
  asks: RecapAsk[];
  /** "Just reply to this email", or whatever channel this client actually uses. */
  followUpChannel: string;
  signoff: string[];
  logoUrl: string;
}

export interface RecapEmailDraft {
  subject: string;
  html: string;
  facts: RecapEmailFacts;
  /** What the AM has to fix before this can be sent. */
  blockingGaps: string[];
}

// ---------------------------------------------------------------------------
// Building it from the notes and the approved tickets
// ---------------------------------------------------------------------------

export interface RecapEmailSource {
  businessName: string;
  contactName: string;
  metLabel: string;
  nextCheckInLabel: string;
  nextCheckInUrl: string;
  signoff: string;
  accountManagerName: string;
  appUrl?: string;
  /** Wins since the last touch, with the dates they actually shipped. */
  wins?: RecapWin[];
  followUpChannel?: string;
}

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] || "";
}

/** The client-facing line for an approved item: its own wording, else the ticket's title. */
function clientLine(item: FollowThroughItem): string {
  return item.formType === "billing" ? item.details.trim() || itemTitle(item) : item.taskName.trim();
}

/**
 * Build the recap from what was actually decided.
 *
 * Commitments come from approved items only, and from nothing else: not from the notes' action
 * lines, which may include things the AM denied, and not from the transcript, which includes
 * things that were discussed and dropped.
 */
export function buildRecapEmailDraft(
  source: RecapEmailSource,
  notes: NotesDraft,
  items: FollowThroughItem[],
): RecapEmailDraft {
  const gaps: string[] = [];

  const approved = approvedItems(items);
  const commitments: RecapCommitment[] = approved.map((item) => ({
    what: clientLine(item),
    due: (item.formType === "billing" ? item.dueDate : item.dueDate) || "",
  }));

  const undated = commitments.filter((commitment) => !commitment.due).length;
  if (undated) {
    gaps.push(
      `${undated === 1 ? "One approved item has" : `${undated} approved items have`} no date, so the email would promise work without saying when. Set the due dates on the tickets.`,
    );
  }

  const asks: RecapAsk[] = notes.clientActions.map((action: ClientAction) => ({
    what: action.what.trim(),
    due: action.due.trim(),
    ...(action.tentative ? { tentative: true } : {}),
  }));

  const signoff = source.signoff
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!signoff.length) {
    const fallback = [source.accountManagerName, "Map Ranking"].filter(Boolean);
    if (fallback.length > 1) {
      signoff.push("Talk soon,", ...fallback);
    } else {
      gaps.push(
        "There is no sign-off on your profile and MTOS does not know your name, so the email would end unsigned. Set your sign-off in Settings.",
      );
    }
  }

  if (!notes.summary.trim()) {
    gaps.push("The notes have no summary, so there is nothing to open the email with.");
  }

  const logoUrl = source.appUrl?.startsWith("https://")
    ? `${source.appUrl.replace(/\/+$/, "")}/brand/mapranking-mark.png`
    : "";

  const facts: RecapEmailFacts = {
    businessName: source.businessName,
    contactFirstName: firstName(source.contactName),
    metLabel: source.metLabel,
    nextCheckInLabel: source.nextCheckInLabel,
    nextCheckInUrl: source.nextCheckInUrl,
    goalLabel: notes.goalText.trim(),
    intro: notes.summary.trim(),
    wins: (source.wins || []).filter((win) => win.what.trim()),
    commitments: commitments.filter((commitment) => commitment.what),
    asks: asks.filter((ask) => ask.what),
    followUpChannel: source.followUpChannel?.trim() || "Just reply to this email and it comes straight to me.",
    signoff,
    logoUrl,
  };

  return {
    subject: `Recap of our check-in${source.metLabel ? ` — ${source.metLabel}` : ""}`,
    html: buildRecapEmailHtml(facts),
    facts,
    blockingGaps: gaps,
  };
}

// ---------------------------------------------------------------------------
// The HTML
// ---------------------------------------------------------------------------

function headerBlock(facts: RecapEmailFacts): string {
  const mark = facts.logoUrl
    ? `<td style="vertical-align:middle;padding-right:12px"><img src="${esc(facts.logoUrl)}" alt="Map Ranking" width="34" height="39" style="display:block;border:0"></td>`
    : "";

  const row = [
    facts.metLabel ? ["🤝 Met", facts.metLabel] : undefined,
    facts.nextCheckInLabel ? ["🗓️ Next check-in", facts.nextCheckInLabel] : undefined,
    facts.goalLabel ? ["🎯 Goal", facts.goalLabel] : undefined,
  ].filter(Boolean) as string[][];

  return [
    `<div style="position:relative;padding:26px 30px 24px;background:#ffffff;overflow:hidden">`,
    `<div style="position:absolute;right:-70px;top:-90px;width:230px;height:230px;border-radius:50%;background:#7EB8FF;opacity:0.22"></div>`,
    `<div style="position:absolute;right:40px;bottom:-120px;width:200px;height:200px;border-radius:50%;background:#A0C4FF;opacity:0.3"></div>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;position:relative"><tr>${mark}<td style="vertical-align:middle;font-size:21px;font-weight:700;letter-spacing:0.3px;color:${NAVY}">MapRanking</td></tr></table>`,
    `<div style="position:relative;margin-top:26px;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:700;color:${GREEN}">✅ Monthly check-in recap</div>`,
    `<div style="position:relative;margin-top:8px;font-size:28px;line-height:1.15;font-weight:700;color:${NAVY}">Here&#39;s where we landed, ${esc(facts.businessName)}</div>`,
    row.length
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;position:relative;margin-top:16px"><tr>${row
          .map(
            ([label, value], index) =>
              `<td style="${index < row.length - 1 ? "padding-right:26px;" : ""}vertical-align:top"><div style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;font-weight:700;color:${BODY}">${esc(label)}</div><div style="font-size:15px;font-weight:700;color:${NAVY};margin-top:2px">${esc(value)}</div></td>`,
          )
          .join("")}</tr></table>`
      : "",
    `</div>`,
  ].join("");
}

function winsBlock(wins: RecapWin[]): string {
  if (!wins.length) return "";
  const rows = wins
    .map(
      (win) =>
        `<tr><td style="padding:7px 0;vertical-align:top;width:26px;color:${GREEN};font-size:16px">✓</td>` +
        `<td style="padding:7px 0;vertical-align:top;border-bottom:1px solid ${HAIR}">` +
        `<span style="font-weight:700;color:${NAVY};font-size:15px">${esc(win.what)}</span>` +
        // No date is left blank rather than filled with "recently": a shipped-on date the client
        // can check is the whole value of this block.
        (win.shipped ? `<span style="color:${BODY};font-size:14px"> — shipped ${esc(win.shipped)}</span>` : "") +
        `</td></tr>`,
    )
    .join("");

  return [
    `<div style="font-size:12px;letter-spacing:1.6px;text-transform:uppercase;font-weight:700;color:${GREEN};padding-bottom:6px;border-bottom:2px solid ${HAIR};margin-top:18px">What we shipped since last time</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:4px">${rows}</table>`,
  ].join("");
}

function commitmentsBlock(commitments: RecapCommitment[]): string {
  if (!commitments.length) return "";
  const rows = commitments
    .map(
      (commitment, index) =>
        `<tr><td style="padding:9px 0;vertical-align:middle;width:52px"><div style="width:38px;height:38px;border-radius:38px;background:${BLUE};color:#ffffff;text-align:center;line-height:38px;font-size:17px;font-weight:700">${index + 1}</div></td>` +
        `<td style="padding:9px 0;vertical-align:middle;border-bottom:1px solid ${HAIR}">` +
        `<div style="font-weight:700;color:${NAVY};font-size:16px">${esc(commitment.what)}</div>` +
        (commitment.due ? `<div style="color:${BODY};font-size:14px;margin-top:2px">By ${esc(commitment.due)}</div>` : "") +
        `</td></tr>`,
    )
    .join("");

  return [
    `<div style="font-size:12px;letter-spacing:1.6px;text-transform:uppercase;font-weight:700;color:${BLUE};padding-bottom:6px;border-bottom:2px solid ${HAIR};margin-top:22px">What Map Ranking will do</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:4px">${rows}</table>`,
  ].join("");
}

function asksBlock(asks: RecapAsk[]): string {
  if (!asks.length) return "";
  const items = asks
    .map(
      (ask) =>
        `<li style="margin:4px 0"><span style="font-weight:700;color:${NAVY}">${esc(ask.what)}</span>` +
        (ask.due ? `<span style="color:${BODY}"> — by ${esc(ask.due)}${ask.tentative ? " (we said roughly)" : ""}</span>` : "") +
        `</li>`,
    )
    .join("");

  return [
    `<div style="margin:22px 0;border-left:5px solid ${ACCENT_BAR};background:${PALE};border-radius:0 12px 12px 0;padding:14px 18px">`,
    `<div style="font-weight:700;color:${NAVY}">📋 What we need from you</div>`,
    `<ul style="margin:8px 0 0;padding-left:20px;color:${BODY}">${items}</ul>`,
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

/** The whole recap, as a client's inbox receives it. */
export function buildRecapEmailHtml(facts: RecapEmailFacts): string {
  const greeting = facts.contactFirstName ? `Hi ${esc(facts.contactFirstName)} 👋` : "Hi 👋";
  const bookUrl = safeUrl(facts.nextCheckInUrl);

  return [
    `<div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid ${HAIR};border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:${NAVY};font-size:15px;line-height:1.55">`,
    `<div style="height:8px;background:${GREEN}"></div>`,
    headerBlock(facts),
    `<div style="padding:4px 30px 8px">`,
    `<p style="margin:18px 0 6px">${greeting}</p>`,
    facts.intro ? `<p style="margin:0 0 14px;color:${BODY}">${esc(facts.intro)}</p>` : "",
    winsBlock(facts.wins),
    commitmentsBlock(facts.commitments),
    asksBlock(facts.asks),
    facts.goalLabel
      ? `<p style="margin:18px 0 0;color:${BODY}">All of it points at the same thing: <span style="font-weight:700;color:${NAVY}">${esc(facts.goalLabel)}</span>.</p>`
      : "",
    bookUrl
      ? `<div style="text-align:center;margin:24px 0 20px"><a href="${esc(bookUrl)}" style="display:inline-block;padding:14px 30px;border-radius:10px;background:${BLUE};color:#ffffff;font-weight:700;text-decoration:none;font-size:16px">🗓️ ${facts.nextCheckInLabel ? `Next check-in · ${esc(facts.nextCheckInLabel)}` : "Book the next check-in"}</a></div>`
      : facts.nextCheckInLabel
        ? `<p style="margin:18px 0 0;color:${BODY}">Next check-in: <span style="font-weight:700;color:${NAVY}">${esc(facts.nextCheckInLabel)}</span>.</p>`
        : "",
    `<p style="margin:16px 0 0;color:${BODY}">${esc(facts.followUpChannel)}</p>`,
    facts.signoff.length
      ? `<p style="margin:16px 0 22px">${facts.signoff.map(esc).join("<br>")}</p>`
      : `<div style="height:22px"></div>`,
    `</div>`,
    footerBlock(facts.logoUrl),
    `</div>`,
  ].join("");
}

/**
 * Clean the HTML coming back from the editor.
 *
 * The agenda email's sanitiser, reused rather than copied: both emails go through the same
 * editor into the same mail clients, and two sanitisers would eventually disagree about what is
 * safe -- at which point one of them is wrong.
 */
export const sanitizeRecapEmailHtml = sanitizeAgendaEmailHtml;

/** True when there is enough text here to be worth sending. */
export function recapEmailHasBody(html: string): boolean {
  return (
    sanitizeRecapEmailHtml(html)
      .replace(/<[^>]*>/g, "")
      .replace(/&[a-z]+;|&#\d+;/gi, " ")
      .trim().length > 40
  );
}

export type RecapDecision = "approved" | "denied" | "deleted";

export interface RecapEmailState {
  subject: string;
  html: string;
  decision?: RecapDecision;
  /** True once the AM has edited the body, so a rebuild warns before replacing it. */
  edited?: boolean;
  sentAt?: string;
}

/** What is stopping the recap being approved. */
export function recapBlockers(state: RecapEmailState | undefined, gaps: string[]): string[] {
  const blockers: string[] = [...gaps];
  if (!state) {
    blockers.push("Build the recap email.");
    return blockers;
  }
  if (!state.decision) {
    blockers.push("Decide the recap email — approve it, or deny it if you would rather write your own.");
  }
  if (state.decision === "approved") {
    if (!state.subject.trim()) blockers.push("The recap email has no subject line.");
    if (!recapEmailHasBody(state.html)) blockers.push("The recap email has almost nothing in it.");
  }
  return blockers;
}
