import {
  QC_CRITERION_COUNT,
  QC_POST_TOUCH_CRITERION,
  QC_PREP_CRITERION,
  QC_RUBRIC_VERSION,
} from "@/src/lib/contracts/qc-rubric";

/**
 * A QC record: what a scored Monthly Touch stores, and the arithmetic behind the number.
 *
 * Pure. Nothing here reads Firestore or knows about a screen, because this is the half of QC that
 * has to be right rather than merely look right. A score is shown to the Account Manager who
 * earned it, kept in their history, averaged into their KPIs and argued about in appeals, so the
 * same inputs must always produce the same number.
 *
 * ## Three decisions worth stating
 *
 * **N/A is not zero.** A criterion that did not apply to this call is excluded from both the sum
 * and the count, so it neither helps nor hurts. Counting it as zero would punish an AM for a call
 * that had no ads to discuss, and counting it as five would hand out marks for nothing.
 *
 * **A record with nothing graded has no score at all.** `qcScore` returns `null`, not 0, and the
 * screens show a dash. An unscored touch displayed as "0" reads as a catastrophic review, which is
 * the single most damaging thing this file could get wrong.
 *
 * **There is no F.** The ratings stop at D, deliberately: this is a coaching instrument, and the
 * old A-F QA grade it replaces is still readable on older touches (see `qaReview`, untouched).
 */

// ---------------------------------------------------------------------------
// The stored shape
// ---------------------------------------------------------------------------

export type QcStatus =
  | "ready"
  | "in_progress"
  | "scored"
  | "reviewed"
  | "appealed"
  | "appeal_resolved";

/** A-D. No F; see the note above. */
export type QcRating = "A" | "B" | "C" | "D";

export type QcGoal = "Yes" | "Partial" | "No" | "N/A";

/** A graded criterion is 1-5; `null` means N/A, which is excluded from the score. */
export type QcScoreValue = 1 | 2 | 3 | 4 | 5 | null;

/**
 * A criterion in a saved draft, where `-1` means "the reviewer has not decided yet".
 *
 * The third state exists because `null` already means N/A, which is a decision. Without `-1` a
 * half-finished draft would be indistinguishable from one where the reviewer had deliberately
 * marked everything as not applicable, and the submit button would unlock on an empty form.
 */
export type QcDraftValue = QcScoreValue | -1;

export interface QcEvidenceRow {
  label: string;
  detail: string;
  ok: boolean;
}

/**
 * One coaching proposal. Never an order -- the AM decides whether to use it.
 *
 * `skip` is required reading rather than a nicety: a coaching idea with no stated exception is one
 * an AM will follow into a call where it is wrong.
 */
export interface CoachingItem {
  idea: string;
  /** Which call, when, what happened, and what it cost. Enough for someone who was not there. */
  why: string;
  /** An example line to adapt, not a script. */
  how: string;
  skip: string;
}

/** Per-criterion notes. Both halves optional: a reviewer may record a find with no advice. */
export interface QcCriterionNote {
  /** What we found, with a timestamp and a quote. */
  found?: string;
  /** What to do differently next time. */
  next?: string;
}

export interface QcAiPreread {
  crit: QcScoreValue[];
  /** One line per criterion: `hh:mm:ss — what happened`, or a fact from the evidence. */
  evidence: string[];
  goal: QcGoal;
  strengths: string;
  focus: string;
  coaching: CoachingItem[];
  generatedAt: string;
  model: string;
}

export interface QcDraft {
  crit: QcDraftValue[];
  notes: Record<number, QcCriterionNote>;
  goal?: QcGoal;
  strengths?: string;
  focus?: string;
  coaching?: CoachingItem[];
  savedAt: string;
}

export interface QcAppealItem {
  /** Criterion number. */
  n: number;
  /** The score the AM is asking for. Always above the one given. */
  to: number;
  /** What QC did not see. The AM's own words. */
  ctx: string;
  link?: string;
}

export interface QcAppealDecision {
  n: number;
  to: number;
  accept: boolean;
}

export interface QcAppeal {
  status: "open" | "resolved";
  submittedAt: string;
  items: QcAppealItem[];
  note?: string;
  decisions?: QcAppealDecision[];
  reply?: string;
  /** The score before the appeal, and after it. Kept so "80 → 84" survives a later rubric change. */
  from: number;
  to?: number;
  resolvedAt?: string;
  resolvedBy?: string;
}

