import { knownContactName } from "@/src/lib/contracts/recap-contact";
import { emailSignatureHtml, emailSignatureLines, sanitizeAgendaEmailHtml } from "@/src/lib/contracts/agenda-email";
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

function esc(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
  narrative?: string[];
  locationTargets?: { location: string; competitor: string }[];
  wins: RecapWin[];
  commitments: RecapCommitment[];
  asks: RecapAsk[];
  /** "Just reply to this email", or whatever channel this client actually uses. */
  followUpChannel: string;
  signoff: string[];
  /** The same sign-off with the formatting the AM gave it in Settings. */
  signoffHtml?: string;
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
  narrative?: string[];
  locationTargets?: { location: string; competitor: string }[];
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
    narrative: source.narrative,
    locationTargets: source.locationTargets,
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
    signoffHtml: emailSignatureHtml(source.signoff, source.accountManagerName),
    logoUrl,
  };

  return {
    subject: `Monthly Touch Recap & Next Steps | ${source.businessName}`,
    html: buildRecapEmailHtml(facts),
    facts,
    blockingGaps: gaps,
  };
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
function inlineText(value: string): string {
  return esc(value.replace(/&#x20;|&#32;|\u00a0/gi, " ")).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" style="color:#1A73E8;text-decoration:underline">$1</a>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/** A readable email letter with simple blocks that remain easy to edit in Gmail and MTOS. */
export function buildRecapEmailHtml(facts: RecapEmailFacts): string {
  const name = knownContactName(facts.contactFirstName);
  const paragraph = (text: string) => '<p style="margin:0 0 16px;line-height:1.65">' + inlineText(text) + '</p>';
  const heading = (text: string) => '<h2 style="font-size:20px;font-weight:700;color:' + NAVY + ';line-height:1.35;margin:28px 0 14px;padding-bottom:9px;border-bottom:2px solid ' + HAIR + '">' + esc(text) + '</h2>';
  const list = (items: string[], ordered = false) => !items.length ? '' : '<' + (ordered ? 'ol' : 'ul') + ' style="margin:0 0 20px;padding-left:24px;line-height:1.65;list-style-type:' + (ordered ? 'decimal' : 'disc') + '">' + items.map(item => '<li style="margin:8px 0">' + inlineText(item) + '</li>').join('') + '</' + (ordered ? 'ol' : 'ul') + '>';
  const unique = (items: string[]) => [...new Map(items.filter(Boolean).map(item => [item.replace(/\s+/g, ' ').trim().toLowerCase(), item])).values()];
  const timing = (item: RecapCommitment) => item.what + (item.due && !item.what.toLowerCase().includes(item.due.toLowerCase()) ? ' — **' + item.due + '**' : '');
  const narrative = facts.narrative?.length ? facts.narrative : (facts.discussionTopics || []).slice(0, 5).map(topic => [topic.discussed, topic.direction].filter(Boolean).join(' '));
  const targets = facts.locationTargets || [];
  const nextUrl = /^https?:\/\//i.test(facts.nextCheckInUrl.trim()) ? facts.nextCheckInUrl.trim() : "";
  const questions = (facts.promisedInclusions || []).filter(item => item.requiresReply);
  const otherInclusions = (facts.promisedInclusions || []).filter(item => !item.requiresReply);
  const teamActions = unique([...(facts.meetingCommitments || []).map(timing), ...(!facts.meetingCommitments?.length ? (facts.next30Days || []).map(timing) : [])]);
  const clientActions = unique((facts.meetingRequests || []).map(timing));
  const opening = 'Thank you again for taking the time to meet with me. I wanted to send over a quick recap of what we discussed and the priorities for the next 30 days.';
  return [
    '<div style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid ' + HAIR + ';border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:' + NAVY + ';font-size:15px;line-height:1.65">',
    '<div style="height:6px;background:' + BLUE + '"></div>',
    '<div style="padding:24px 32px 18px;background:#F4F8FE;border-bottom:1px solid ' + HAIR + '"><div style="font-size:18px;font-weight:700;color:' + NAVY + '">MapRanking</div><div style="margin-top:12px;font-size:11px;letter-spacing:1.8px;text-transform:uppercase;color:' + BLUE + ';font-weight:700">Monthly Touch · Recap &amp; Next Steps</div><div style="margin-top:5px;font-size:14px;color:' + BODY + '">' + esc(facts.businessName) + (facts.metLabel ? ' · ' + esc(facts.metLabel) : '') + '</div></div>',
    '<div data-mtos-recap-body="true" style="padding:28px 32px 12px">',
    paragraph(name ? 'Hello ' + name + ',' : 'Hello,'), paragraph(opening),
    targets.length ? paragraph("As discussed, we’ll be moving forward with competitor targeting for these locations:") + list(targets.map(item => '**' + item.location + ':** ' + item.competitor)) : '',
    narrative.length ? unique(narrative).map(paragraph).join('') : facts.intro ? facts.intro.split(/\n\s*\n/).filter(Boolean).map(paragraph).join('') : '',
    !narrative.length && facts.highlights?.length ? list(facts.highlights.slice(0, 3).map(item => '**' + item.title + ':** ' + item.detail)) : '',
    !narrative.length && facts.wins.length ? heading('Completed Work') + list(facts.wins.map(win => win.what + (win.shipped ? ' — shipped ' + win.shipped : ''))) : '',
    otherInclusions.length ? list(otherInclusions.map(item => item.text)) : '',
    questions.length || facts.goalTargets?.length || facts.goalLabel ? heading('Business Goals & Growth Targets') : '',
    facts.goalTargets?.length ? list(facts.goalTargets) : facts.goalLabel ? paragraph(facts.goalLabel) : '',
    questions.length ? paragraph('Please help me answer the following questions so we can better measure our progress against your business goals.') + list(questions.map(item => item.text), true) : '',
    teamActions.length || clientActions.length ? heading('Quick Recap') : '',
    teamActions.length ? '<h3 style="font-size:16px;font-weight:700;margin:16px 0 10px;color:' + NAVY + '">What to Expect From Us:</h3>' + list(teamActions) : '',
    clientActions.length ? '<h3 style="font-size:16px;font-weight:700;margin:22px 0 10px;color:' + NAVY + '">What We Need From You:</h3>' + list(clientActions) : '',
    questions.some(item => item.due) && !clientActions.some(item => questions.some(question => question.due && item.includes(question.due))) ? paragraph('Please send your answers ' + questions.find(item => item.due)!.due + '.') : '',
    facts.nextCheckInLabel ? '<p style="margin:22px 0 16px;line-height:1.65">Our next Monthly Touch is scheduled for <strong>' + (nextUrl ? '<a href="' + esc(nextUrl) + '" style="color:#1a73e8;text-decoration:underline">' + esc(facts.nextCheckInLabel) + '</a>' : esc(facts.nextCheckInLabel)) + '</strong>. We can review progress and go over the next steps then, and you can reach out to me anytime before our meeting.</p>' : '',
    paragraph('Thank you again' + (name ? ', ' + name : '') + '. I appreciate your help with these items.'),
    paragraph(facts.followUpChannel),
    facts.signoff.length ? '<p style="margin:20px 0 14px;line-height:1.6">' + (facts.signoffHtml || facts.signoff.map(line => inlineText(line)).join('<br>')) + '</p>' : '',
    '</div>', footerBlock(facts.logoUrl), '</div>',
  ].join('');
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
  recipient?: string;
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
    if (state.recipient !== undefined && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(state.recipient.trim())) blockers.push("Enter the client's email address in the recap email.");
    if (!state.subject.trim()) blockers.push("The recap email has no subject line.");
    if (!recapEmailHasBody(state.html)) blockers.push("The recap email has almost nothing in it.");
  }
  return blockers;
}
