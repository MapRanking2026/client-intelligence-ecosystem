import {
  QC_POST_TOUCH_CRITERION,
  QC_PREP_CRITERION,
  QC_RUBRIC,
  criterionByNumber,
} from "@/src/lib/contracts/qc-rubric";
import { isGraded, type QcIndexRow } from "@/src/lib/contracts/qc-record";
import { isQueued, isScored } from "@/src/lib/contracts/qc-queue";

/**
 * The Team tab: one card per Account Manager, built from the QC index alone.
 *
 * Pure, and built only from `QcIndexRow`. That constraint is the point -- see the note on the index
 * row itself. Averaging criterion 1 across a tenant's scored touches by opening each touch document
 * would be thousands of reads for one page view, so a submitted score copies its seventeen numbers
 * into the index and this file reads them from there.
 *
 * ## Every average here can be null, and null is not zero
 *
 * An AM with no scored touches has no average, and a criterion nobody has graded has no average.
 * Both show a dash. This is the same rule as `qcScore`, for the same reason: these numbers are
 * shown to the people they describe, and a manager reading "0.0" where the truth is "not yet
 * measured" draws a conclusion about a person that the data does not support.
 *
 * ## `Partial` is not a goal set
 *
 * "Goals set {yes} / {applicable}" counts only `Yes`. A goal mentioned without a number, a time
 * frame or a written record is exactly what `Partial` means, and counting it would make the KPI
 * report the thing it exists to detect. `N/A` is excluded from the denominator rather than counted
 * as a miss -- a call where no goal applied is not a failure to set one.
 */

export interface QcTeamCriterionAverage {
  n: number;
  name: string;
  average: number;
}

export interface QcTeamCard {
  amId: string;
  /** The AM's display name, or a plain fallback. Never an empty card heading. */
  am: string;
  /** Scored touches counted into these numbers. */
  scored: number;
  /** Touches of theirs sitting in the queue right now. */
  inQueue: number;
  /** Mean overall score, rounded, or null when nothing is scored. */
  averageScore: number | null;
  /** Mean of criterion 1 and criterion 17, to one decimal, or null. */
  prepAverage: number | null;
  postTouchAverage: number | null;
  goalsSet: number;
  goalsApplicable: number;
  /** The weakest criterion by mean, or undefined when nothing is graded. */
  lowest?: QcTeamCriterionAverage;
}

function mean(values: readonly number[]): number | null {
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function roundTo(value: number | null, places: number): number | null {
  if (value === null) return null;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

/** Every graded value of one criterion across these rows. N/A and ungraded are left out. */
function criterionValues(rows: readonly QcIndexRow[], n: number): number[] {
  const out: number[] = [];
  for (const row of rows) {
    const value = row.crit?.[n - 1];
    if (isGraded(value)) out.push(value);
  }
  return out;
}

/**
 * The weakest criterion across these rows.
 *
 * Ties break on the lower criterion number so the card does not change what it says between two
 * page loads of identical data. A criterion nobody has graded cannot be the lowest -- it has no
 * average at all, and naming it would be inventing a weakness.
 */
export function lowestCriterion(rows: readonly QcIndexRow[]): QcTeamCriterionAverage | undefined {
  let best: QcTeamCriterionAverage | undefined;
  for (const criterion of QC_RUBRIC) {
    const average = mean(criterionValues(rows, criterion.n));
    if (average === null) continue;
    const rounded = roundTo(average, 1) as number;
    if (!best || rounded < best.average) {
      best = { n: criterion.n, name: criterion.name, average: rounded };
    }
  }
  return best;
}

/** One AM's card from their own rows. `scoredRows` drives every average; `allRows` the queue count. */
export function teamCardFor(
  amId: string,
  am: string | undefined,
  allRows: readonly QcIndexRow[],
): QcTeamCard {
  const mine = allRows.filter((row) => row.amId === amId);
  const scoredRows = mine.filter((row) => isScored(row.status));
  const scores = scoredRows
    .map((row) => row.score)
    .filter((score): score is number => typeof score === "number");

  const goals = scoredRows.map((row) => row.goal).filter(Boolean);
  const applicable = goals.filter((goal) => goal !== "N/A");
  const lowest = lowestCriterion(scoredRows);

  return {
    amId,
    am: am || "Unnamed account manager",
    scored: scoredRows.length,
    inQueue: mine.filter((row) => isQueued(row.status)).length,
    averageScore: roundTo(mean(scores), 0),
    prepAverage: roundTo(mean(criterionValues(scoredRows, QC_PREP_CRITERION)), 1),
    postTouchAverage: roundTo(mean(criterionValues(scoredRows, QC_POST_TOUCH_CRITERION)), 1),
    goalsSet: goals.filter((goal) => goal === "Yes").length,
    goalsApplicable: applicable.length,
    ...(lowest ? { lowest } : {}),
  };
}

/**
 * Every AM with QC history or work in the queue, strongest average first.
 *
 * An AM whose touches are all still waiting has no average and sorts to the end rather than to the
 * top as a zero. They still get a card: "2 in queue" is the useful thing the card says about them.
 */
export function teamCards(
  rows: readonly QcIndexRow[],
  names: Readonly<Record<string, string>> = {},
): QcTeamCard[] {
  const amIds = [...new Set(rows.map((row) => row.amId).filter(Boolean))];
  return amIds
    .map((amId) => teamCardFor(amId, names[amId], rows))
    .sort((left, right) => {
      if (left.averageScore === right.averageScore) return left.am.localeCompare(right.am);
      if (left.averageScore === null) return 1;
      if (right.averageScore === null) return -1;
      return right.averageScore - left.averageScore;
    });
}

/** "Goals set 3 / 4". Shown with a dash for the pair when nothing applicable has been scored. */
export function goalsLabel(card: QcTeamCard): string {
  if (!card.goalsApplicable) return "Goals set —";
  return `Goals set ${card.goalsSet} / ${card.goalsApplicable}`;
}

/** "Lowest: Data accuracy (2.5)", or an honest absence. */
export function lowestLabel(card: QcTeamCard): string {
  if (!card.lowest) return "Lowest: not enough scored touches yet";
  const name = criterionByNumber(card.lowest.n)?.name || card.lowest.name;
  return `Lowest: ${name} (${card.lowest.average.toFixed(1)})`;
}
