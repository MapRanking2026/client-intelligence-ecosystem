import type { ConfidenceBreakdown, ReadinessBreakdown, ScoreInput } from "@/src/lib/contracts/prep-workflow";
import type { MonthlyTouchRecord } from "@/src/lib/mtos-data";

/**
 * What Readiness and Confidence actually measure.
 *
 * The old scores were the reason the run-sheet could show a touch as `Ready` at 94 while the
 * preparation panel said `Not prepared yet`. Readiness started from a floor of 58, was clamped to
 * 55-98 so it could never read low, counted *more* open commitments as *more* readiness, and -- the
 * real defect -- was computed from inputs rather than from whether the preparation had actually
 * run. Confidence was the client's relationship and health labels, which say nothing about the
 * evidence behind this month's preparation.
 *
 * These two answer two different questions, deliberately:
 *   Readiness  -- how much of the required preparation has actually run and succeeded.
 *   Confidence -- how much of the evidence behind it is present and fresh.
 *
 * Both return `null` when nothing has been measured. `null` is shown as an em dash, never as 0: a
 * touch nobody has prepared is unmeasured, not a zero-scoring one, and averaging it as zero is the
 * same mistake that made 181 unassessed clients look like failing accounts.
 */

export const READINESS_MEASURES =
  "How much of the required preparation has actually run and succeeded: the account review, the client confirmation email, the preparation notes, and filing them in the client's ClickUp book. A step that failed or never ran costs its full weight.";

export const CONFIDENCE_MEASURES =
  "How much of the evidence behind this preparation is present and fresh: which connected sources answered, whether the client's email history was verified in both inboxes, whether the business numbers came through, and how many gaps the preparation had to flag.";

function statusFor(done: boolean, failed: boolean): ScoreInput["status"] {
  if (failed) return "failed";
  return done ? "ok" : "missing";
}

/**
 * Readiness from the four stages plus the two things that make a preparation usable at the call:
 * a scheduled meeting time, and a document with no missing sections.
 *
 * Weights sum to 100. The account review carries the most because nothing downstream is possible
 * or meaningful without it.
 */
export function computeReadiness(touch: MonthlyTouchRecord): ReadinessBreakdown {
  const workflow = touch.prepWorkflow;

  if (!workflow) {
    return {
      score: null,
      label: "Not prepared",
      inputs: [],
      blockers: [
        "The preparation has not been run for this touch yet, so there is nothing to score. Start with Prepare the Monthly Touch.",
      ],
      measures: READINESS_MEASURES,
    };
  }

  const stages = workflow.stages;
  const document = workflow.document;
  const email = workflow.confirmationEmail;

  const inputs: ScoreInput[] = [
    {
      key: "research",
      label: "Account review ran and produced findings",
      status: statusFor(stages.research.status === "complete", stages.research.status === "failed"),
      detail:
        stages.research.status === "complete"
          ? `Completed ${workflow.research?.completedAt ?? "—"}, with ${workflow.research?.sourceChecks.filter((check) => check.reachable).length ?? 0} sources answering.`
          : stages.research.status === "failed"
            ? stages.research.errorMessage || "The account review failed."
            : "The account review has not run.",
      weight: 35,
    },
    {
      key: "confirmation_email",
      label: "Client confirmation email approved",
      status: (() => {
        if (!email) return "missing";
        if (email.status === "failed") return "failed";
        if (email.status === "sent" || email.status === "sent_manually") return "ok";
        if (email.status === "approved") return "partial";
        return "missing";
      })(),
      detail: !email
        ? "No confirmation email has been written."
        : email.status === "sent" || email.status === "sent_manually"
          ? `Sent ${email.sentAt ?? ""} via ${email.sentVia ?? "the configured channel"}.`
          : email.status === "approved"
            ? "Approved but not sent yet, so the client has not been told the agenda."
            : email.status === "failed"
              ? email.lastError || "The send failed."
              : "Written but not approved yet.",
      weight: 20,
    },
    {
      key: "prep_notes",
      label: "Preparation notes written in full",
      status: (() => {
        if (!document) return "missing";
        if (document.missingSections.length) return "failed";
        if (!document.approvedAt) return "partial";
        return "ok";
      })(),
      detail: !document
        ? "The preparation notes have not been written."
        : document.missingSections.length
          ? `Sections ${document.missingSections.join(", ")} came back empty, so the notes are incomplete.`
          : document.approvedAt
            ? `Written and approved ${document.approvedAt}.`
            : "Written, waiting for your approval.",
      weight: 25,
    },
    {
      key: "clickup_filing",
      label: "Filed in the client's ClickUp book",
      status: statusFor(stages.clickup_filing.status === "complete", stages.clickup_filing.status === "failed"),
      detail:
        workflow.filing?.status === "filed"
          ? `Filed in ${workflow.filing.destination ?? "the Client's Book"}.`
          : workflow.filing?.errorMessage || "Nothing has been filed in ClickUp for this touch.",
      weight: 15,
    },
    {
      key: "schedule",
      label: "Meeting date and time set",
      status: touch.scheduledAt ? "ok" : "missing",
      detail: touch.scheduledAt
        ? `Scheduled for ${touch.scheduledAt}.`
        : "This touch has no date and time, so the client cannot be told when the call is.",
      weight: 5,
    },
  ];

  // Partial credit is half, because a step that is half-done is genuinely half-done: an approved
  // email the client never received is real progress and a real gap at the same time.
  const earned = inputs.reduce((total, input) => {
    if (input.status === "ok") return total + input.weight;
    if (input.status === "partial") return total + input.weight / 2;
    return total;
  }, 0);

  const blockers = inputs
    .filter((input) => input.status === "failed" || (input.status === "missing" && input.weight >= 15))
    .map((input) => `${input.label}: ${input.detail}`);

  const score = Math.round(earned);
  const label =
    blockers.length > 0
      ? "Not ready"
      : score >= 95
        ? "Ready"
        : score >= 60
          ? "Nearly ready"
          : "In preparation";

  return { score, label, inputs, blockers, measures: READINESS_MEASURES };
}

