import { knownContactName } from "@/src/lib/contracts/recap-contact";
import { emailSignatureLines, sanitizeAgendaEmailHtml } from "@/src/lib/contracts/agenda-email";
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

/**
 * One numbered section of the main body.
 *
 * The outline the AMs agreed on asks each discussed topic to answer four questions in order:
 * what was discussed, where the account stands, what we will focus on, and what the client should
 * see happen. Each field is optional below the first, because a topic that was only mentioned
 * gets one line rather than three invented ones.
 */
export interface RecapTopic {
  heading: string;
  /** What was discussed, reviewed or agreed. */
  discussed: string;
  /** The account observation, performance detail, challenge or opportunity behind it. */
  situation: string;
  /** What Map Ranking will focus on. */
  direction: string;
  /** What should happen next, in the client's terms. */
  outcome: string;
}

export interface RecapEmailFacts {
  businessName: string;
  contactFirstName: string;
  /** The numbered topics that make up the main body. */
  discussionTopics?: RecapTopic[];
  /** The client's own objectives and targets, as they stated them on the call. */
  goalTargets?: string[];
  meetingCommitments?: RecapCommitment[];
  meetingRequests?: RecapAsk[];
  next30Days?: RecapCommitment[];
  promisedInclusions?: { text: string; requiresReply: boolean; due?: string }[];
  nextMeetingAgreed?: boolean;

  /** `Fri, 2 November` -- the call we are recapping. */
  metLabel: string;
  /** The next monthly touch, or empty when none is booked yet. */
  nextCheckInLabel: string;
  nextCheckInUrl: string;
  /** The quarterly goal in one line, for the facts row and the closing line. */
  goalLabel: string;
  intro: string;
  highlights?: { title: string; detail: string }[];
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
  discussionTopics?: RecapTopic[];
  goalTargets?: string[];
  meetingCommitments?: RecapCommitment[];
  meetingRequests?: RecapAsk[];
  next30Days?: RecapCommitment[];
  promisedInclusions?: { text: string; requiresReply: boolean; due?: string }[];
  nextMeetingAgreed?: boolean;

  metLabel: string;
  nextCheckInLabel: string;
  nextCheckInUrl: string;
  signoff: string;
  accountManagerName: string;
  appUrl?: string;
  /** Wins since the last touch, with the dates they actually shipped. */
  wins?: RecapWin[];
  followUpChannel?: string;
  overview?: string;
  highlights?: { title: string; detail: string }[];
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

  const signoff = emailSignatureLines(source.signoff, source.accountManagerName);
  if (!signoff.length) gaps.push("Add your email signature in Settings.");

  if (!notes.summary.trim()) {
    gaps.push("The notes have no summary, so there is nothing to open the email with.");
  }

  const logoUrl = source.appUrl?.startsWith("https://")
    ? `${source.appUrl.replace(/\/+$/, "")}/brand/mapranking-mark.png`
    : "";

  const facts: RecapEmailFacts = {
    businessName: source.businessName,
    contactFirstName: firstName(knownContactName(source.contactName)),
    metLabel: source.metLabel,
    nextCheckInLabel: source.nextCheckInLabel,
    nextCheckInUrl: source.nextCheckInUrl,
    goalLabel: notes.goalText.trim(),
    intro: source.overview?.trim() || notes.summary.trim().split(/(?<=[.!?])\s+(?=[A-Z])/).slice(0, 3).join("\n\n"),
    highlights: source.highlights,
    discussionTopics: source.discussionTopics,
    goalTargets: source.goalTargets,
    meetingCommitments: source.meetingCommitments,
    meetingRequests: source.meetingRequests,
    next30Days: source.next30Days,
    promisedInclusions: source.promisedInclusions,
    nextMeetingAgreed: source.nextMeetingAgreed,
    wins: (source.wins || []).filter((win) => win.what.trim()),
    commitments: commitments.filter((commitment) => commitment.what),
    asks: asks.filter((ask) => ask.what),
    followUpChannel: source.followUpChannel?.trim() || (source.promisedInclusions?.some(item => item.requiresReply)
      ? "Please reply with your answers to the questions above. If you have any questions or concerns, include them in the same reply. Your email comes straight to me, and I’m happy to help."
      : source.meetingRequests?.length
        ? "Please reply with the information above, and include any questions or concerns in the same reply. Your email comes straight to me, and I’m happy to help."
        : "If you have any questions or concerns, please reply to this email. It comes straight to me, and I’m happy to help."),
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
    `<div style="font-size:12px;letter-spacing:1.6px;text-transform:uppercase;font-weight:700;color:${GREEN};padding-bottom:6px;border-bottom:2px solid ${HAIR};margin-top:18px">Completed work</div>`,
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
        (commitment.due ? `<div style="color:${BODY};font-size:14px;margin-top:2px">Agreed timing: ${esc(commitment.due)}</div>` : "") +
        `</td></tr>`,
    )
    .join("");