/**
 * Everything QC holds about one touch.
 *
 * Added alongside `qaReview`, never replacing it: the old 7-category A-F grade stays readable on
 * the touches that have it (handoff §6.10).
 */
export interface TouchQc {
  status: QcStatus;
  /** The rubric these labels and positions came from. Never recomputed from the current rubric. */
  rubricVersion: string;
  readyAt: string;
  startedAt?: string;
  reviewerId?: string;
  /** The §6.2 snapshot, taken when the AM pressed Finish and never recomputed afterwards. */
  evidence: QcEvidenceRow[];
  tickets: number;
  /**
   * How long the call actually ran, from the recorded start and end.
   *
   * Optional, which is a deliberate departure from the handoff's `callLengthMin: number`. A touch
   * whose call was never clocked -- the AM forgot to press start, or the call happened on a day
   * MTOS was not open -- has no length, and the queue must show a dash for it. Stored as 0 it
   * would read as a call that lasted no time at all, and criterion 16 is partly about length.
   */
  callLengthMin?: number;
  ai?: QcAiPreread;
  draft?: QcDraft;
  crit?: QcScoreValue[];
  notes?: Record<number, QcCriterionNote>;
  goal?: QcGoal;
  strengths?: string;
  focus?: string;
  coaching?: CoachingItem[];
  score?: number;
  rating?: QcRating;
  scoredAt?: string;
  scoredBy?: string;
  acknowledgedAt?: string;
  chatRequestedAt?: string;
  appeal?: QcAppeal;
}

/**
 * The index document per QC item, at `tenants/{t}/qcItems/{touchId}`.
 *
 * It exists for one reason: quota. The queue, the Scored tab, the Team cards and the AM's history
 * all need to list QC items, and every touch document carries a whole preparation pack. Reading
 * them to find out which are waiting would cost megabytes and thousands of reads a day, and this
 * app has already had deploys fail on the Firestore daily read limit. Every field here is one a
 * list needs; anything a list does not need stays on the touch.
 */
export interface QcIndexRow {
  touchId: string;
  status: QcStatus;
  /** The AM who ran the touch. The AM pages filter on this. */
  amId: string;
  clientId: string;
  /** The client's display name, denormalised so a queue of twenty rows is not twenty client reads. */
  client: string;
  /** The touch's scheduled date, for ordering and for the "{client} · {date}" line. */
  date?: string;
  score?: number;
  readyAt: string;
}

// ---------------------------------------------------------------------------
// The arithmetic
// ---------------------------------------------------------------------------

/** An empty set of criteria, every one undecided. The starting point for a draft. */
export function emptyDraftCrit(): QcDraftValue[] {
  return Array.from({ length: QC_CRITERION_COUNT }, () => -1 as QcDraftValue);
}

/** Whether a value is a real 1-5 grade, as opposed to N/A or undecided. */
export function isGraded(value: QcDraftValue | undefined): value is 1 | 2 | 3 | 4 | 5 {
  return typeof value === "number" && value >= 1 && value <= 5;
}

/**
 * The score out of 100, or `null` when nothing has been graded.
 *
 * `null` is the important return. Callers must show a dash for it rather than a zero.
 */
export function qcScore(crit: readonly (QcDraftValue | undefined)[] | undefined): number | null {
  if (!crit) return null;
  const graded = crit.filter(isGraded);
  if (!graded.length) return null;
  const sum = graded.reduce((total, value) => total + value, 0);
  return Math.round((sum / (graded.length * 5)) * 100);
}

/** A ≥ 90 · B 80-89 · C 70-79 · D below 70. */
export function qcRating(score: number): QcRating {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  return "D";
}

/** The overall target every touch is measured against. */
export const QC_SCORE_TARGET = 80;
/** A KPI criterion is met at 4 or 5. */
export const QC_KPI_TARGET = 4;

export type QcTone = "good" | "watch" | "risk";

/** The band a score falls in: at or above target, within ten of it, or below that. */
export function qcTone(score: number): QcTone {
  if (score >= QC_SCORE_TARGET) return "good";
  if (score >= 70) return "watch";
  return "risk";
}

export interface QcProgress {
  /** Criteria with a decision -- a grade or an explicit N/A. */
  decided: number;
  total: number;
  /** True once every criterion is decided **and** the goal is set. Gates the submit button. */
  complete: boolean;
}

/**
 * How far through the 17 a reviewer is.
 *
 * N/A counts as decided, because it is one. The goal is part of completeness rather than a separate
 * check, so the submit bar and the button can never disagree about whether the form is finished.
 */
