/**
 * The QC queue's ordering and labels.
 *
 * Pure checks: nothing is read from or written to Firestore.
 *
 * Two rules carry the suite. **The queue runs oldest first**, against every other list in this app,
 * because a reviewer works downwards and newest-first would bury the AM who has been waiting
 * longest. And **a wait is late past 24 hours**, which is the promise made to the AM when they
 * pressed Finish and the only reason anything on this page turns red.
 */
import {
  LATE_AFTER_HOURS,
  QC_QUEUE_TABS,
  callLengthLabel,
  evidenceSummary,
  isQueued,
  isScored,
  parseQueueTab,
  queueActionLabel,
  queueCounts,
  queueStatusChip,
  queueTitle,
  rowInitials,
  scoredStatusLabel,
  sortQueueOldestFirst,
  sortScoredNewestFirst,
  waitLabel,
} from "@/src/lib/contracts/qc-queue";
import type { QcIndexRow, QcStatus } from "@/src/lib/contracts/qc-record";

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
// Which tab a status belongs to
// ---------------------------------------------------------------------------

check("ready is work in the queue", isQueued("ready"));
check("in_progress is work in the queue", isQueued("in_progress"));
check("scored is not in the queue", !isQueued("scored"));

check("scored shows in Scored", isScored("scored"));
check("reviewed shows in Scored", isScored("reviewed"));
check("appeal_resolved shows in Scored", isScored("appeal_resolved"));
// A touch does not vanish from the history the moment its AM questions the score.
check("an appealed touch still shows in Scored", isScored("appealed"));
check("a touch waiting to be scored is not in Scored", !isScored("ready"));

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

const queue = sortQueueOldestFirst([
  row({ touchId: "newest", status: "ready", readyAt: "2026-11-04T10:00:00.000Z" }),
  row({ touchId: "oldest", status: "ready", readyAt: "2026-11-01T10:00:00.000Z" }),
  row({ touchId: "middle", status: "ready", readyAt: "2026-11-02T10:00:00.000Z" }),
]);
check(
  "the queue runs oldest first",
  queue.map((item) => item.touchId).join(",") === "oldest,middle,newest",
);

const withBadDate = sortQueueOldestFirst([
  row({ touchId: "broken", status: "ready", readyAt: "not a date" }),
  row({ touchId: "real", status: "ready", readyAt: "2026-11-01T10:00:00.000Z" }),
]);
// An unreadable date must not sort to the top and claim to be the longest wait.
check("an unreadable readyAt sorts last", withBadDate[0].touchId === "real");

const scored = sortScoredNewestFirst([
  row({ touchId: "a", status: "scored", scoredAt: "2026-11-01T10:00:00.000Z" }),
  row({ touchId: "b", status: "scored", scoredAt: "2026-11-03T10:00:00.000Z" }),
  row({ touchId: "c", status: "scored", scoredAt: "2026-11-02T10:00:00.000Z" }),
]);
check("Scored runs newest first", scored.map((item) => item.touchId).join(",") === "b,c,a");

const scoredFallback = sortScoredNewestFirst([
  row({ touchId: "no-scored-at", status: "scored", readyAt: "2026-11-09T10:00:00.000Z" }),
  row({ touchId: "has-scored-at", status: "scored", scoredAt: "2026-11-05T10:00:00.000Z" }),
]);
check(
  "a row with no scoredAt falls back to readyAt",
  scoredFallback[0].touchId === "no-scored-at",
);

// ---------------------------------------------------------------------------
// The wait, and when it turns red
// ---------------------------------------------------------------------------

const now = new Date("2026-11-05T12:00:00.000Z");
const sevenHours = waitLabel("2026-11-05T05:00:00.000Z", now);
check("a wait reads in whole hours", sevenHours.text === "Waiting 7 h");
check("seven hours is not late", !sevenHours.late);

check("exactly 24 hours is not yet late", !waitLabel("2026-11-04T12:00:00.000Z", now).late);
check("25 hours is late", waitLabel("2026-11-04T11:00:00.000Z", now).late);
check("the threshold is a day", LATE_AFTER_HOURS === 24);

