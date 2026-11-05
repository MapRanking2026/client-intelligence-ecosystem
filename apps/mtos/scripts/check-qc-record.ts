/**
 * The QC scoring arithmetic.
 *
 * Pure checks: nothing is read from or written to Firestore.
 *
 * Two rules are worth the whole suite. **N/A is excluded, not counted as zero** -- a call with no
 * ads to discuss must not be scored as though the AM failed that criterion. And **nothing graded
 * means no score, not a score of zero** -- a touch waiting to be reviewed, displayed as "0", reads
 * as the worst review anyone has ever had.
 */
import {
  QC_KPI_TARGET,
  QC_SCORE_TARGET,
  applyAppealDecisions,
  callLengthMinutes,
  emptyDraftCrit,
  isGraded,
  newQcRecord,
  qcKpis,
  qcProgress,
  qcRating,
  qcScore,
  qcTone,
  qcWaitingHours,
  type QcDraftValue,
  type QcScoreValue,
} from "@/src/lib/contracts/qc-record";
import { QC_CRITERION_COUNT, QC_RUBRIC_VERSION } from "@/src/lib/contracts/qc-rubric";

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

/** All seventeen at the same value. */
function flat(value: QcDraftValue): QcDraftValue[] {
  return Array.from({ length: QC_CRITERION_COUNT }, () => value);
}

// ---------------------------------------------------------------------------
// The score
// ---------------------------------------------------------------------------

check("all fives is 100", qcScore(flat(5)) === 100);
check("all fours is 80", qcScore(flat(4)) === 80);
check("all threes is 60", qcScore(flat(3)) === 60);
check("all ones is 20", qcScore(flat(1)) === 20);

// The rounding is to the nearest whole number, and this is the case that proves it: sixteen fives
// and one four is 84/85 = 98.82%.
check("a mixed set rounds to the nearest whole number", qcScore([...flat(5).slice(1), 4]) === 99);

check("nothing graded has no score at all", qcScore(flat(-1)) === null);
check("and an all-N/A record has no score either", qcScore(flat(null)) === null);
check("an undefined set has no score", qcScore(undefined) === null);
check("an empty set has no score", qcScore([]) === null);
// The one that matters. A null returned as 0 anywhere downstream is the bug this suite exists for.
check("no-score is null, never zero", qcScore(flat(-1)) !== 0);

// ---------------------------------------------------------------------------
// N/A is excluded from both the sum and the count
// ---------------------------------------------------------------------------

const oneGradedFive: QcDraftValue[] = [5, ...Array.from({ length: 16 }, () => null as QcDraftValue)];
check("one five and sixteen N/A is 100, not 6", qcScore(oneGradedFive) === 100);

const halfNa: QcDraftValue[] = [
  ...Array.from({ length: 8 }, () => 4 as QcDraftValue),
  ...Array.from({ length: 9 }, () => null as QcDraftValue),
];
check("eight fours and nine N/A is 80", qcScore(halfNa) === 80);
check(
  "marking a criterion N/A rather than grading it 1 raises the score",
  (qcScore([...flat(5).slice(1), null]) || 0) > (qcScore([...flat(5).slice(1), 1]) || 0),
);
check(
  "an undecided criterion is excluded like N/A, so a part-done draft still scores",
  qcScore([...flat(5).slice(1), -1]) === 100,
);

// ---------------------------------------------------------------------------
// isGraded
// ---------------------------------------------------------------------------

check("5 is graded", isGraded(5));
check("1 is graded", isGraded(1));
check("N/A is not graded", !isGraded(null));
check("undecided is not graded", !isGraded(-1));
check("undefined is not graded", !isGraded(undefined));
// Out-of-range values cannot come from the UI but can come from a bad write.
check("zero is not graded", !isGraded(0 as QcDraftValue));
check("six is not graded", !isGraded(6 as QcDraftValue));

// ---------------------------------------------------------------------------
// The rating. A ≥ 90 · B 80-89 · C 70-79 · D below 70, and no F.
// ---------------------------------------------------------------------------