export function qcProgress(
  crit: readonly (QcDraftValue | undefined)[] | undefined,
  goal: QcGoal | undefined,
): QcProgress {
  const total = QC_CRITERION_COUNT;
  const values = crit || [];
  let decided = 0;
  for (let index = 0; index < total; index += 1) {
    const value = values[index];
    if (value === null || isGraded(value)) decided += 1;
  }
  return { decided, total, complete: decided === total && Boolean(goal) };
}

export interface QcKpiSummary {
  /** Criterion 1, or null when it was marked N/A or never graded. */
  prep: number | null;
  /** Criterion 17, same. */
  postTouch: number | null;
  goal?: QcGoal;
  /** Whether each scored KPI is at 4+. A KPI with no grade is not "met". */
  prepMet: boolean;
  postTouchMet: boolean;
  /** Only `Yes` counts as the goal KPI being met. `Partial` is explicitly not a pass. */
  goalMet: boolean;
}

/** The three KPIs, read by position from the stored criteria plus the separate goal field. */
export function qcKpis(
  crit: readonly (QcDraftValue | undefined)[] | undefined,
  goal: QcGoal | undefined,
): QcKpiSummary {
  const at = (n: number) => {
    const value = crit?.[n - 1];
    return isGraded(value) ? value : null;
  };
  const prep = at(QC_PREP_CRITERION);
  const postTouch = at(QC_POST_TOUCH_CRITERION);
  return {
    prep,
    postTouch,
    ...(goal ? { goal } : {}),
    prepMet: prep !== null && prep >= QC_KPI_TARGET,
    postTouchMet: postTouch !== null && postTouch >= QC_KPI_TARGET,
    goalMet: goal === "Yes",
  };
}

/**
 * Apply an appeal's accepted decisions to the stored criteria.
 *
 * Returns a new array; the caller recomputes the score from it. A declined item leaves the
 * original score exactly as it was, and a decision for a criterion number the rubric no longer has
 * is ignored rather than written past the end of the array.
 */
export function applyAppealDecisions(
  crit: readonly QcScoreValue[],
  decisions: readonly QcAppealDecision[],
): QcScoreValue[] {
  const next = [...crit];
  for (const decision of decisions) {
    if (!decision.accept) continue;
    const index = decision.n - 1;
    if (index < 0 || index >= next.length) continue;
    if (!isGraded(decision.to as QcDraftValue)) continue;
    next[index] = decision.to as QcScoreValue;
  }
  return next;
}

/**
 * A fresh QC record for a touch that has just finished its follow-through.
 *
 * `rubricVersion` is stamped here, once, from the rubric in force at handoff. Nothing later
 * re-reads it, which is what keeps an old score labelled the way it was graded.
 */
export function newQcRecord(input: {
  readyAt: string;
  evidence: QcEvidenceRow[];
  tickets: number;
  callLengthMin?: number;
}): TouchQc {
  return {
    status: "ready",
    rubricVersion: QC_RUBRIC_VERSION,
    readyAt: input.readyAt,
    evidence: input.evidence,
    tickets: input.tickets,
    // Omitted rather than zeroed when the call was never clocked. See the field's own note.
    ...(typeof input.callLengthMin === "number" ? { callLengthMin: input.callLengthMin } : {}),
  };
}

/**
 * The call's length in whole minutes, or undefined when it cannot be known.
 *
 * Both ends have to be readable and in the right order. A negative span means the two timestamps
 * disagree, and the honest answer to that is "unknown" rather than a number derived from an
 * obvious error.
 */
export function callLengthMinutes(
  startedAt: string | undefined,
  endedAt: string | undefined,
): number | undefined {
  if (!startedAt || !endedAt) return undefined;
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return undefined;
  return Math.round((end - start) / 60_000);
}

/**
 * How long a touch has been waiting for QC, in whole hours.
 *
 * Over 24 the queue shows it in red. Returns null when the record has no readable `readyAt`, so an
 * unreadable date shows as nothing rather than as a touch that has been waiting since 1970.
 */
export function qcWaitingHours(readyAt: string | undefined, now: Date = new Date()): number | null {
  if (!readyAt) return null;
  const ready = new Date(readyAt);
  if (Number.isNaN(ready.getTime())) return null;
  const hours = Math.floor((now.getTime() - ready.getTime()) / 3_600_000);
  return hours < 0 ? 0 : hours;
}
