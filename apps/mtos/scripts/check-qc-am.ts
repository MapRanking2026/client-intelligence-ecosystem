/**
 * The AM's own QA & Coaching page: every number it shows them about themselves.
 *
 * Pure checks: nothing is read from or written to Firestore.
 *
 * The rule the whole suite protects: **this page is read by the person it is about.** So a missing
 * number is a dash and never a zero, a comparison with nothing to compare against is absent and
 * never "▲ 0", and the score shown is the one they were actually told rather than one recomputed
 * from a rubric that may have moved underneath it. Each of those has a convenient wrong answer,
 * and the convenient wrong answer is a false statement about somebody's work.
 */
import {
  AM_WINDOW,
  amDateLabel,
  amHeadline,
  amKpis,
  amStatusLabel,
  amSubtitle,
  appealBanner,
  appealTags,
  breakdownRows,
  changeLabel,
  clientFirstWord,
  focusRows,
  historyRows,
  improvedRows,
  latestCard,
  pendingChipLabel,
  rowScore,
  sortAmOldestFirst,
  splitAmRows,
  trendPoints,
  unreadScoreCount,
  valueLabel,
} from "@/src/lib/contracts/qc-am";
import type {
  QcAppeal,
  QcIndexRow,
  QcScoreValue,
  QcStatus,
} from "@/src/lib/contracts/qc-record";
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
    client: "Oakline Dental Group",
    readyAt: "2026-07-04T10:00:00.000Z",
    ...partial,
  };
}