check("100 is an A", qcRating(100) === "A");
check("90 is an A", qcRating(90) === "A");
check("89 is a B", qcRating(89) === "B");
check("80 is a B", qcRating(80) === "B");
check("79 is a C", qcRating(79) === "C");
check("70 is a C", qcRating(70) === "C");
check("69 is a D", qcRating(69) === "D");
check("0 is a D", qcRating(0) === "D");
check(
  "there is no F at any score",
  Array.from({ length: 101 }, (_, score) => qcRating(score)).every((rating) => rating !== ("F" as string)),
);

// ---------------------------------------------------------------------------
// Tones. The band boundaries are the same ones the rating uses at 80 and 70.
// ---------------------------------------------------------------------------

check("the overall target is 80", QC_SCORE_TARGET === 80);
check("80 is good", qcTone(80) === "good");
check("79 is watch", qcTone(79) === "watch");
check("70 is watch", qcTone(70) === "watch");
check("69 is risk", qcTone(69) === "risk");
check("a B is never shown as a risk", qcTone(80) === "good" && qcRating(80) === "B");

// ---------------------------------------------------------------------------
// Progress and the submit gate
// ---------------------------------------------------------------------------

check("an empty draft has seventeen undecided", qcProgress(emptyDraftCrit(), undefined).decided === 0);
check("and a total of seventeen", qcProgress(emptyDraftCrit(), undefined).total === 17);
check("an empty draft cannot be submitted", qcProgress(emptyDraftCrit(), undefined).complete === false);
// N/A is a decision, so it counts towards completeness.
check("N/A counts as decided", qcProgress(flat(null), "Yes").decided === 17);
check("all decided plus a goal is complete", qcProgress(flat(4), "Yes").complete === true);
check(
  "all decided with no goal is not complete",
  qcProgress(flat(4), undefined).complete === false,
);
check(
  "one criterion left is not complete even with a goal",
  qcProgress([...flat(4).slice(1), -1], "Yes").complete === false,
);
check("a goal of N/A still counts as set", qcProgress(flat(4), "N/A").complete === true);
check("an undefined set has nothing decided", qcProgress(undefined, "Yes").decided === 0);
// A short array must not read as complete just because every value it has is decided.
check("a short array is not complete", qcProgress([5, 5, 5], "Yes").complete === false);

// ---------------------------------------------------------------------------
// The KPIs
// ---------------------------------------------------------------------------

check("the KPI target is 4", QC_KPI_TARGET === 4);

const kpis = qcKpis([4, ...flat(3).slice(1, 16), 5], "Yes");
check("the prep KPI reads criterion 1", kpis.prep === 4);
check("the post-touch KPI reads criterion 17", kpis.postTouch === 5);
check("4 meets the prep KPI", kpis.prepMet === true);
check("5 meets the post-touch KPI", kpis.postTouchMet === true);
check("Yes meets the goal KPI", kpis.goalMet === true);

const weak = qcKpis([3, ...flat(5).slice(1, 16), 3], "Partial");
check("3 does not meet the prep KPI", weak.prepMet === false);
check("3 does not meet the post-touch KPI", weak.postTouchMet === false);
// Partial is explicitly not a pass: a goal mentioned without a number is not a goal.
check("Partial does not meet the goal KPI", weak.goalMet === false);
check("No does not meet the goal KPI", qcKpis(flat(5), "No").goalMet === false);
check("N/A does not meet the goal KPI", qcKpis(flat(5), "N/A").goalMet === false);
check("an unset goal does not meet it", qcKpis(flat(5), undefined).goalMet === false);

const naKpi = qcKpis([null, ...flat(5).slice(1)], "Yes");
check("a KPI marked N/A has no value", naKpi.prep === null);
// Not "met": there is no evidence it was done, which is different from evidence it was done well.
check("and is not counted as met", naKpi.prepMet === false);
check("an ungraded KPI has no value", qcKpis(emptyDraftCrit(), "Yes").prep === null);

// ---------------------------------------------------------------------------
// Appeals
// ---------------------------------------------------------------------------