/**
 * Confidence from the evidence this preparation was actually built on.
 *
 * Returns `null` before the account review has run: there is no evidence picture yet, and inventing
 * a midpoint would be the same dishonesty in the other direction.
 */
export function computeConfidence(touch: MonthlyTouchRecord): ConfidenceBreakdown {
  const workflow = touch.prepWorkflow;
  const research = workflow?.research;
  const prepPack = touch.prepPack;

  if (!research || !prepPack) {
    return {
      score: null,
      label: "Not measured",
      inputs: [],
      gaps: ["The account review has not run, so there is no evidence picture to be confident or unsure about."],
      measures: CONFIDENCE_MEASURES,
    };
  }

  const answered = research.sourceChecks.filter((check) => check.reachable);
  const connected = research.sourceChecks.filter((check) => check.checked);
  const scorecard = prepPack.businessScorecard;
  const businessMetrics = scorecard
    ? [
        scorecard.totalLeads,
        scorecard.qualifiedLeads,
        scorecard.bookedJobs,
        scorecard.callsAnswered,
        scorecard.costPerLead,
      ]
    : [];
  const availableMetrics = businessMetrics.filter((metric) => metric?.availability === "available").length;

  const commsVerified =
    research.commsVerification.intercom === "checked" && research.commsVerification.gmail === "checked";
  const commsPartial =
    research.commsVerification.intercom === "checked" || research.commsVerification.gmail === "checked";

  const inputs: ScoreInput[] = [
    {
      key: "sources",
      label: "Connected sources that answered",
      status: answered.length >= 4 ? "ok" : answered.length > 0 ? "partial" : "missing",
      detail: `${answered.length} of ${research.sourceChecks.length} sources answered${
        connected.length < research.sourceChecks.length
          ? `; ${research.sourceChecks.length - connected.length} are not connected, so they were not checked`
          : ""
      }.`,
      weight: 30,
    },
    {
      key: "business_numbers",
      label: "Business numbers (leads, jobs, calls, cost per lead)",
      status: availableMetrics >= 4 ? "ok" : availableMetrics > 0 ? "partial" : "missing",
      detail:
        availableMetrics > 0
          ? `${availableMetrics} of the 5 headline business numbers came through.`
          : "None of the headline business numbers came through, so the preparation reasons from visibility alone.",
      weight: 25,
    },
    {
      key: "comms",
      label: "Client email history verified in both inboxes",
      status: commsVerified ? "ok" : commsPartial ? "partial" : "missing",
      detail: research.commsVerification.note,
      weight: 20,
    },
    {
      key: "client_memory",
      label: "Previous touch notes and Client's Book read",
      status: (prepPack.clickupContext?.clientsBook?.length ?? 0) > 0 ? "ok" : "missing",
      detail:
        (prepPack.clickupContext?.clientsBook?.length ?? 0) > 0
          ? `${prepPack.clickupContext?.clientsBook.length} pages of this client's book were read.`
          : "No Client's Book pages were read, so last month's promises and the client's own words are not in this preparation.",
      weight: 15,
    },
    {
      key: "gaps",
      label: "Gaps the preparation had to flag",
      status: research.dataGaps.length === 0 ? "ok" : research.dataGaps.length <= 3 ? "partial" : "missing",
      detail:
        research.dataGaps.length === 0
          ? "No material gaps were flagged."
          : `${research.dataGaps.length} gaps were flagged: ${research.dataGaps.slice(0, 3).join("; ")}${research.dataGaps.length > 3 ? "; …" : ""}`,
      weight: 10,
    },
  ];

  const earned = inputs.reduce((total, input) => {
    if (input.status === "ok") return total + input.weight;
    if (input.status === "partial") return total + input.weight / 2;
    return total;
  }, 0);

  const score = Math.round(earned);
  const label = score >= 80 ? "Well evidenced" : score >= 55 ? "Partly evidenced" : "Thin evidence";

  return {
    score,
    label,
    inputs,
    gaps: research.dataGaps,
    measures: CONFIDENCE_MEASURES,
  };
}

