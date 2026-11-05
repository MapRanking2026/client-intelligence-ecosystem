import { QC_CRITERION_COUNT } from "@/src/lib/contracts/qc-rubric";
import {
  type CoachingItem,
  type QcAiPreread,
  type QcAppealDecision,
  type QcAppealItem,
  type QcCriterionNote,
  type QcDraft,
  type QcDraftValue,
  type QcGoal,
  type QcRating,
  type QcScoreValue,
  applyAppealDecisions,
  isGraded,
  qcProgress,
  qcRating,
  qcScore,
} from "@/src/lib/contracts/qc-record";

/**
 * Turning a part-filled scoring form into a record, and an appeal into a new score.
 *
 * Pure, and separate from both the screen and the service, because this is where a reviewer's work
 * becomes a number in somebody's performance history. Everything here is a decision about what
 * gets written and what gets thrown away, and each one is a test rather than a judgement made in a
 * component at submit time.
 *
 * ## Why the submit bar lists what is missing
 *
 * `submitBlockers` returns the outstanding items by name. A disabled button with no reason is how
 * a form gets abandoned, and this one is disabled until seventeen separate decisions plus a goal
 * are made -- the single most likely place for a reviewer to get stuck and not know why.
 *
 * ## Empty is not a value
 *
 * A note the reviewer opened and typed nothing in is not stored, and a coaching card with no idea
 * in it is dropped. The AM's page renders what it finds: a blank "What we found" heading under a
 * criterion reads as QC having something to say and declining to say it, which is worse than the
 * criterion having no note at all.
 */

// ---------------------------------------------------------------------------
// Gating the submit
// ---------------------------------------------------------------------------

/**
 * What is still missing, in the AM-facing words the submit bar shows.
 *
 * Empty array means the form is submittable. The order is deliberate: criteria first, because that
 * is the bulk of the work, and the goal last because it is one click.
 */
export function submitBlockers(
  crit: readonly (QcDraftValue | undefined)[] | undefined,
  goal: QcGoal | undefined,
): string[] {
  const progress = qcProgress(crit, goal);
  const out: string[] = [];
  const left = progress.total - progress.decided;
  if (left > 0) out.push(`${left} ${left === 1 ? "criterion" : "criteria"} left`);
  if (!goal) out.push("set the client goal KPI");
  return out;
}

/**
 * The navy submit bar's hint line.
 *
 * Once complete it states the consequence rather than the state -- the reviewer is about to send a
 * score to a named colleague, and the bar is the last place to say so.
 */
export function submitHint(
  crit: readonly (QcDraftValue | undefined)[] | undefined,
  goal: QcGoal | undefined,
  amFirstName: string,
): string {
  const blockers = submitBlockers(crit, goal);
  if (blockers.length) return blockers.join(" · ");
  const score = qcScore(crit);
  const who = amFirstName || "The account manager";
  if (score === null) {
    // Every criterion marked N/A. Complete, and genuinely unscoreable: see `finalizeSubmission`.
    return `No criterion applied to this call · ${who} gets a notification with the coaching plan.`;
  }
  return `Score ${score} (${qcRating(score)}) · ${who} gets a notification with the breakdown and coaching plan.`;
}

// ---------------------------------------------------------------------------
// The AI pre-read
// ---------------------------------------------------------------------------

export interface AppliedSuggestions {
  crit: QcDraftValue[];
  notes: Record<number, QcCriterionNote>;
  goal?: QcGoal;
}

/**
 * "Apply all suggestions": fill only what the reviewer has not decided.
 *
 * Never overwrites. A reviewer who has graded six criteria and then presses this is asking for help
 * with the other eleven, not for their own six to be replaced by a model's -- and silently
 * replacing a human judgement with a suggested one is the way this feature would cause a wrong
 * score to be sent under somebody's name.
 *
 * A criterion the pre-read left as `null` is a criterion the model declined to grade, so it is
 * skipped rather than written as N/A. N/A is a decision, and this is the model having none.
 */
