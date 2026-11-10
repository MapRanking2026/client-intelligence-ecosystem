/**
 * The Monthly Touch preparation workflow, as four ordered stages.
 *
 * The original preparation prompt is a sequence, not one action: the account review comes first,
 * the client confirmation email is written from its finalized agenda, the structured preparation
 * notes are written from the same findings, and only then is anything filed in ClickUp. Collapsing
 * those into a single "Generate" button is what made the old screen dishonest -- an AM could not
 * tell whether the research had actually run, whether the client had been told anything, or
 * whether the notes existed anywhere outside MTOS.
 *
 * Every stage therefore records what it attempted, when, and why it failed, and a stage refuses to
 * run until the stage before it genuinely completed. Nothing here marks itself done on a click.
 */

/** The four stages, in the only order they may run. */
export const PREP_STAGE_ORDER = ["research", "confirmation_email", "prep_notes", "clickup_filing"] as const;

export type PrepStageId = (typeof PREP_STAGE_ORDER)[number];

/**
 * `blocked` means the stage before it is not complete -- the application refuses the action rather
 * than only hiding the button. `failed` is a real attempt that did not succeed and is retryable.
 */
export type PrepStageStatus = "blocked" | "ready" | "running" | "complete" | "failed";

export interface PrepStageState {
  status: PrepStageStatus;
  startedAt?: string;
  completedAt?: string;
  /** Retries are expected (a refused ClickUp write, a model timeout); the count is kept for support. */
  attempts?: number;
  errorMessage?: string;
}

/**
 * One evidence source and whether it was actually reachable this run.
 *
 * The preparation prompt forbids claiming an email was sent, received or unanswered until both
 * Intercom and Gmail have been checked, so "we did not check" and "we checked and found nothing"
 * are stored as different facts.
 */
export interface PrepSourceCheck {
  key: string;
  label: string;
  /** False when the integration is not connected at all -- not a finding, an unchecked source. */
  checked: boolean;
  /** True when the source answered. False with `checked` true means it was tried and failed. */
  reachable: boolean;
  detail: string;
}

export interface PrepCommsVerification {
  intercom: "checked" | "not_connected" | "failed";
  gmail: "checked" | "not_connected" | "failed";
  /** Plain-English statement of which inboxes were read, for the prep document to quote. */
  note: string;
}

export interface PrepResearchState {
  completedAt: string;
  pipelineVersion: string;
  /**
   * The agenda as it stood when research finished. Snapshotted because the confirmation email must
   * communicate the agenda the preparation actually produced, and a later regeneration must not
   * silently change what the client was told.
   */
  agenda: string[];
  sourceChecks: PrepSourceCheck[];
  dataGaps: string[];
  commsVerification: PrepCommsVerification;
}

/**
 * `sent` is only ever written after a transport confirmed delivery. `sent_manually` is the AM
 * telling MTOS they sent it themselves (Gmail is connected read-only for most tenants), recorded
 * as a different fact so a report never claims MTOS delivered something it did not.
 */
export type ConfirmationEmailStatus =
  | "draft"
  | "approved"
  | "sending"
  | "sent"
  | "sent_manually"
  /**
   * The account manager chose to run this touch without a confirmation email.
   *
   * A real case, not a loophole: a client who books the call the same day already knows when it
   * is, and a confirmation email that arrives after the meeting is worse than none. Recorded as
   * its own status rather than faked as "sent" so nothing downstream -- the notes, the readiness
   * score, a report -- can ever claim the client was sent an agenda they never received.
   */
  | "skipped"
  | "failed";

export interface ConfirmationEmailState {
  subject: string;
  body: string;
  /** The client's preferred channel when known, so the AM sends it where the client reads it. */
  channel: string;
  /** Empty when no address could be traced to a source. Never guessed from the business name. */
  recipient: string;
  /** How the address was found, or in plain words why there isn't one. */
  recipientSource: string;
  /** The zone the meeting time is stated in, and whether that zone is the client's or a default. */
  timeZone: string;
  timeZoneSource: string;
  /** The meeting date and time as the client will read it, or an em dash when the touch has no time. */
  meetingWhen: string;
  status: ConfirmationEmailStatus;
  generatedAt: string;
  model?: string;
  provider?: string;
  approvedAt?: string;
  approvedBy?: string;
  sentAt?: string;
  /** What actually carried it ("Gmail API", "sent by the account manager"). */
  sentVia?: string;
  deliveryAttempts: number;
  lastError?: string;
  /** Set only when `status` is "skipped": when the AM chose to proceed without the email. */
  skippedAt?: string;
  skippedBy?: string;
  /** The AM's own words for why, shown on the screen and carried into the notes. */
  skipReason?: string;
  /**
   * Stable for the life of one approved draft. A retried send reuses it, so a transport that
   * succeeded on a request MTOS never saw the answer to cannot produce a second email.
   */
  idempotencyKey: string;
  /** What the AM must supply or check before this is sendable. */
  gaps: string[];
}