/**
 * The touch's own status, derived from what happened rather than from the last button pressed.
 *
 * `Live` and `Completed` are the AM's own markers from the meeting itself and are never recomputed
 * here. Everything before the meeting is `Preparing` until the whole required preparation has run
 * without a blocker -- which is what stops a touch reading `Ready` while its notes were never
 * written or never reached ClickUp.
 */
export function deriveTouchStatus(
  touch: MonthlyTouchRecord,
  readiness: ReadinessBreakdown,
): MonthlyTouchRecord["status"] {
  if (touch.status === "Live" || touch.status === "Completed") return touch.status;
  return readiness.blockers.length === 0 && (readiness.score ?? 0) >= 95 ? "Ready" : "Preparing";
}

/** Which of the five run-sheet stages a touch is standing in, from its real state. */
export type RunSheetStage = "prep" | "review" | "live" | "follow_through" | "qa";

export function deriveRunSheetStage(touch: MonthlyTouchRecord): RunSheetStage {
  const qa = touch.qaReview;
  const post = touch.postMeeting;

  // Backwards: the furthest real evidence wins, so a touch never reads as earlier than it is.
  if (qa) return "qa";
  if (post && post.status !== "not_started") return "follow_through";
  if (touch.status === "Completed") return "follow_through";
  if (touch.status === "Live") return "live";

  const workflow = touch.prepWorkflow;
  if (!workflow) return "prep";
  const prepDone = workflow.stages.research.status === "complete";
  const notesDone = workflow.stages.prep_notes.status === "complete";
  const filed = workflow.stages.clickup_filing.status === "complete";
  if (prepDone && notesDone && filed) return "live";
  if (prepDone) return "review";
  return "prep";
}

/**
 * The board column a touch belongs in.
 *
 * Close to the run-sheet stage but not the same question: the board asks "where is this month's
 * meeting up to", so a prepared touch waiting for its call and one being presented both read as
 * Prepped, and Done means the meeting happened. Like the stage, it is read backwards from the
 * furthest real evidence, so a touch can never sit in a column earlier than the work it has.
 */
export type TouchBoardColumn = "not_prepped" | "prepped" | "done" | "follow_through" | "qa";

export const TOUCH_BOARD_COLUMNS: { id: TouchBoardColumn; label: string; hint: string }[] = [
  { id: "not_prepped", label: "Not prepped", hint: "The account review has not run or did not finish." },
  { id: "prepped", label: "Prepped", hint: "Preparation done; the call has not happened yet." },
  { id: "done", label: "Done", hint: "The meeting happened; the follow-through has not started." },
  { id: "follow_through", label: "Follow-through", hint: "Recap, tickets and notes in progress." },
  { id: "qa", label: "QA", hint: "Reviewed, or waiting on the QA decision." },
];

export function deriveBoardColumn(touch: MonthlyTouchRecord): TouchBoardColumn {
  if (touch.qaReview) return "qa";
  if (touch.postMeeting && touch.postMeeting.status !== "not_started") return "follow_through";
  if (touch.status === "Completed" || touch.status === "Live") return "done";
  return touch.prepWorkflow?.stages.research.status === "complete" ? "prepped" : "not_prepped";
}

/** What this stage's single primary action is, so the screen and the rules agree on one answer. */
export const RUN_SHEET_PRIMARY_ACTION: Record<RunSheetStage, { label: string; hint: string }> = {
  prep: { label: "Generate Preparation", hint: "Run the account review that everything else is built from." },
  review: {
    label: "Review Preparation",
    hint: "Read the findings, approve the client email and the notes, and file them in ClickUp.",
  },
  live: { label: "Start Live Meeting", hint: "Open the full-screen meeting view with your agenda and notes." },
  follow_through: {
    label: "Open Follow-through",
    hint: "Turn the recording into the recap, the tickets and the post-meeting notes.",
  },
  qa: { label: "Review and Approve QA", hint: "Read the QA review and record the decision." },
};