export function applyAllSuggestions(
  crit: readonly (QcDraftValue | undefined)[] | undefined,
  notes: Readonly<Record<number, QcCriterionNote>> | undefined,
  goal: QcGoal | undefined,
  ai: QcAiPreread | undefined,
): AppliedSuggestions {
  // `??` cannot be used here: `null` is a real value, meaning N/A, and only `undefined` means the
  // position was never filled. Coalescing the two would turn a reviewer's deliberate N/A back into
  // "undecided" and let the next suggestion overwrite it -- the one thing this function must not do.
  const nextCrit: QcDraftValue[] = Array.from({ length: QC_CRITERION_COUNT }, (_, index) => {
    const value = crit?.[index];
    return value === undefined ? -1 : value;
  });
  const nextNotes: Record<number, QcCriterionNote> = { ...(notes || {}) };

  if (ai) {
    for (let index = 0; index < QC_CRITERION_COUNT; index += 1) {
      const suggestion = ai.crit[index];
      if (!isGraded(suggestion as QcDraftValue)) continue;
      if (nextCrit[index] !== -1) continue;
      nextCrit[index] = suggestion;
      const evidence = ai.evidence[index]?.trim();
      const existing = nextNotes[index + 1];
      if (evidence && !existing?.found?.trim()) {
        nextNotes[index + 1] = { ...(existing || {}), found: evidence };
      }
    }
  }

  return {
    crit: nextCrit,
    notes: nextNotes,
    ...(goal || ai?.goal ? { goal: goal || ai?.goal } : {}),
  };
}

/**
 * The note a criterion gets when the reviewer picks a score and has written nothing yet.
 *
 * Pre-filling "found" from the pre-read's evidence line saves retyping a timestamp the model
 * already located. It fills only a blank: a reviewer's own words are never replaced.
 */
export function prefillFound(
  existing: QcCriterionNote | undefined,
  evidenceLine: string | undefined,
): QcCriterionNote | undefined {
  const evidence = evidenceLine?.trim();
  if (!evidence) return existing;
  if (existing?.found?.trim()) return existing;
  return { ...(existing || {}), found: evidence };
}

/** Notes open by themselves at 3 or below: a low score without a reason is not reviewable. */
export const NOTES_OPEN_AT_OR_BELOW = 3;

export function notesShouldOpen(value: QcDraftValue | undefined): boolean {
  return isGraded(value) && value <= NOTES_OPEN_AT_OR_BELOW;
}

// ---------------------------------------------------------------------------
// Finalising
// ---------------------------------------------------------------------------

/** Trimmed notes, with anything empty removed. Keyed by criterion number, as stored. */
export function cleanNotes(
  notes: Readonly<Record<number, QcCriterionNote>> | undefined,
): Record<number, QcCriterionNote> {
  const out: Record<number, QcCriterionNote> = {};
  for (const [key, note] of Object.entries(notes || {})) {
    const found = note?.found?.trim();
    const next = note?.next?.trim();
    if (!found && !next) continue;
    out[Number(key)] = { ...(found ? { found } : {}), ...(next ? { next } : {}) };
  }
  return out;
}

/** Coaching cards with an actual idea, trimmed. An empty card is dropped, as the handoff says. */
export function cleanCoaching(items: readonly CoachingItem[] | undefined): CoachingItem[] {
  return (items || [])
    .filter((item) => item.idea?.trim())
    .map((item) => ({
      idea: item.idea.trim(),
      why: (item.why || "").trim(),
      how: (item.how || "").trim(),
      skip: (item.skip || "").trim(),
    }));
}

export interface QcSubmission {
  crit: QcScoreValue[];
  notes: Record<number, QcCriterionNote>;
  goal: QcGoal;
  strengths?: string;
  focus?: string;
  coaching: CoachingItem[];
  /** Null when every criterion was marked N/A. The caller then stores no score at all. */
  score: number | null;
  rating?: QcRating;
}

/**
 * The record a submit writes, from the draft the reviewer filled in.
 *
 * Undecided criteria cannot reach here -- the button is gated on `submitBlockers` and the route
 * checks it again -- but an undecided value is folded to N/A rather than trusted, because the
 * alternative is writing `-1` into a scored record where every reader expects 1-5 or null.
 *
 * An all-N/A submission keeps `score: null` and no rating. It is a real outcome (a call that was
 * cut short, say) and the honest record of it is a dash, not a zero and not a D.
 */