  return [
    `<div style="font-size:12px;letter-spacing:1.6px;text-transform:uppercase;font-weight:700;color:${BLUE};padding-bottom:6px;border-bottom:2px solid ${HAIR};margin-top:22px">A &middot; What you can expect from us</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:4px">${rows}</table>`,
  ].join("");
}

function asksBlock(asks: RecapAsk[]): string {
  if (!asks.length) return "";
  const items = asks
    .map(
      (ask) =>
        `<li style="margin:4px 0"><span style="font-weight:700;color:${NAVY}">${esc(ask.what)}</span>` +
        (ask.due ? `<span style="color:${BODY}"> — ${esc(ask.due)}${ask.tentative ? " (we said roughly)" : ""}</span>` : "") +
        `</li>`,
    )
    .join("");

  return [
    `<div style="margin:22px 0;border-left:5px solid ${ACCENT_BAR};background:${PALE};border-radius:0 12px 12px 0;padding:14px 18px">`,
    `<div style="font-weight:700;color:${NAVY}">📋 B &middot; What we need from you</div>`,
    `<ul style="margin:8px 0 0;padding-left:20px;color:${BODY}">${items}</ul>`,
    `</div>`,
  ].join("");
}

function next30DaysBlock(items: RecapCommitment[]): string {
  if (!items.length) return "";
  return '<div style="margin-top:22px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;color:' + BLUE + '">The next 30 days</div><ul style="padding-left:20px;color:' + BODY + '">' + items.map(item => '<li style="margin:8px 0">' + esc(item.what) + (item.due ? ' <strong>— ' + esc(item.due) + '</strong>' : '') + '</li>').join('') + '</ul>';
}

/**
 * What the AM promised to put in this email.
 *
 * Split in two because the two halves belong in different sections of the outline: the questions
 * the client has to answer sit with their goals, and anything else promised sits with the
 * conversation it came out of.
 */
function promisedInclusionsBlock(
  items: { text: string; requiresReply: boolean; due?: string }[],
  which: "questions" | "other",
): string {
  const values = items.filter((item) => (which === "questions" ? item.requiresReply : !item.requiresReply));
  if (!values.length) return "";
  const title = which === "questions" ? "Questions for your reply" : "As promised";
  return '<div style="margin:14px 0 22px;background:' + PALE + ';border-left:5px solid ' + BLUE + ';padding:16px 20px;border-radius:0 10px 10px 0"><div style="font-weight:700;color:' + NAVY + '">' + title + '</div><ol style="padding-left:20px;color:' + BODY + '">' + values.map(item => '<li style="margin:8px 0">' + esc(item.text) + (item.due ? '<div style="margin-top:4px;font-weight:700">Agreed timing: ' + esc(item.due) + '</div>' : '') + '</li>').join('') + '</ol></div>';
}

/**
 * A top-level section band.
 *
 * The five sections of the agreed outline are the email's skeleton, so they are marked more
 * loudly than the blocks inside them -- a filled band in the same palette as the confirmation
 * email's callouts, rather than another thin uppercase rule that would read as one more subhead.
 */
function sectionBand(emoji: string, title: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:26px 0 12px">` +
    `<tr><td style="background:${PALE};border-left:5px solid ${ACCENT_BAR};border-radius:0 10px 10px 0;padding:11px 16px;font-size:13px;letter-spacing:1.4px;text-transform:uppercase;font-weight:700;color:${NAVY}">${emoji}&nbsp; ${esc(title)}</td></tr>` +
    `</table>`
  );
}

