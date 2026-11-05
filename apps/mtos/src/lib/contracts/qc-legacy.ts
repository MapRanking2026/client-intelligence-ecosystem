import type { QaReview } from "@/src/lib/mtos-data";

/**
 * The old A-F QA review, kept readable and kept apart (handoff §6.10).
 *
 * Before QC there was a seven-category scorecard graded A to F, approved by one person by name.
 * It is not deleted and not migrated: touches that have one keep it, and every screen that showed
 * it still shows it. What changes is that it is now **labelled**, because the one thing that must
 * never happen is somebody reading an old grade as a new score.
 *
 * ## Why a label rather than a conversion
 *
 * The two do not measure the same thing. The old scorecard has seven categories; the new rubric
 * has seventeen and three KPIs. There is no honest arithmetic from one to the other, so there is
 * no conversion here and there never should be -- a "B" from the old system placed on the AM's
 * trend line beside an 84 would be a number nobody computed, averaged into their KPIs.
 *
 * So a legacy touch shows its grade with a "Legacy QA" tag and no 17-point breakdown, and it is
 * never averaged with a QC score.
 *
 * ## One flow at a time
 *
 * A touch that has gone to QC must not also get an A-F review. Two grades on one call, by two
 * different instruments, with two different people entitled to argue about them, is worse than
 * either alone. `legacyQaBlockedReason` is the single rule, checked on the server as well as used
 * to hide the button -- the screen is a courtesy and the server is the guarantee.
 */

/** The tag shown wherever an A-F grade appears. One string, so every screen says the same thing. */
export const LEGACY_QA_TAG = "Legacy QA";

/** What the tag means, for a tooltip or a line under a card. */
export const LEGACY_QA_EXPLAINER =
  "Graded under the earlier 7-category A–F review, before the 17-point QC rubric. It is kept as it was and is not part of QC averages.";

/** Whether this touch carries an old-style review. */
export function hasLegacyQa(touch: { qaReview?: QaReview } | undefined): boolean {
  return Boolean(touch?.qaReview);
}

/** Whether this touch has gone into the new QC flow. */
export function hasQc(touch: { qc?: unknown } | undefined): boolean {
  return Boolean(touch?.qc);
}

/**
 * Why a new A-F review cannot be generated for this touch, or undefined when it can.
 *
 * A sentence rather than a boolean, because this is shown to the person who pressed the button.
 * "Disabled" with no reason is the thing people file bugs about.
 */
export function legacyQaBlockedReason(touch: { qc?: unknown } | undefined): string | undefined {
  if (!hasQc(touch)) return undefined;
  return "This touch is scored by QC against the 17-point rubric, so the older A–F review does not run on it.";
}

/** Whether the Generate / Approve controls should be offered at all. */
export function canRunLegacyQa(touch: { qc?: unknown } | undefined): boolean {
  return !legacyQaBlockedReason(touch);
}

/**
 * The grade to show for a legacy touch, with its tag.
 *
 * Returns the grade as it was stored, including `F` -- the new rubric has no F, and rewriting an
 * old grade to fit a scale it was not given on would be falsifying a record. A touch with a review
 * but no grade shows a dash rather than an empty space, so the row still reads as a row.
 */
export function legacyGradeLabel(review: QaReview | undefined): string {
  if (!review) return "—";
  return review.overallGrade || "—";
}

/** The status of an old review in plain words. The stored values are snake_case internals. */
export function legacyStatusLabel(review: QaReview | undefined): string {
  const status = review?.status;
  if (!status || status === "not_started") return "Not reviewed";
  if (status === "pending_victor_approval") return "Waiting on approval";
  if (status === "approved") return "Approved";
  if (status === "changes_requested") return "Changes requested";
  return status;
}

/**
 * The one-line summary a legacy row shows beside its grade.
 *
 * Always says it is legacy. A row reading "B · Approved" next to a row reading "84 (B)" is exactly
 * the confusion this file exists to prevent.
 */
export function legacyRowLabel(review: QaReview | undefined): string {
  return `${LEGACY_QA_TAG} · ${legacyGradeLabel(review)} · ${legacyStatusLabel(review)}`;
}