/** A scored row with a score and criteria, dated so the order is unambiguous. */
function scored(
  touchId: string,
  date: string,
  score: number,
  critValues: QcScoreValue[],
  extra: Partial<QcIndexRow> = {},
): QcIndexRow {
  return row({
    touchId,
    status: "scored",
    date,
    readyAt: `${date}T10:00:00.000Z`,
    score,
    crit: critValues,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// Ordering and splitting
// ---------------------------------------------------------------------------

const ordered = sortAmOldestFirst([
  row({ touchId: "b", status: "scored", date: "2026-08-01" }),
  row({ touchId: "a", status: "scored", date: "2026-06-01" }),
  row({ touchId: "c", status: "scored", date: "2026-07-01" }),
]);
check("oldest first by the touch's own date", ordered.map((r) => r.touchId).join() === "a,c,b");

// A reviewer working through a backlog can score June after July. The chart must still read in
// call order, or it tells the AM their performance moved in a direction it did not.
const backlog = sortAmOldestFirst([
  row({ touchId: "jul", status: "scored", date: "2026-07-01", scoredAt: "2026-08-20" }),
  row({ touchId: "jun", status: "scored", date: "2026-06-01", scoredAt: "2026-08-21" }),
]);
check("call order, not scoring order", backlog[0].touchId === "jun");

const undated = sortAmOldestFirst([
  row({ touchId: "none", status: "scored", readyAt: "not a date" }),
  row({ touchId: "dated", status: "scored", date: "2026-06-01" }),
]);
check("an unreadable date sorts last", undated[1].touchId === "none");

const split = splitAmRows([
  row({ touchId: "q1", status: "ready", date: "2026-09-01" }),
  row({ touchId: "q2", status: "in_progress", date: "2026-09-02" }),
  scored("s1", "2026-08-01", 80, crit(4)),
  row({ touchId: "nocrit", status: "scored", date: "2026-08-15", score: 80 }),
]);
check("queued rows are pending", split.pending.map((r) => r.touchId).join() === "q1,q2");
check("scored rows with criteria are history", split.done.map((r) => r.touchId).join() === "s1");
// A scored row with no criteria would land in the history as a dash with a blank breakdown, which
// reads as a review that went wrong rather than as a legacy touch with no 17-point record.
check("a scored row with no criteria is in neither list", split.done.length === 1);

check(
  "a pending chip names the client and date",
  pendingChipLabel({ client: "Oakline", date: "2026-09-01", status: "ready" }).startsWith("Oakline ·"),
);
check(
  "in progress says it is being scored",
  pendingChipLabel({ client: "Oakline", date: "2026-09-01", status: "in_progress" }).endsWith(
    "· being scored",
  ),
);

// ---------------------------------------------------------------------------
// Dates
//
// A touch's date is a calendar day. Formatting it in the viewer's own zone renders it a day early
// for everyone west of UTC, which is everyone here. These two pin the fix in `qc-dates.ts`; the
// suite itself runs in America/Tijuana on this machine, so they would fail without it.
// ---------------------------------------------------------------------------

check("a calendar day keeps its day", amDateLabel("2026-04-03") === "Apr 3, 2026");
check("a new year's day does not slip into December", amDateLabel("2026-01-01") === "Jan 1, 2026");
check("an absent date says so", amDateLabel(undefined) === "no date");
check("an unreadable date says so rather than showing Invalid Date", amDateLabel("nope") === "no date");

// ---------------------------------------------------------------------------
// rowScore: the stored number wins
// ---------------------------------------------------------------------------

check("the stored score is used", rowScore({ score: 84, crit: crit(3) }) === 84);
check("criteria are the fallback", rowScore({ crit: crit(4) }) === 80);
check("no criteria and no score is null", rowScore({}) === null);
check("nothing graded is null, not zero", rowScore({ crit: crit(null) }) === null);
check("an absent row is null", rowScore(undefined) === null);
// The number the AM was told is the true one, even if a rubric change would now compute another.
check("a stored score beats a recomputed one", rowScore({ score: 91, crit: crit(1) }) === 91);
check("zero is a real stored score", rowScore({ score: 0, crit: crit(4) }) === 0);

// ---------------------------------------------------------------------------
// The header
// ---------------------------------------------------------------------------

check("no history says so plainly", amHeadline([]) === "No QC scores yet.");
check(
  "no history explains when the first one arrives",
  amSubtitle([]).includes("Your first score appears here"),
);

const two = [scored("t1", "2026-06-05", 80, crit(4)), scored("t2", "2026-07-03", 84, crit(4))];
check("a new score leads the headline", amHeadline(two) === "Your Oakline score is ready: 84.");
check(
  "a read score leads with the average",
  amHeadline([
    scored("t1", "2026-06-05", 80, crit(4), { status: "reviewed" }),
    scored("t2", "2026-07-03", 84, crit(4), { status: "reviewed" }),
  ]) === "You're averaging 82 across your last 2 touches.",
);
check(
  "one touch is singular",
  amHeadline([scored("t1", "2026-06-05", 80, crit(4), { status: "reviewed" })]).endsWith(
    "last 1 touch.",
  ),
);
check("an appeal decision is also news", amHeadline([
  scored("t1", "2026-07-03", 84, crit(4), { status: "appeal_resolved" }),
]).startsWith("Your Oakline score is ready"),
);

const subtitle = amSubtitle(two);
check("the subtitle names the direction", subtitle.startsWith("Up 4 from Oakline"));
check("the subtitle keeps the explainer", subtitle.includes("you can appeal any touch"));
check(
  "a drop says Down",
  amSubtitle([
    scored("t1", "2026-06-05", 90, crit(5)),
    scored("t2", "2026-07-03", 84, crit(4)),
  ]).startsWith("Down 6"),
);
// One score has nothing to compare against. "Up 0" would invent a history.
check(
  "a single score claims no direction",
  !amSubtitle([scored("t1", "2026-06-05", 80, crit(4))]).startsWith("Up"),
);

const card = latestCard(two, "Sady");
check("the latest card is the newest touch", card?.touchId === "t2");
check("the delta is against the touch before", card?.delta === 4);
check("the delta label reads as a change", card?.deltaLabel === "▲ 4 vs last");
check("the rating comes from the score", card?.rating === "B");
check("a scored touch is new until read", card?.isNew === true);
check("the reviewer's name is passed in, not compiled in", card?.scoredBy === "Sady");
check("with no reviewer configured it says QC", latestCard(two)?.scoredBy === "QC");
check(
  "a read score is not new",
  latestCard([scored("t1", "2026-07-03", 84, crit(4), { status: "reviewed" })])?.isNew === false,
);
const first = latestCard([scored("t1", "2026-07-03", 84, crit(4))]);
check("a first score has no delta", first?.delta === null);
check("a first score has no delta label", first?.deltaLabel === "");
check("no history has no card", latestCard([]) === undefined);

check("the first word of a client name", clientFirstWord("Oakline Dental Group") === "Oakline");
check("an absent client name is empty", clientFirstWord(undefined) === "");

// ---------------------------------------------------------------------------
// The KPI tiles
// ---------------------------------------------------------------------------

const five = [
  scored("k1", "2026-03-06", 72, crit(3, { 1: 3, 17: 3 }), { goal: "Yes" }),
  scored("k2", "2026-04-03", 76, crit(4, { 1: 4, 17: 3 }), { goal: "Partial" }),
  scored("k3", "2026-05-01", 80, crit(4, { 1: 4, 17: 4 }), { goal: "Yes" }),
  scored("k4", "2026-06-05", 84, crit(4, { 1: 5, 17: 4 }), { goal: "N/A" }),
  scored("k5", "2026-07-03", 88, crit(5, { 1: 5, 17: 5 }), { goal: "Yes" }),
];
const kpis = amKpis(five);
check("four tiles", kpis.length === 4);
check("the window is in the label", kpis[0].label === `Average score · last ${AM_WINDOW}`);
check("the average is rounded", kpis[0].value === 80);
check("the change since the first of the window", kpis[0].sub.startsWith("▲ 16 since"));
check("a rise is green", kpis[0].tone === "good");
check("the prep KPI averages criterion 1", kpis[1].value === 4.2);
check("the prep KPI counts how many hit the target", kpis[1].sub === "4 of 5 at 4+ · target 4+");
check("the post-touch KPI averages criterion 17", kpis[2].value === 3.8);
check("goals set excludes N/A from the denominator", kpis[3].text === "3 / 4");
check("partial goals are counted separately", kpis[3].sub === "1 partial");

const fallingKpis = amKpis([
  scored("f1", "2026-06-05", 90, crit(5)),
  scored("f2", "2026-07-03", 70, crit(3)),
]);
check("a fall is red", fallingKpis[0].tone === "risk");
check("a fall reads as a fall", fallingKpis[0].sub.startsWith("▼ 20 since"));

const oneKpis = amKpis([scored("o1", "2026-07-03", 80, crit(4))]);
// One point is not a trend. "▲ 0 since Jul 3" compares a score with itself.
check("one touch claims no movement", oneKpis[0].sub === "Target 80");
check("one touch has no tone", oneKpis[0].tone === undefined);
check("the denominator is the window's real size", oneKpis[1].sub === "1 of 1 at 4+ · target 4+");

const naKpis = amKpis([scored("n1", "2026-07-03", 80, crit(4, { 1: null, 17: null }))]);
check("an ungraded KPI has no average", naKpis[1].value === null);
check("an ungraded KPI says so rather than showing 0", naKpis[1].sub === "not graded on these touches");
const noGoal = amKpis([scored("g1", "2026-07-03", 80, crit(4), { goal: "N/A" })]);
check("no applicable goal shows a dash", noGoal[3].text === "—");
check("no applicable goal explains the dash", noGoal[3].sub.includes("had a goal to set"));

const sixKpis = amKpis([...five, scored("k6", "2026-08-07", 92, crit(5))]);
check("only the last five count", sixKpis[0].label === `Average score · last ${AM_WINDOW}`);
check("the window slides to the newest five", sixKpis[0].sub.includes("since Apr 3, 2026"));

// ---------------------------------------------------------------------------
// The chart
// ---------------------------------------------------------------------------

const points = trendPoints(five, "k3");
check("one bar per scored touch", points.length === 5);
check("the selected bar is marked", points[2].selected === true);
check("only one bar is selected", points.filter((p) => p.selected).length === 1);
check("a bar at target is on target", points[2].onTarget === true);
check("a bar below target is not", points[0].onTarget === false);
check("the client's first word labels the bar", points[0].clientShort === "Oakline");
// A bad month must still draw something. A zero-height bar reads as a touch that never happened.
const low = trendPoints([scored("l1", "2026-07-03", 20, crit(1))], undefined);
check("a score under the floor still draws a bar", low[0].heightPercent >= 4);
check("a perfect score fills the plot", trendPoints([scored("p1", "2026-07-03", 100, crit(5))], undefined)[0].heightPercent === 100);
check(
  "a row with no score draws no bar",
  trendPoints([row({ touchId: "x", status: "scored", crit: crit(null) })], undefined).length === 0,
);

// ---------------------------------------------------------------------------
// Where you improved
// ---------------------------------------------------------------------------

const improving = [
  scored("i1", "2026-04-03", 60, crit(3, { 6: 2 })),
  scored("i2", "2026-05-01", 60, crit(3, { 6: 2 })),
  scored("i3", "2026-06-05", 60, crit(3, { 6: 2 })),
  scored("i4", "2026-07-03", 80, crit(4, { 6: 5 })),
];
const improved = improvedRows(improving);
check("a criterion that rose by half a point or more is listed", improved.length > 0);
check("the biggest gain comes first", improved[0].n === 6);
check("the baseline average is shown to one decimal", improved[0].from === 2);
check("the latest value is shown", improved[0].to === 5);
check("at most three are listed", improved.length <= 3);

const steady = improvedRows([
  scored("s1", "2026-06-05", 80, crit(4)),
  scored("s2", "2026-07-03", 80, crit(4)),
]);
check("no movement lists nothing", steady.length === 0);
// With one touch there is no baseline. Claiming an improvement would measure against nothing.
check("one touch lists nothing", improvedRows([scored("x", "2026-07-03", 80, crit(4))]).length === 0);
check("no history lists nothing", improvedRows([]).length === 0);
const naImproved = improvedRows([
  scored("a1", "2026-06-05", 40, crit(2)),
  scored("a2", "2026-07-03", 80, crit(4, { 3: null })),
]);
// Not applying is not improving.
check("an N/A on the latest touch is not an improvement", !naImproved.some((r) => r.n === 3));

// ---------------------------------------------------------------------------
// Focus next
// ---------------------------------------------------------------------------

const focus = focusRows(
  [
    scored("p1", "2026-05-01", 60, crit(4, { 9: 2 })),
    scored("p2", "2026-06-05", 60, crit(4, { 9: 2 })),
    scored("p3", "2026-07-03", 60, crit(4, { 9: 3 })),
  ],
  { p2: { 9: { next: "An older note" } }, p3: { 9: { next: "Read the numbers off the deck" } } },
);
check("the lowest average comes first", focus[0].n === 9);
check("the average is to one decimal", focus[0].average === 2.3);
check("the most recent note wins", focus[0].advice === "Read the numbers off the deck");
check("a note is not from the rubric", focus[0].fromRubric === false);
check("at most three", focus.length <= 3);

const noNotes = focusRows([scored("q1", "2026-07-03", 60, crit(2))], {});
check("with no note it falls back to the description", noNotes[0].fromRubric === true);
check("the fallback is not empty", noNotes[0].advice.length > 10);
check("no history has no focus list", focusRows([], {}).length === 0);
const allNa = focusRows([scored("r1", "2026-07-03", 80, crit(null, { 1: 4 }))], {});
check("an N/A criterion is not a weakness", allNa.every((r) => r.n === 1));

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

const history = historyRows(five, "k3", "Sady");
check("newest first", history[0].touchId === "k5");
check("the selected row is marked", history.find((r) => r.touchId === "k3")?.selected === true);
check("each row carries its change", history[0].delta === 4);
check("the oldest row has no change", history[history.length - 1].delta === null);

check("a new score says it has not been read", amStatusLabel("scored") === "New — not read yet");
check("a read score says read", amStatusLabel("reviewed") === "Read");
check("an appeal names the reviewer when known", amStatusLabel("appealed", "Sady") === "Appeal with Sady");
// The reviewer's name is tenant data. Without it the label says what is true and nothing more.
check("an appeal with no name does not invent one", amStatusLabel("appealed") === "Appeal open");
check("a decided appeal says so", amStatusLabel("appeal_resolved") === "Appeal decided");
check("being scored says so", amStatusLabel("in_progress") === "Being scored");

check(
  "unread scores are counted for the badge",
  unreadScoreCount([
    scored("u1", "2026-06-05", 80, crit(4)),
    scored("u2", "2026-07-03", 84, crit(4), { status: "reviewed" }),
    scored("u3", "2026-08-07", 84, crit(4), { status: "appeal_resolved" }),
    row({ touchId: "u4", status: "ready" }),
  ]) === 2,
);

// ---------------------------------------------------------------------------
// The 17-point breakdown
// ---------------------------------------------------------------------------

const breakdown = breakdownRows({
  crit: crit(4, { 2: null, 5: 2, 9: 3 }),
  previousCrit: crit(3, { 5: 4 }),
  notes: { 5: { found: "No new date was given", next: "Name the new date out loud" } },
});
check("seventeen rows", breakdown.length === QC_CRITERION_COUNT);
check("a 4 is in the good band", breakdown[0].tone === "good");
check("a 3 is in the watch band", breakdown[8].tone === "watch");
check("a 2 is in the risk band", breakdown[4].tone === "risk");
check("an N/A has no band", breakdown[1].tone === "none");
check("an N/A fills no segments", breakdown[1].filled === 0);
check("a rise is a positive change", breakdown[0].change === 1);
check("a fall is a negative change", breakdown[4].change === -2);
check("the notes are carried through", breakdown[4].next === "Name the new date out loud");
check("a criterion with no note carries none", breakdown[0].found === undefined);
// N/A has no value to compare, and neither does a criterion the previous touch never graded.
check("an N/A has no change", breakdown[1].change === null);
const noPrevious = breakdownRows({ crit: crit(4) });
check("a first touch has no changes at all", noPrevious.every((r) => r.change === null));

check("a rise reads as a rise", changeLabel(2) === "▲ 2");
check("a fall reads as a fall", changeLabel(-1) === "▼ 1");
check("no movement is an equals sign", changeLabel(0) === "=");
check("nothing to compare is a dash", changeLabel(null) === "—");
check("a value is out of five", valueLabel(4) === "4/5");
// Never "0/5" for a criterion that did not apply.
check("N/A is not a value out of five", valueLabel(null) === "N/A");

// ---------------------------------------------------------------------------
// Appeal tags and the banner
// ---------------------------------------------------------------------------

const open: QcAppeal = {
  status: "open",
  submittedAt: "2026-07-10T09:00:00.000Z",
  items: [{ n: 5, to: 4, ctx: "Handled by email on 2 July" }],
  from: 80,
};
check("an open appeal tags the criterion as under appeal", appealTags(open)[5] === "Under appeal");
check("no appeal tags nothing", Object.keys(appealTags(undefined)).length === 0);

const resolved: QcAppeal = {
  ...open,
  status: "resolved",
  decisions: [
    { n: 5, to: 4, accept: true },
    { n: 9, to: 4, accept: false },
  ],
  items: [
    { n: 5, to: 4, ctx: "Handled by email on 2 July" },
    { n: 9, to: 4, ctx: "The figure was the client's own" },
  ],
  to: 84,
  resolvedAt: "2026-07-12T09:00:00.000Z",
};
check("an accepted criterion is tagged as raised", appealTags(resolved)[5] === "Raised on appeal");
// An AM who appealed and lost is owed the record of having been answered.
check("a declined criterion is tagged, not hidden", appealTags(resolved)[9] === "Appeal declined");

const openBanner = appealBanner(open) || "";
check("an open appeal says when it was sent", openBanner.includes("Appeal sent Jul 10, 2026"));
check("an open appeal counts one criterion in the singular", openBanner.includes("1 criterion"));
check("an open appeal promises a reply", openBanner.includes("You'll be notified"));

const resolvedBanner = appealBanner(resolved) || "";
check("a decided appeal shows the movement", resolvedBanner.includes("score 80 → 84"));
check("a decided appeal counts what was accepted", resolvedBanner.includes("1 of 2 accepted"));
check(
  "an unchanged score says it stays",
  (appealBanner({ ...resolved, to: 80 }) || "").includes("score stays 80"),
);
check("no appeal has no banner", appealBanner(undefined) === undefined);

const breakdownWithTags = breakdownRows({ crit: crit(4, { 5: 2 }), appeal: open });
check("the breakdown carries the appeal tag", breakdownWithTags[4].tag === "Under appeal");
check("untouched criteria carry no tag", breakdownWithTags[0].tag === undefined);

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - the Firestore query that supplies the rows, and the touch reads behind the notes");
console.log("  - how any of it looks on the screen");
console.log("  - the three writes (appeal, mark as read, chat request), which need a database");
if (failed) process.exit(1);
