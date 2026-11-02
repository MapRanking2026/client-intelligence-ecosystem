/**
 * One approval, four outward steps.
 *
 * The review step ends in a single button, and that button does four things that leave the
 * application: it records the approval, sends the client an email, writes a page into the client's
 * ClickUp book, and builds the call. The handoff is explicit that this is one click, and it is
 * right -- four buttons is four chances to stop halfway and no way to tell afterwards which of them
 * actually happened.
 *
 * But one click over four outward writes needs a record, or a retry becomes a second email in the
 * client's inbox. So each step stores its own outcome, every step is idempotent against that
 * record, and a run that fails at step 2 resumes at step 2 rather than starting again. The three
 * states are kept apart on purpose:
 *
 *   - `done`     the write happened and we hold its identifier.
 *   - `skipped`  it was deliberately not done (a declined email), which is not a failure.
 *   - `failed`   it was attempted and did not succeed, and is safe to attempt again.
 *
 * Pure: no Firestore, no ClickUp, no Intercom, so the ordering and the resume rules can be
 * exercised directly.
 */

export const APPROVAL_STEPS = ["approve", "email", "book", "build"] as const;

export type ApprovalStepId = (typeof APPROVAL_STEPS)[number];

export type ApprovalStepStatus = "pending" | "running" | "done" | "skipped" | "failed";

export const APPROVAL_STEP_LABEL: Record<ApprovalStepId, string> = {
  approve: "Brief approved",
  email: "Agenda email sent",
  book: "Brief posted to the Client's Book",
  build: "Call prepared",
};

export interface ApprovalStepState {
  status: ApprovalStepStatus;
  /** Plain English, written for the AM: what happened, or what to do about it not happening. */
  detail?: string;
  at?: string;
}

/** The page the approved brief was written to, kept so a retry edits it instead of adding a second. */
export interface ApprovedBookPage {
  docId: string;
  pageId: string;
  pageUrl: string;
  pageName: string;
  /** Which folder and page it went to, so the AM can confirm it is the right client. */
  destination: string;
}

export interface TouchApprovalState {
  steps: Record<ApprovalStepId, ApprovalStepState>;
  clientBook?: ApprovedBookPage;
  startedAt?: string;
  /** Set only when all four steps have reached `done` or `skipped`. */
  finishedAt?: string;
  approvedBy?: string;
  updatedAt?: string;
}

export function emptyApprovalState(): TouchApprovalState {
  return {
    steps: {
      approve: { status: "pending" },
      email: { status: "pending" },
      book: { status: "pending" },
      build: { status: "pending" },
    },
  };
}

/** A step that has already finished one way or the other is never run again. */
export function stepIsSettled(state: ApprovalStepState | undefined): boolean {
  return state?.status === "done" || state?.status === "skipped";
}

/**
 * The first step this run has to do, or `undefined` when the approval is complete.
 *
 * Order is fixed and gaps are not skipped over: the Client's Book post and the call are both built
 * from the approved sections, so step 1 has to have happened. A failed earlier step is returned
 * again rather than passed, because carrying on past it would file a brief nobody approved.
 */
export function nextApprovalStep(state: TouchApprovalState | undefined): ApprovalStepId | undefined {
  const steps = state?.steps;
  return APPROVAL_STEPS.find((id) => !stepIsSettled(steps?.[id]));
}

export function approvalIsComplete(state: TouchApprovalState | undefined): boolean {
  return Boolean(state) && nextApprovalStep(state) === undefined;
}

/** True when some steps landed and others did not -- the state a retry exists for. */
export function approvalIsPartial(state: TouchApprovalState | undefined): boolean {
  if (!state) return false;
  const values = APPROVAL_STEPS.map((id) => state.steps[id]);
  return values.some(stepIsSettled) && values.some((step) => !stepIsSettled(step));
}

export interface ApprovalPlanOptions {
  /** How many brief sections are not declined. */
  approving: number;
  /** The declined section numbers, as the AM sees them. */
  declined: string[];
  /** False when the agenda email is declined, or when there is nothing sendable. */
  sendingEmail: boolean;
  /** Who the email goes to, for the line that names them. Empty when unknown. */
  recipient: string;
  /** `guide` builds the timed run-sheet, `deck` builds the client presentation. */
  format: "guide" | "deck";
  /** The Client's Book page this will write, e.g. `Pre-Monthly Touch Notes 11/5/2026`. */
  pageName: string;
}

/**
 * What the button will do, in the AM's words, before they press it.
 *
 * Written from the same values the service uses, so the promise and the action cannot drift. The
 * page name is stated because the AM is the only one who can tell that the brief is about to be
 * filed under the wrong date.
 */
export function approvalPlan(options: ApprovalPlanOptions): string[] {
  const total = options.approving + options.declined.length;
  return [
    options.declined.length
      ? `Approve the ${options.approving} of ${total} brief sections you didn't decline — sections ${options.declined.join(", ")} stay out of everything below.`
      : `Approve all ${options.approving} brief sections.`,
    options.sendingEmail
      ? `Send the agenda email${options.recipient ? ` to ${options.recipient}` : ""} from support@mapranking.com through your own Intercom, so the reply comes back to you.`
      : "Not send the agenda email — you declined it, so the client is told nothing.",
    `Post the approved brief to the client's Client's Book in ClickUp, as "${options.pageName}" under Client Meetings Notes. The post-call write-up goes inside that page after the call.`,
    options.format === "deck"
      ? "Build the Map Ranking client presentation and your presenter script from the approved sections."
      : "Build your timed call guide from the approved sections.",
  ];
}

/** The one-line summary under the button. */
export function approvalHint(options: { approving: number; declined: string[]; finishedAt?: string }): string {
  if (options.finishedAt) return `Approved and prepared ${options.finishedAt}.`;
  const total = options.approving + options.declined.length;
  return options.declined.length
    ? `${options.approving} of ${total} sections will be approved · ${options.declined.length} declined`
    : `All ${total} sections will be approved`;
}
