/**
 * The Team tab's averages.
 *
 * Pure checks: nothing is read from or written to Firestore.
 *
 * The rule the whole suite protects: **an absence is never a zero.** An AM with nothing scored has
 * no average, a criterion nobody graded has no average, and a goal that did not apply is not a goal
 * missed. These cards are read by managers about named people, and a 0.0 where the truth is "not
 * measured yet" is a conclusion the data does not support.
 */
import {
  goalsLabel,
  lowestCriterion,
  lowestLabel,
  teamCardFor,
  teamCards,
} from "@/src/lib/contracts/qc-team";
import type { QcIndexRow, QcScoreValue, QcStatus } from "@/src/lib/contracts/qc-record";
import { QC_CRITERION_COUNT } from "@/src/lib/contracts/qc-rubric";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`FAILED: ${label}`);
}

/** All seventeen at one value, with named positions overridden. Positions are 1-based. */
function crit(value: QcScoreValue, overrides: Record<number, QcScoreValue> = {}): QcScoreValue[] {
  const out = Array.from({ length: QC_CRITERION_COUNT }, () => value);
  for (const [n, override] of Object.entries(overrides)) out[Number(n) - 1] = override;
  return out;
}

function row(partial: Partial<QcIndexRow> & { touchId: string; status: QcStatus }): QcIndexRow {
  return {
    amId: "am-1",
    clientId: "c-1",
    client: "A Client",
    readyAt: "2026-11-01T10:00:00.000Z",
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// An AM with nothing scored
// ---------------------------------------------------------------------------

const waiting = teamCardFor("am-1", "Jordan Reyes", [
  row({ touchId: "t1", status: "ready" }),
  row({ touchId: "t2", status: "in_progress" }),
]);
check("their queue is counted", waiting.inQueue === 2);
check("they have no scored touches", waiting.scored === 0);
// The load-bearing one: not 0.
check("they have no average score", waiting.averageScore === null);
check("they have no prep average", waiting.prepAverage === null);
check("they have no post-touch average", waiting.postTouchAverage === null);
check("no criterion is named as their lowest", waiting.lowest === undefined);
check("their lowest line says why it is empty", lowestLabel(waiting).includes("not enough"));
check("their goals line is a dash", goalsLabel(waiting) === "Goals set —");

const unnamed = teamCardFor("am-9", undefined, [row({ touchId: "t1", status: "ready", amId: "am-9" })]);
check("a missing name still gives a readable heading", unnamed.am === "Unnamed account manager");

// ---------------------------------------------------------------------------
// Averages
// ---------------------------------------------------------------------------

const scoredRows = [
  row({ touchId: "t1", status: "scored", score: 80, goal: "Yes", crit: crit(4) }),
  row({ touchId: "t2", status: "reviewed", score: 100, goal: "Yes", crit: crit(5) }),
  row({ touchId: "t3", status: "ready" }),
];
const card = teamCardFor("am-1", "Jordan Reyes", scoredRows);
check("scored touches are counted", card.scored === 2);
check("the queue is counted separately", card.inQueue === 1);
check("the average score is the mean of the scored", card.averageScore === 90);
check("the prep average is criterion 1", card.prepAverage === 4.5);
check("the post-touch average is criterion 17", card.postTouchAverage === 4.5);

// A touch still in the queue has no score and must not drag the mean down.
const withQueued = teamCardFor("am-1", "Jordan", [
  row({ touchId: "t1", status: "scored", score: 90, crit: crit(5) }),
  row({ touchId: "t2", status: "ready" }),
]);
check("an unscored touch is left out of the average", withQueued.averageScore === 90);

// ---------------------------------------------------------------------------
// N/A, and the goal KPI
// ---------------------------------------------------------------------------

const withNa = teamCardFor("am-1", "Jordan", [
  row({ touchId: "t1", status: "scored", score: 80, crit: crit(4, { 1: null }) }),
  row({ touchId: "t2", status: "scored", score: 40, crit: crit(2, { 1: 2 }) }),
]);
// Criterion 1 was N/A on the first touch, so the average is the second's 2, not 1.
check("an N/A criterion is excluded from its average", withNa.prepAverage === 2);

const goals = teamCardFor("am-1", "Jordan", [
  row({ touchId: "t1", status: "scored", score: 90, goal: "Yes", crit: crit(5) }),
  row({ touchId: "t2", status: "scored", score: 80, goal: "Partial", crit: crit(4) }),
  row({ touchId: "t3", status: "scored", score: 80, goal: "No", crit: crit(4) }),
  row({ touchId: "t4", status: "scored", score: 80, goal: "N/A", crit: crit(4) }),
]);
// Partial is explicitly not a pass; N/A leaves the denominator rather than counting as a miss.
check("only Yes counts as a goal set", goals.goalsSet === 1);
check("N/A is not applicable", goals.goalsApplicable === 3);
check("the goals line reads as a fraction", goalsLabel(goals) === "Goals set 1 / 3");

// ---------------------------------------------------------------------------
// The lowest criterion
// ---------------------------------------------------------------------------

const weakest = lowestCriterion([
  row({ touchId: "t1", status: "scored", crit: crit(5, { 9: 2 }) }),
  row({ touchId: "t2", status: "scored", crit: crit(5, { 9: 3 }) }),
]);
check("the weakest criterion is found", weakest?.n === 9);
check("its average is to one decimal", weakest?.average === 2.5);
check("it is named", Boolean(weakest?.name));

// Determinism: identical averages must not make the card say something different on each load.
const tied = lowestCriterion([row({ touchId: "t1", status: "scored", crit: crit(3) })]);
check("a tie breaks on the lower criterion number", tied?.n === 1);

// A criterion nobody graded cannot be the weakness.
const allNaButOne = lowestCriterion([
  row({ touchId: "t1", status: "scored", crit: crit(null, { 6: 4 }) }),
]);
check("an ungraded criterion is never named lowest", allNaButOne?.n === 6);
check("nothing graded names no criterion", lowestCriterion([row({ touchId: "t1", status: "scored" })]) === undefined);

check(
  "the lowest line reads as a sentence",
  lowestLabel(teamCardFor("am-1", "Jordan", [row({ touchId: "t1", status: "scored", crit: crit(5, { 9: 2 }) })]))
    .startsWith("Lowest: "),
);

// ---------------------------------------------------------------------------
// The list of cards
// ---------------------------------------------------------------------------

const cards = teamCards(
  [
    row({ touchId: "t1", status: "scored", amId: "am-1", score: 70, crit: crit(3) }),
    row({ touchId: "t2", status: "scored", amId: "am-2", score: 95, crit: crit(5) }),
    row({ touchId: "t3", status: "ready", amId: "am-3" }),
  ],
  { "am-1": "Jordan Reyes", "am-2": "Priya Shah" },
);
check("one card per AM", cards.length === 3);
check("the strongest average comes first", cards[0].amId === "am-2");
// An AM with nothing scored sorts last rather than to the top as a zero.
check("an AM with no average sorts last", cards[2].amId === "am-3");
check("names are used where known", cards[0].am === "Priya Shah");

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - the Firestore query that supplies the rows");
console.log("  - how a card looks on the screen");
if (failed) process.exit(1);