/** One numbered section of the preparation document, in the original prompt's order. */
export interface PrepDocumentSection {
  /** "0", "R", "1" ... "16" -- the original prompt's own numbering, kept verbatim. */
  id: string;
  title: string;
  markdown: string;
  /** False for a conditional section that genuinely does not apply this month. */
  included: boolean;
  skippedReason?: string;
  /** True when a required section came back empty -- surfaced, never quietly dropped. */
  failed?: boolean;
}

export interface PrepDocumentState {
  markdown: string;
  sections: PrepDocumentSection[];
  generatedAt: string;
  model?: string;
  provider?: string;
  /** The missing-evidence banner the prompt requires at the top of the document. */
  missing: string[];
  /** Required sections the model failed to return. Non-empty means the stage failed. */
  missingSections: string[];
  approvedAt?: string;
  approvedBy?: string;
  errorMessage?: string;
}

export interface PrepFilingState {
  status: "not_filed" | "filed" | "failed";
  /** The Client's Book pages MTOS wrote, so a re-run edits them instead of stacking duplicates. */
  links?: {
    docId: string;
    prepPageId: string;
    prepPageUrl: string;
    postPageId?: string;
    postPageUrl?: string;
    writtenAt: string;
  };
  /**
   * Whether this touch already has its `Post Monthly Touch Notes` subpage.
   *
   * True once the filing has run: the subpage is created empty, inside the `Monthly Touch`
   * page, so the place the write-up will go exists before the call. Read off the recorded page
   * id rather than set by hand, so it cannot claim a subpage that was never created.
   */
  postNotesCreated: boolean;
  filedAt?: string;
  errorMessage?: string;
  /** Which folder and page the notes went to, so the AM can confirm it is the right client. */
  destination?: string;
  /** The page name as written (`Monthly Touch (10/28/2026)`), so the AM can find it. */
  pageName?: string;
}

/** One thing a score is actually measuring, and whether it is there. */
export interface ScoreInput {
  key: string;
  label: string;
  status: "ok" | "partial" | "missing" | "failed";
  detail: string;
  /** Share of the score this input carries, in points. */
  weight: number;
}

/**
 * Readiness measures how much of the required preparation has actually run and succeeded.
 *
 * `null` means nothing has been measured yet, which is not the same as zero and is shown as an em
 * dash. A blocker is a required step that failed or never ran; while there is one, the touch cannot
 * read as Ready however complete its inputs look.
 */
export interface ReadinessBreakdown {
  score: number | null;
  label: string;
  inputs: ScoreInput[];
  blockers: string[];
  measures: string;
}

/**
 * Confidence measures how much of the evidence behind the preparation is present and fresh --
 * deliberately a different question from readiness, which is about execution.
 */
export interface ConfidenceBreakdown {
  score: number | null;
  label: string;
  inputs: ScoreInput[];
  gaps: string[];
  measures: string;
}

export interface PrepWorkflowState {
  version: 2;
  stages: Record<PrepStageId, PrepStageState>;
  research?: PrepResearchState;
  confirmationEmail?: ConfirmationEmailState;
  document?: PrepDocumentState;
  filing?: PrepFilingState;
  readiness?: ReadinessBreakdown;
  confidence?: ConfidenceBreakdown;
  updatedAt: string;
}

export const PREP_STAGE_LABEL: Record<PrepStageId, string> = {
  research: "Prepare the Monthly Touch",
  confirmation_email: "Client confirmation email",
  prep_notes: "Preparation notes",
  clickup_filing: "File in the Client's Book",
};

/** Plain-English reason a stage cannot run yet, used by both the API and the screen. */
export const PREP_STAGE_PREREQUISITE: Record<PrepStageId, string> = {
  research: "",
  confirmation_email:
    "The account review has to finish first, because the email tells the client the agenda the preparation produced.",
  prep_notes:
    "The confirmation email has to be settled first — sent by MTOS, sent by you and recorded here, or deliberately skipped for this touch. The notes reproduce what the client received, so they cannot be written while that is still an open question.",
  clickup_filing:
    "The preparation notes have to be written and approved by you before anything is filed in the client's ClickUp book.",
};

export function emptyPrepWorkflowState(nowIso: string): PrepWorkflowState {
  return {
    version: 2,
    stages: {
      research: { status: "ready" },
      confirmation_email: { status: "blocked" },
      prep_notes: { status: "blocked" },
      clickup_filing: { status: "blocked" },
    },
    updatedAt: nowIso,
  };
}
