/**
 * The Command Center's QC cards.
 *
 * Pure checks: nothing is read from or written to Firestore.
 *
 * Two rules the suite protects.
 *
 * **A reviewer's card is work; an AM's card is news.** They are built from the same rows and they
 * must not be interchangeable: a reviewer sees what has arrived and how long it has sat there, an
 * AM sees what has happened to something of theirs and only until they have read it. The checks
 * run the same rows through both to prove they do not agree.
 *
 * **The wait is the only alarm.** Red appears past twenty-four hours and nowhere else, because
 * that is the promise made to the AM when they pressed Finish. A Command Center where several cards
 * shout has no way to say which one matters.
 */
import {
  amQcCards,
  qcCardsHeading,
  reviewerQcCards,
} from "@/src/lib/contracts/qc-cards";
import { LATE_AFTER_HOURS } from "@/src/lib/contracts/qc-queue";
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

const NOW = new Date("2026-07-12T12:00:00.000Z");
/** Hours before NOW, as an ISO string. */
function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

function crit(value: QcScoreValue): QcScoreValue[] {
  return Array.from({ length: QC_CRITERION_COUNT }, () => value);
}

function row(partial: Partial<QcIndexRow> & { touchId: string; status: QcStatus }): QcIndexRow {
  return {
    amId: "am-1",
    clientId: "c-1",
    client: "Oakline Dental Group",
    am: "Francisco Pérez",
    date: "2026-07-03",
    readyAt: hoursAgo(2),
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// The reviewer's cards
// ---------------------------------------------------------------------------

const reviewer = reviewerQcCards(
  [
    row({ touchId: "fresh", status: "ready", readyAt: hoursAgo(1) }),
    row({ touchId: "old", status: "ready", readyAt: hoursAgo(40) }),
    row({ touchId: "started", status: "in_progress", readyAt: hoursAgo(5) }),
    row({ touchId: "appealed", status: "appealed", score: 80, appealCount: 2, readyAt: hoursAgo(3) }),
    row({ touchId: "done", status: "reviewed", score: 90 }),
  ],
  NOW,
);

// An appeal is somebody waiting on an answer about a score they already have, which is a worse
// thing to leave than an unscored touch.
check("an appeal comes first", reviewer[0].kind === "appeal");
check("a decided touch is not a card at all", !reviewer.some((card) => card.id === "done"));
check("three queued touches and one appeal", reviewer.length === 4);
check("the longest wait leads the queue", reviewer[1].id === "old");
check("oldest first within the queue", reviewer.map((card) => card.id).join() === "appealed,old,started,fresh");

const late = reviewer.find((card) => card.id === "old");
check(`past ${LATE_AFTER_HOURS} h is red`, late?.tone === "risk");
check("the wait is stated", late?.wait?.text.includes("40") === true);
check("the wait is flagged late", late?.wait?.late === true);

const fresh = reviewer.find((card) => card.id === "fresh");
check("a fresh touch is not red", fresh?.tone === "qc");
check("a fresh touch is not flagged late", fresh?.wait?.late === false);
check("a ready touch says Start QC", fresh?.cta === "Start QC");
check("a ready touch is labelled Ready for QC", fresh?.label === "Ready for QC");
check("a ready touch links to the scoring screen", fresh?.href === "/qa?qc=fresh");
check("the AM is named on the card", fresh?.detail.startsWith("Francisco Pérez") === true);
// The date must be the calendar day, not a day earlier. See `qc-dates.ts`.
check("the touch date is the right day", fresh?.detail.includes("Jul 3, 2026") === true);

const started = reviewer.find((card) => card.id === "started");
check("a started touch says Continue QC", started?.cta === "Continue QC");
check("a started touch is labelled QC in progress", started?.label === "QC in progress");
check("a started touch is amber, not violet", started?.tone === "watch");

const appealCard = reviewer[0];
check("an appeal links to the appeal screen", appealCard.href === "/qa?appeal=appealed");
check("an appeal says how many criteria", appealCard.detail.includes("2 criteria"));
check("an appeal carries the score", appealCard.detail.includes("score 80"));
check("an appeal has no wait", appealCard.wait === undefined);

const oneCriterion = reviewerQcCards([row({ touchId: "a1", status: "appealed", appealCount: 1 })], NOW);
check("one criterion is singular", oneCriterion[0].detail.includes("1 criterion"));
// A row saying "0 criteria" would be describing an appeal that could not exist.
const noCount = reviewerQcCards([row({ touchId: "a2", status: "appealed" })], NOW);
check("no recorded count claims none", !noCount[0].detail.includes("criteri"));
check("no score shows a dash", noCount[0].detail.includes("score —"));

const noName = reviewerQcCards([row({ touchId: "x", status: "ready", am: undefined })], NOW);
check("a missing AM name does not render as blank", noName[0].detail.startsWith("An account manager"));

const noReadyAt = reviewerQcCards([row({ touchId: "y", status: "ready", readyAt: "" })], NOW);
check("no handoff time means no wait rather than a wrong one", noReadyAt[0].wait === undefined);

// ---------------------------------------------------------------------------
// The AM's cards
// ---------------------------------------------------------------------------

const am = amQcCards([
  row({ touchId: "new", status: "scored", score: 84, rating: "B", scoredAt: "2026-07-12T09:00:00.000Z" }),
  row({ touchId: "read", status: "reviewed", score: 90, rating: "A", scoredAt: "2026-07-11T09:00:00.000Z" }),
  row({ touchId: "decided", status: "appeal_resolved", score: 88, rating: "B", scoredAt: "2026-07-10T09:00:00.000Z" }),
  row({ touchId: "open", status: "appealed", score: 80 }),
  row({ touchId: "queued", status: "ready" }),
]);
check("only unread results are cards", am.map((card) => card.id).join() === "new,decided");
// `reviewed` means they opened it. A card that cleared on sight would let a score go unseen.
check("a read score is not a card", !am.some((card) => card.id === "read"));
// Their own open appeal is their question, not news for them.
check("their own open appeal is not a card", !am.some((card) => card.id === "open"));
check("a touch still with QC is not a card", !am.some((card) => card.id === "queued"));
check("newest first", am[0].id === "new");

check("a new score is labelled as ready", am[0].label === "QC score ready");
check("a new score says See my score", am[0].cta === "See my score");
check("a new score is green", am[0].tone === "good");
check("a new score links to their own page", am[0].href === "/qa?touch=new");
check("the score and rating are shown", am[0].detail.includes("84 (B)"));
check("the date is the right day", am[0].detail.includes("Jul 3, 2026"));

check("a decided appeal is labelled as decided", am[1].label === "Appeal decided");
check("a decided appeal says See the decision", am[1].cta === "See the decision");
check("a decided appeal is violet", am[1].tone === "qc");

// A dash, never a zero: an unscored touch shown as 0 reads as a catastrophic review.
const noScore = amQcCards([row({ touchId: "z", status: "scored", crit: crit(null) })]);
check("nothing graded says so rather than showing 0", noScore[0].detail.includes("no criterion applied"));
const fromCrit = amQcCards([row({ touchId: "w", status: "scored", crit: crit(4) })]);
check("a score is computed when the row has none stored", fromCrit[0].detail.includes("80"));

check("an empty feed has no cards", amQcCards([]).length === 0);

// The same rows must not produce the same cards for the two readers.
const sameRows = [row({ touchId: "s1", status: "ready" }), row({ touchId: "s2", status: "scored", score: 84 })];
check(
  "a reviewer and an AM see different things",
  reviewerQcCards(sameRows, NOW).map((c) => c.id).join() !== amQcCards(sameRows).map((c) => c.id).join(),
);

// ---------------------------------------------------------------------------
// The heading
// ---------------------------------------------------------------------------

check("no work says so", qcCardsHeading([], true) === "Nothing is waiting for QC");
check("no news says so", qcCardsHeading([], false) === "No new QC scores");
check("one touch is singular", qcCardsHeading(reviewerQcCards([row({ touchId: "o", status: "ready" })], NOW), true).startsWith("1 touch needs"));
check("several touches are plural", qcCardsHeading(reviewer, true).startsWith("4 touches need"));
check("the heading counts what is late", qcCardsHeading(reviewer, true).includes(`1 over ${LATE_AFTER_HOURS} h`));
check(
  "nothing late is not mentioned",
  !qcCardsHeading(reviewerQcCards([row({ touchId: "n", status: "ready" })], NOW), true).includes("over"),
);
check("one result is singular", qcCardsHeading(am.slice(0, 1), false) === "1 new QC result");
check("several results are plural", qcCardsHeading(am, false) === "2 new QC results");

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - the two Firestore queries that supply the rows");
console.log("  - how a card looks on the Command Center");
if (failed) process.exit(1);
