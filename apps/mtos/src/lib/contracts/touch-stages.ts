/**
 * What each of the five Monthly Touch stages contains, and in what order.
 *
 * The screen this replaced had three progress indicators arguing with each other: the five-stage
 * rail at the top, a second numbered rail inside the preparation panel ("Four steps, in this
 * order"), and a primary-action card between them that named a stage of its own. An AM looking for
 * "where am I" had to read all three and work out which one was telling the truth -- and because
 * the preparation panel's four steps were not the five stages, neither answer was wrong and
 * neither was useful.
 *
 * So the stage order and the section order inside Prep and Review live here, in one list each, and
 * the screen renders from these lists rather than from the order someone happened to type the JSX
 * in. A section that is meant to be read before another one cannot drift below it without this
 * file changing, and `check:touch-stages` fails if it does.
 *
 * Pure: no React, no Firestore. The order is a rule, and a rule nobody can exercise is a rule
 * nobody keeps.
 */

import type { TouchStep } from "@/src/lib/contracts/touch-progress";

/** One line on what a stage is for, shown under its name in the sticky timeline. */
export const TOUCH_STAGE_PURPOSE: Record<TouchStep, string> = {
  prep: "Sync the meeting, check readiness, run the account review.",
  review: "Read the brief, approve the client email, choose the format, approve.",
  live: "Run the call from the presentation or the call guide.",
  follow: "Recap, tickets and the post-meeting notes.",
  qa: "Scored against the rubric, with the coaching plan.",
};

// ---------------------------------------------------------------------------
// Prep
// ---------------------------------------------------------------------------

/**
 * The three parts of Prep, in reading order.
 *
 * The meeting comes first because everything after it quotes the meeting's date and time at a
 * client: the confirmation email states the hour as fact, and on 9 November 2026 a six-day-old
 * calendar sync had MTOS offering to remind a client about a call they had already moved. Readiness
 * and confidence come next, because they are the answer to "is this account worth reviewing yet".
 * The account review itself is last: it is the long-running one, and an AM who starts it before
 * checking the two things above waits five minutes to find out the meeting was wrong.
 */
export const PREP_SECTION_ORDER = ["meet_sync", "readiness", "account_review"] as const;

export type PrepSectionId = (typeof PREP_SECTION_ORDER)[number];

export const PREP_SECTION_LABEL: Record<PrepSectionId, string> = {
  meet_sync: "Google Meet sync",
  readiness: "Readiness and evidence confidence",
  account_review: "Prepare the Monthly Touch",
};

export const PREP_SECTION_PURPOSE: Record<PrepSectionId, string> = {
  meet_sync:
    "Which Google Meet this touch is, so the date, the time and the link everything else quotes are the real ones.",
  readiness:
    "Whether the account is ready for review, and how much of the evidence behind it MTOS actually has.",
  account_review:
    "Reads every connected source, then writes the fifteen-section brief the review step is built on.",
};

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

/**
 * The four parts of Review, in reading order.
 *
 * The brief is first and the approval is last, and the two in between are in the order the AM has
 * to decide them: the email goes to the client, so it is read while the findings it describes are
 * still in mind, and the format decides what the approval builds, so it is chosen before the
 * button that builds it. The charts, the lead verification and the recommendations sit inside the
 * brief rather than below it -- they used to be a second run of cards after the approval card, so
 * the evidence for a recommendation was reviewed after the brief it belonged to was approved.
 */
export const REVIEW_SECTION_ORDER = ["brief", "confirmation_email", "call_format", "approval"] as const;

export type ReviewSectionId = (typeof REVIEW_SECTION_ORDER)[number];

export const REVIEW_SECTION_LABEL: Record<ReviewSectionId, string> = {
  brief: "The Monthly Touch brief",
  confirmation_email: "Client confirmation email and agenda",
  call_format: "How you'll run the call",
  approval: "Approve and go to the live call",
};

export const REVIEW_SECTION_PURPOSE: Record<ReviewSectionId, string> = {
  brief:
    "All fifteen sections, with the charts, the lead verification and the recommendations inside the sections they belong to, so they are read before anything is approved.",
  confirmation_email:
    "The agenda the client receives, with the meeting time and the Meet link. Send it here, or let the approval send it.",
  call_format: "A presentation for the client, or a timed call guide for you.",
  approval:
    "Approves the brief, files the prep notes in the Client's Book, sends the email if it is still waiting, and builds the call.",
};

/**
 * The format selected when nobody has chosen one.
 *
 * The owner's instruction, and a change from the old default: the AM's own preference used to win,
 * and the preference's own default was the call guide, so a new AM's first touch quietly ran
 * without anything on the client's screen. A presentation is what a monthly review looks like, and
 * the guide is one click away for the AM who prefers it.
 */
export const DEFAULT_LIVE_CALL_FORMAT = "deck" as const;