const scored: QcScoreValue[] = [3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4];
const afterAppeal = applyAppealDecisions(scored, [
  { n: 1, to: 5, accept: true },
  { n: 2, to: 5, accept: false },
]);
check("an accepted appeal raises that criterion", afterAppeal[0] === 5);
check("a declined appeal leaves it exactly as it was", afterAppeal[1] === 3);
check("nothing else moves", afterAppeal.slice(2).every((value) => value === 4));
check("the score goes up after an accepted appeal", (qcScore(afterAppeal) || 0) > (qcScore(scored) || 0));
check("the original array is not mutated", scored[0] === 3);
// A decision for a criterion the rubric no longer has must be ignored, not written past the end.
check(
  "a decision outside the rubric is ignored",
  applyAppealDecisions(scored, [{ n: 99, to: 5, accept: true }]).length === scored.length,
);
check(
  "a zero criterion number is ignored",
  applyAppealDecisions(scored, [{ n: 0, to: 5, accept: true }])[0] === 3,
);
check(
  "an out-of-range target score is ignored",
  applyAppealDecisions(scored, [{ n: 1, to: 9, accept: true }])[0] === 3,
);
check(
  "no decisions changes nothing",
  applyAppealDecisions(scored, []).join(",") === scored.join(","),
);

// ---------------------------------------------------------------------------
// A new record
// ---------------------------------------------------------------------------

const fresh = newQcRecord({
  readyAt: "2026-11-04T18:00:00.000Z",
  evidence: [{ label: "Agenda emailed", detail: "Sent via Intercom.", ok: true }],
  tickets: 3,
  callLengthMin: 41,
});
check("a new record is ready", fresh.status === "ready");
check("it stamps the rubric version in force", fresh.rubricVersion === QC_RUBRIC_VERSION);
check("it carries the evidence it was given", fresh.evidence.length === 1);
check("it has no score yet", fresh.score === undefined);
check("and no criteria yet", fresh.crit === undefined);
check("the call length is kept", fresh.callLengthMin === 41);

const unclocked = newQcRecord({ readyAt: "2026-11-04T18:00:00.000Z", evidence: [], tickets: 0 });
// Omitted rather than zero: a call that was never clocked has no length, and "0 min" is a claim.
check("a call that was never clocked has no length", unclocked.callLengthMin === undefined);
check("and the field is absent, not zero", !("callLengthMin" in unclocked));
check("zero tickets is still recorded as zero", unclocked.tickets === 0);

// ---------------------------------------------------------------------------
// Call length
// ---------------------------------------------------------------------------

check(
  "a 41-minute call measures 41",
  callLengthMinutes("2026-11-04T17:00:00.000Z", "2026-11-04T17:41:00.000Z") === 41,
);
check("no end means no length", callLengthMinutes("2026-11-04T17:00:00.000Z", undefined) === undefined);
check("no start means no length", callLengthMinutes(undefined, "2026-11-04T17:41:00.000Z") === undefined);
check("an unreadable date means no length", callLengthMinutes("not a date", "also not") === undefined);
// Timestamps in the wrong order are an error, and the honest answer to an error is "unknown".
check(
  "an end before the start means no length",
  callLengthMinutes("2026-11-04T17:41:00.000Z", "2026-11-04T17:00:00.000Z") === undefined,
);
check(
  "a zero-length call means no length",
  callLengthMinutes("2026-11-04T17:00:00.000Z", "2026-11-04T17:00:00.000Z") === undefined,
);

// ---------------------------------------------------------------------------
// How long it has been waiting. Over 24 hours the queue shows it in red.
// ---------------------------------------------------------------------------

const now = new Date("2026-11-04T18:00:00.000Z");
check("two hours ago reads as 2", qcWaitingHours("2026-11-04T16:00:00.000Z", now) === 2);
check("just now reads as 0", qcWaitingHours("2026-11-04T18:00:00.000Z", now) === 0);
check("a day and a half reads as 36", qcWaitingHours("2026-11-03T06:00:00.000Z", now) === 36);
check("no readyAt reads as nothing", qcWaitingHours(undefined, now) === null);
// Not a negative number of hours, and not 480,000 hours since 1970.
check("an unreadable readyAt reads as nothing", qcWaitingHours("not a date", now) === null);
check("a future readyAt reads as 0, never negative", qcWaitingHours("2026-11-05T00:00:00.000Z", now) === 0);

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - the handoff transaction's idempotency, which needs a Firestore emulator");
console.log("  - the AI pre-read, which needs a language-model provider");
console.log("  - how a score and its chips look on the screen");
if (failed) process.exit(1);