/** A labelled line inside a topic card, dropped entirely when the model had nothing for it. */
function topicLine(label: string, value: string): string {
  if (!value.trim()) return "";
  return (
    `<div style="margin-top:8px"><div style="font-size:11px;letter-spacing:1.3px;text-transform:uppercase;font-weight:700;color:${BLUE}">${esc(label)}</div>` +
    `<div style="color:${BODY};margin-top:2px">${esc(value)}</div></div>`
  );
}

/**
 * The main body: one numbered card per topic actually discussed.
 *
 * Numbered because the outline asks for it and because the client replies by number. Nothing is
 * padded out to a fixed shape -- a topic with no agreed direction shows no direction line, which
 * is the whole reason the fields are separate rather than one paragraph.
 */
function topicsBlock(topics: RecapTopic[]): string {
  const usable = topics.filter((topic) => topic.heading.trim() && topic.discussed.trim());
  if (!usable.length) return "";
  return usable
    .map(
      (topic, index) =>
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;border-collapse:separate;background:#ffffff;border:1px solid ${HAIR};border-radius:12px">` +
        `<tr><td width="52" style="padding:16px 0 16px 14px;vertical-align:top"><div style="width:34px;height:34px;border-radius:34px;background:${BLUE};color:#ffffff;text-align:center;line-height:34px;font-size:16px;font-weight:700">${index + 1}</div></td>` +
        `<td style="padding:16px 18px 16px 4px">` +
        `<div style="font-weight:700;color:${NAVY};font-size:17px">${esc(topic.heading)}</div>` +
        topicLine("What we discussed", topic.discussed) +
        topicLine("Where things stand", topic.situation) +
        topicLine("What we'll focus on", topic.direction) +
        topicLine("What to expect", topic.outcome) +
        `</td></tr></table>`,
    )
    .join("");
}

/** The client's own targets, in their words, under the goals section. */
function goalTargetsBlock(targets: string[]): string {
  const usable = targets.filter((target) => target.trim());
  if (!usable.length) return "";
  return (
    `<ul style="margin:4px 0 0;padding-left:20px;color:${BODY}">` +
    usable.map((target) => `<li style="margin:6px 0">${esc(target)}</li>`).join("") +
    `</ul>`
  );
}

function footerBlock(logoUrl: string): string {
  const mark = logoUrl
    ? `<td style="padding-right:8px;vertical-align:middle"><span style="display:inline-block;background:#ffffff;border-radius:6px;padding:3px"><img src="${esc(logoUrl)}" alt="" width="16" height="18" style="display:block;border:0"></span></td>`
    : "";
  return [
    `<div style="background:${NAVY};color:#c9d4e3;padding:18px 30px;font-size:12px">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>`,
    `<td style="vertical-align:middle"><table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${mark}<td style="vertical-align:middle;font-size:14px;font-weight:700;color:#ffffff">MapRanking</td></tr></table></td>`,
    `<td style="vertical-align:middle;text-align:right;color:#c9d4e3"><a href="https://mapranking.com" style="color:#8FB8F6;text-decoration:none;font-weight:700">mapranking.com</a> &nbsp;·&nbsp; support@mapranking.com</td>`,
    `</tr></table></div>`,
  ].join("");
}

/**
 * The whole recap, as a client's inbox receives it.
 *
 * Laid out in the five sections of the agreed outline, in that order: the opening says why the
 * email exists, the main body walks the topics that were actually discussed, the goals section
 * carries the client's own targets and the questions they owe us, the quick recap splits the two
 * sides' responsibilities, and the closing thanks them and names the next call.
 *
 * Every section disappears when it has nothing verified in it. An outline is a shape to fill from
 * the call, not a set of headings to pad out -- an empty "Your goals and growth targets" band
 * would tell the client we discussed their goals when we did not.
 */