const noDate = waitLabel(undefined, now);
check("no readyAt shows no wait at all", noDate.text === undefined && noDate.hours === null);
check("an unreadable readyAt shows no wait", waitLabel("not a date", now).text === undefined);

// ---------------------------------------------------------------------------
// Row copy
// ---------------------------------------------------------------------------

check("a ready row is violet", queueStatusChip("ready").tone === "qc");
check("a ready row says Ready", queueStatusChip("ready").label === "Ready");
check("an opened row is amber", queueStatusChip("in_progress").tone === "watch");
check("an opened row says In progress", queueStatusChip("in_progress").label === "In progress");

check("an untouched row offers Start QC", queueActionLabel("ready") === "Start QC");
check("an opened row offers Continue QC", queueActionLabel("in_progress") === "Continue QC");

check("a scored touch waits on the AM", scoredStatusLabel("scored") === "Waiting for AM");
check("a reviewed touch says Reviewed", scoredStatusLabel("reviewed") === "Reviewed");
check("a decided appeal says so", scoredStatusLabel("appeal_resolved") === "Appeal decided");
// The reviewer is tenant data, never a name compiled into the app.
check(
  "an open appeal names the reviewer when there is one",
  scoredStatusLabel("appealed", "Sady") === "Appeal with Sady",
);
check(
  "an open appeal still reads correctly with no reviewer name",
  scoredStatusLabel("appealed") === "Appeal open",
);

const allOk = evidenceSummary([{ ok: true }, { ok: true }]);
check("every check passed reads green", allOk.tone === "good" && allOk.text === "2 of 2 follow-through checks");
const someSkipped = evidenceSummary([{ ok: true }, { ok: false }]);
// Amber, not red: a skipped step is information for the reviewer, not a verdict.
check("a skipped step reads amber", someSkipped.tone === "watch");
check("a skipped step is counted honestly", someSkipped.text === "1 of 2 follow-through checks");
check("no evidence at all is not green", evidenceSummary(undefined).tone === "watch");

check("a clocked call shows its length", callLengthLabel(48) === "48 min");
// A call nobody clocked has no length. Zero minutes would read as a call that never happened.
check("an unclocked call shows a dash", callLengthLabel(undefined) === "—");
check("zero minutes shows a dash", callLengthLabel(0) === "—");

check("initials come from the first two words", rowInitials("Jordan Reyes") === "JR");
check("one name gives one initial", rowInitials("Sady") === "S");
check("a blank name gives no initials rather than a crash", rowInitials(undefined) === "");

// ---------------------------------------------------------------------------
// The header
// ---------------------------------------------------------------------------

const counts = queueCounts(
  [
    row({ touchId: "1", status: "ready" }),
    row({ touchId: "2", status: "in_progress" }),
    row({ touchId: "3", status: "appealed" }),
    row({ touchId: "4", status: "reviewed" }),
  ],
  2,
);
check("the queue count is the open work", counts.queue === 2);
check("the appeals count is the appeals", counts.appeals === 1);
check("an appealed touch counts in Scored too", counts.scored === 2);
check("the team count is the AMs", counts.team === 2);

check("a clear queue says so", queueTitle(0, 0) === "Your QC queue is clear.");
check("one touch is singular", queueTitle(1, 0) === "1 monthly touch is ready for QC.");
check("several touches are plural", queueTitle(3, 0) === "3 monthly touches are ready for QC.");
check(
  "appeals are appended",
  queueTitle(2, 1) === "2 monthly touches are ready for QC. 1 appeal to review.",
);
check("appeals alone still read", queueTitle(0, 2) === "2 appeals to review.");

check("the tabs are the four in the handoff", QC_QUEUE_TABS.join(",") === "queue,appeals,scored,team");
check("a known tab is kept", parseQueueTab("team") === "team");
// A bad query parameter shows the queue rather than an error page.
check("an unknown tab falls back to the queue", parseQueueTab("nonsense") === "queue");
check("no tab falls back to the queue", parseQueueTab(undefined) === "queue");

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - the Firestore queries behind the tabs, which need a database");
console.log("  - how the rows and chips look on the screen");
if (failed) process.exit(1);
