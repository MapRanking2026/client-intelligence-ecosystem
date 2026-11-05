import type { ClientAction, NotesDraft } from "@/src/lib/contracts/follow-through-notes";
import { notesBlockers } from "@/src/lib/contracts/follow-through-notes";
import {
  itemBlockers,
  type FollowThroughItem,
} from "@/src/lib/contracts/follow-through-tickets";
import {
  recapBlockers,
  type RecapEmailState,
} from "@/src/lib/contracts/follow-through-recap-email";
import {
  trackerBlockers,
  type FieldDiff,
  type TrackerCard,
} from "@/src/lib/contracts/follow-through-trackers";

/**
 * The last screen: what has to be decided before anything leaves MTOS, and what happens then.
 *
 * Everything on the follow-through is a draft until this button. Pressing it is the single human
 * approval the whole step is built around -- after it, tickets exist in ClickUp, a page is
 * written in the Client's Book, two tracker rows change and an email reaches the client. So the
 * gate is deliberately strict in one direction only: every item must be *decided*, and only the
 * approved ones must be *complete*. Denying something is a decision and costs nothing to make.
 *
 * The notes themselves carry no separate approval. Pressing Finish approves them, because an AM
 * who has edited six sections and is looking at the preview has already approved them, and a
 * second confirmation on the same screen is the kind that gets clicked without reading.
 */

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export interface FinishInputs {
  notes?: NotesDraft;
  items?: FollowThroughItem[];
  trackerCards?: TrackerCard[];
  trackerDiffs?: Record<string, FieldDiff[]>;
  recap?: RecapEmailState;
  recapGaps?: string[];
}

/** Everything still standing between the AM and the button, in their own words. */
export function finishBlockers(input: FinishInputs): string[] {
  const blockers: string[] = [];

  if (!input.notes) {
    blockers.push("Draft the notes. Everything else is filed against them.");
    return blockers;
  }

  blockers.push(...notesBlockers(input.notes));

  // A client action creates no ticket, but it goes into the recap email as something the client
  // agreed to -- so it is a decision, not a line of prose.
  const undecidedClientActions = input.notes.clientActions.filter((action) => !action.decision).length;
  if (undecidedClientActions) {
    blockers.push(
      `Decide the remaining ${undecidedClientActions === 1 ? "client action" : `${undecidedClientActions} client actions`} in section 5.`,
    );
  }

  if (!input.items) {
    blockers.push("Build the tickets from the notes.");
  } else {
    blockers.push(...itemBlockers(input.items));
  }

  if (!input.trackerCards?.length) {
    blockers.push("Build the tracker rows.");
  } else {
    blockers.push(...trackerBlockers(input.trackerCards, input.trackerDiffs || {}));
  }

  blockers.push(...recapBlockers(input.recap, input.recapGaps || []));

  return blockers;
}

/** The decisions "Approve all remaining" would make, so the button can say how many. */
export function remainingCount(input: FinishInputs): number {
  const items = (input.items || []).filter((item) => !item.decision).length;
  const cards = (input.trackerCards || []).filter((card) => !card.decision).length;
  const actions = (input.notes?.clientActions || []).filter((action) => !action.decision).length;
  const recap = input.recap && !input.recap.decision ? 1 : 0;
  return items + cards + actions + recap;
}

/** Only the client actions the AM approved reach the notes and the recap. */
export function approvedClientActions(actions: ClientAction[]): ClientAction[] {
  return actions.filter((action) => action.decision === "approved");
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

export type StepStatus = "pending" | "running" | "done" | "skipped" | "warning" | "failed";

export interface ProcessingStep {
  id: string;
  label: string;
  /** What it does, shown under the label while it runs. */
  detail: string;
}

/**
 * The seven steps, in the only order they can run in.
 *
 * Tickets first because the notes quote their links; the notes before the trackers so the filed
 * document exists even if a tracker write fails; the email after everything it describes is real;
 * the channel post after the email so the team sees what the client already has; and the booking
 * last because it is the only one that can be done by hand in thirty seconds.
 */
export const PROCESSING_STEPS: ProcessingStep[] = [
  {
    id: "tickets",
    label: "Create the approved tickets in ClickUp",
    detail: "Team tickets, pending drafts and any billing change. Each one's id is stored, so a retry never files it twice.",
  },
  {
    id: "notes",
    label: "File the notes in the Client's Book",
    detail: "Sections 1 to 6, approved items only, with each action line ending in its ticket link.",
  },
  {
    id: "risk",
    label: "Log the Risk Register row and tag the Manager",
    detail: "Only when the score is 6 or below and the row was approved.",
  },
  {
    id: "health",
    label: "Update the Health Tracker and Stakeholder Map",
    detail: "The approved row changes, and nothing that was not approved.",
  },
  { id: "recap", label: "Send the recap email", detail: "Through your own Intercom, to the client contact." },
  {
    id: "channel",
    label: "Post the brief in the client channel",
    detail: "And @-tag the people who now own a ticket.",
  },
  {
    id: "booking",
    label: "Book the next Monthly Touch",
    detail: "On both calendars. Without Calendar write access this is skipped and a reminder ticket is created instead.",
  },
];

export interface StepResult {
  id: string;
  status: StepStatus;
  /** What happened, in one line. Always written -- a step with no message reads as a mystery. */
  message: string;
}

export interface ProcessingResult {
  steps: StepResult[];
  /** Created ticket urls by item id, so each row can show its link afterwards. */
  ticketUrls?: Record<string, string>;
  notesPageUrl?: string;
  processedAt?: string;
  /**
   * What happened when the touch was handed to QC.
   *
   * Carried on the result rather than added as an eighth step, because it is not one of the
   * outward writes the AM approved item by item: they did not choose to send this to QC, finishing
   * the follow-through is what sends it. Reporting it as a step would put it in the same list as
   * the ticket that failed to create, and invite the AM to retry something that needs no retry.
   */
  qc?: QcHandoffSummary;
}

/** The handoff's outcome in the AM's own words. `created` is false on a re-run. */
export interface QcHandoffSummary {
  created: boolean;
  /** How many reviewers were notified. Zero is a real answer and is said plainly. */
  notified: number;
  message: string;
}

/** Whether the run as a whole left anything the AM still has to do. */
export function processingOutcome(steps: StepResult[]): "processed" | "partial" | "failed" {
  if (steps.some((step) => step.status === "failed")) return "failed";
  if (steps.some((step) => step.status === "warning")) return "partial";
  return "processed";
}

/** The banner's sentence for a finished run. */
export function processingSummary(steps: StepResult[]): string {
  const outcome = processingOutcome(steps);
  const warnings = steps.filter((step) => step.status === "warning" || step.status === "failed");
  if (outcome === "processed") {
    return "Processed. Everything you approved has been created, filed and sent.";
  }
  if (outcome === "partial") {
    return `Processed, with ${warnings.length === 1 ? "one step" : `${warnings.length} steps`} that need you: ${warnings
      .map((step) => step.message)
      .join(" ")}`;
  }
  return `Something did not go through: ${warnings.map((step) => step.message).join(" ")} Nothing that already succeeded will be repeated if you run it again.`;
}