export function buildRecapEmailHtml(facts: RecapEmailFacts): string {
  const name = knownContactName(facts.contactFirstName);
  const greeting = name ? `Hello ${esc(name)},` : "Hello,";
  const bookUrl = safeUrl(facts.nextCheckInUrl);
  const inclusions = facts.promisedInclusions || [];
  const topics = topicsBlock(facts.discussionTopics || []);
  const targets = goalTargetsBlock(facts.goalTargets || []);
  const questions = promisedInclusionsBlock(inclusions, "questions");
  const commitments = commitmentsBlock(facts.meetingCommitments || []);
  const asks = asksBlock(facts.meetingRequests || []);
  const goalsSection = targets || questions || facts.goalLabel;

  return [
    `<div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid ${HAIR};border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:${NAVY};font-size:15px;line-height:1.55">`,
    `<div style="height:8px;background:${GREEN}"></div>`,
    headerBlock(facts),
    `<div style="padding:4px 30px 8px">`,
    // 1 -- Opening and meeting acknowledgment. The one paragraph in this email that is the same
    // for every account: it thanks them and says what the rest of the email is, which is the
    // same promise every time.
    `<p style="margin:18px 0 6px">${greeting}</p>`,
    `<p style="margin:0 0 14px;color:${BODY}">Thank you again for taking the time to meet with me. Here is a recap of what we discussed, the priorities for the next 30 days, what we will be working on, and the few things we need from you to keep everything moving forward.</p>`,

    // 2 -- Main discussion points and account priorities.
    topics || facts.intro || facts.highlights?.length || facts.wins.length || facts.next30Days?.length
      ? sectionBand("💬", "What we discussed")
      : "",
    facts.intro ? facts.intro.split(/\n\s*\n/).filter(Boolean).map(paragraph => '<p style="margin:0 0 14px;color:' + BODY + '">' + esc(paragraph) + '</p>').join('') : "",
    topics,
    facts.highlights?.length ? '<div style="margin:22px 0 10px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;font-weight:700;color:' + BLUE + '">Performance highlights</div>' + facts.highlights.map((item, index) => '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;border-collapse:separate;background:' + PALE + ';border:1px solid ' + HAIR + ';border-radius:10px"><tr><td width="40" style="padding:16px 0 16px 16px;color:' + BLUE + ';font-size:20px;font-weight:700;vertical-align:top">' + (index + 1) + '</td><td style="padding:16px"><div style="font-weight:700;color:' + NAVY + '">' + esc(item.title) + '</div><div style="margin-top:4px;color:' + BODY + '">' + esc(item.detail) + '</div></td></tr></table>').join('') : "",
    winsBlock(facts.wins),
    next30DaysBlock(facts.next30Days || []),
    promisedInclusionsBlock(inclusions, "other"),

    // 3 -- Client goals and growth targets, with the questions they owe us.
    goalsSection ? sectionBand("🎯", "Your goals and growth targets") : "",
    facts.goalLabel
      ? `<p style="margin:0 0 4px;color:${BODY}">All of it points at the same thing: <span style="font-weight:700;color:${NAVY}">${esc(facts.goalLabel)}</span>.</p>`
      : "",
    targets,
    questions,

    // 4 -- Quick recap: the two sides' responsibilities, side by side.
    commitments || asks ? sectionBand("📌", "Quick recap") : "",
    // Only transcript-supported agreements enter these sections; the general backlog stays private.
    commitments,
    asks,

    // 5 -- Closing and call to action.
    sectionBand("🙏", "Before you go"),
    bookUrl
      ? `<div style="text-align:center;margin:24px 0 20px"><a href="${esc(bookUrl)}" style="display:inline-block;padding:14px 30px;border-radius:10px;background:${BLUE};color:#ffffff;font-weight:700;text-decoration:none;font-size:16px">🗓️ ${facts.nextCheckInLabel ? `Next check-in · ${esc(facts.nextCheckInLabel)}` : "Book the next check-in"}</a></div>`
      : facts.nextCheckInLabel
        ? `<p style="margin:0 0 0;color:${BODY}">A quick reminder: ${facts.nextMeetingAgreed ? "we set" : "your next Monthly Touch is scheduled"} ${facts.nextMeetingAgreed ? "our next Monthly Touch for" : "for"} <span style="font-weight:700;color:${NAVY}">${esc(facts.nextCheckInLabel)}</span>. You can reach out to me anytime before then.</p>`
        : "",
    `<p style="margin:14px 0 0;color:${BODY}">Thank you again${name ? `, ${esc(name)}` : ""}. I appreciate your help with these items.</p>`,
    `<p style="margin:14px 0 0;color:${BODY}">${esc(facts.followUpChannel)}</p>`,
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
  gmailMessageId?: string;
  gmailThreadId?: string;
  sentVia?: string;
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