export function finalizeSubmission(draft: {
  crit: readonly (QcDraftValue | undefined)[];
  notes?: Readonly<Record<number, QcCriterionNote>>;
  goal: QcGoal;
  strengths?: string;
  focus?: string;
  coaching?: readonly CoachingItem[];
}): QcSubmission {
  const crit: QcScoreValue[] = Array.from({ length: QC_CRITERION_COUNT }, (_, index) => {
    const value = draft.crit[index];
    return isGraded(value) ? value : null;
  });
  const score = qcScore(crit);
  const strengths = draft.strengths?.trim();
  const focus = draft.focus?.trim();

  return {
    crit,
    notes: cleanNotes(draft.notes),
    goal: draft.goal,
    ...(strengths ? { strengths } : {}),
    ...(focus ? { focus } : {}),
    coaching: cleanCoaching(draft.coaching),
    score,
    ...(score === null ? {} : { rating: qcRating(score) }),
  };
}

/** A draft to store. `savedAt` is the caller's clock so the service and the record agree. */
export function draftToStore(
  draft: {
    crit: readonly (QcDraftValue | undefined)[];
    notes?: Readonly<Record<number, QcCriterionNote>>;
    goal?: QcGoal;
    strengths?: string;
    focus?: string;
    coaching?: readonly CoachingItem[];
  },
  savedAt: string,
): QcDraft {
  return {
    // Same distinction as in `applyAllSuggestions`: an N/A is `null` and survives the round trip,
    // while a position the form never filled is `undefined` and stores as undecided.
    crit: Array.from({ length: QC_CRITERION_COUNT }, (_, index) => {
      const value = draft.crit[index];
      return value === undefined ? -1 : value;
    }),
    notes: cleanNotes(draft.notes),
    ...(draft.goal ? { goal: draft.goal } : {}),
    ...(draft.strengths ? { strengths: draft.strengths } : {}),
    ...(draft.focus ? { focus: draft.focus } : {}),
    ...(draft.coaching ? { coaching: cleanCoaching(draft.coaching) } : {}),
    savedAt,
  };
}

// ---------------------------------------------------------------------------
// Appeals
// ---------------------------------------------------------------------------

export interface QcAppealPreview {
  from: number | null;
  to: number | null;
  rating?: QcRating;
  /** True when nothing was accepted, so the bar can say the score stays as it was. */
  unchanged: boolean;
}

/**
 * What the appeal bar previews: the score now, and the score the current decisions would produce.
 *
 * Computed from the criteria rather than from the decisions' arithmetic, so the preview and the
 * saved result come from the same function. A preview that said "80 → 84" and then stored 83 would
 * be a promise broken in writing to the AM.
 */
export function appealPreview(
  crit: readonly QcScoreValue[] | undefined,
  decisions: readonly QcAppealDecision[],
): QcAppealPreview {
  const from = qcScore(crit);
  if (!crit) return { from, to: null, unchanged: true };
  const next = applyAppealDecisions(crit, decisions);
  const to = qcScore(next);
  return {
    from,
    to,
    ...(to === null ? {} : { rating: qcRating(to) }),
    unchanged: from === to,
  };
}

/** Every appealed criterion needs a decision before the reply can be sent. */
export function appealDecisionsComplete(
  items: readonly QcAppealItem[],
  decisions: readonly QcAppealDecision[],
): boolean {
  if (!items.length) return false;
  return items.every((item) => decisions.some((decision) => decision.n === item.n));
}

/** "Score 80 → 84 (B)", or "Score stays 80" when nothing was accepted. */
export function appealPreviewLabel(preview: QcAppealPreview): string {
  if (preview.from === null) return "No score on this touch";
  if (preview.unchanged || preview.to === null) return `Score stays ${preview.from}`;
  return `Score ${preview.from} → ${preview.to}${preview.rating ? ` (${preview.rating})` : ""}`;
}
