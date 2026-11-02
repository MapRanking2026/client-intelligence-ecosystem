/**
 * Pins the Monthly Touch state machine and its one deadline.
 *
 * Three things here are requirements rather than behaviour that happens to work:
 *
 *   1. `progress` only moves forward. An AM re-reading the brief after the call is reading, not
 *      rewinding, so a touch can never resume at a step earlier than the work it has done.
 *   2. A requested step is honoured only up to the furthest one reached. A link to the
 *      follow-through on a touch whose call hasn't happened opens the step it is actually in.
 *   3. The follow-through is due 24 BUSINESS hours after the call ended, on the AM's own clock.
 *      Saturday and Sunday hours do not count, so a Friday afternoon call is due Monday afternoon.
 *      A deadline nobody is working towards teaches the team to ignore the clock.
 *
 * Exercises the pure rules rather than the service around them: a rule that needs Firestore to run
 * is a rule nobody checks. What is NOT covered is the Firestore transaction and the autosave's
 * retry behaviour, noted at the end of the run.
 *
 * Run with: npm run check:touch-progress
 */
import {
  advanceProgress,
  followThroughDeadline,
  followThroughDueAt,
  isTouchStep,
  resolveOpeningStep,
  resumeNotice,
  touchStepIndex,
  TOUCH_STEPS,
  type TouchStep,
} from "@/src/lib/contracts/touch-progress";

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

function scenario(name: string) {
  console.log(`\n${name}`);
}

const PT = "America/Los_Angeles";

/** The wall clock in a zone, as `Mon 2026-07-06 15:00`, for readable failure messages. */
function wall(iso: string | undefined, timeZone = PT): string {
  if (!iso) return "(none)";
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("weekday")} ${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

// ---------------------------------------------------------------------------
scenario("The five steps");

check("there are exactly five, in order", TOUCH_STEPS.join(",") === "prep,review,live,follow,qa");
check("a step name is recognised", isTouchStep("follow"));
check(
  "the stage name used by the board is not a step",
  !isTouchStep("follow_through"),
  "`follow_through` is the run-sheet stage; the step is `follow`",
);
check("an arbitrary string is not a step", !isTouchStep("Live") && !isTouchStep(""));
check("indexes run prep -> qa", touchStepIndex("prep") === 0 && touchStepIndex("qa") === 4);

// ---------------------------------------------------------------------------
scenario("progress only moves forward");

check("an absent marker starts at prep", advanceProgress(undefined, "prep") === "prep");
check("prep advances to review", advanceProgress("prep", "review") === "review");
check("review advances to live", advanceProgress("review", "live") === "live");
check(
  "going back to review from follow keeps follow",
  advanceProgress("follow", "review") === "follow",
  "re-reading the brief after the call must not rewind the touch",
);
check("the same step twice is a no-op", advanceProgress("live", "live") === "live");
check(
  "a skipped step is allowed when a caller really reached it",
  advanceProgress("prep", "qa") === "qa",
  "the marker records where the work got to, it does not police the order",
);
check("an unknown stored value is treated as prep", advanceProgress("nowhere" as TouchStep, "review") === "review");

// ---------------------------------------------------------------------------
scenario("which step a screen opens on");

check("no request opens at the stored step", resolveOpeningStep("live") === "live");
check("nothing stored opens at prep", resolveOpeningStep(undefined) === "prep");
check("a step already reached is honoured", resolveOpeningStep("follow", "review") === "review");
check("the current step is honoured", resolveOpeningStep("review", "review") === "review");
check(
  "a step ahead of the work is refused",
  resolveOpeningStep("review", "follow") === "review",
  "a follow-through screen with no transcript reads as broken, not as work not yet done",
);
check("a nonsense stage falls back to the stored step", resolveOpeningStep("live", "banana") === "live");
check("an empty stage falls back to the stored step", resolveOpeningStep("live", "") === "live");

// ---------------------------------------------------------------------------
scenario("the resume banner");

check(
  "a brand-new touch with nothing saved gets no banner",
  resumeNotice({ progress: "prep" }) === undefined,
  "a banner about picking up where you left off, on a touch nobody has touched, is noise",
);
check(
  "a touch part-way through gets one",
  resumeNotice({ progress: "review" })?.headline === "Picked up where you left off — Review the brief.",
);
check(
  "a saved time is said in the AM's zone",
  resumeNotice({ progress: "live", lastSavedAt: "2026-07-03T17:42:00.000Z", timeZone: PT })?.savedLabel ===
    "Last saved Jul 3, 10:42 AM",
);
check(
  "an unparseable saved time is left off rather than shown as Invalid Date",
  resumeNotice({ progress: "live", lastSavedAt: "soon" })?.savedLabel === undefined,
);
check(
  "a first-step touch with a save does get a banner",
  resumeNotice({ progress: "prep", lastSavedAt: "2026-07-03T17:42:00.000Z" }) !== undefined,
);

// ---------------------------------------------------------------------------
scenario("24 business hours after the call");

// Friday 3 July 2026, 3:00pm Pacific. Nine hours left in Friday, then the weekend is skipped, so
// the remaining fifteen hours land on Monday afternoon.
const fridayAfternoon = followThroughDueAt("2026-07-03T22:00:00.000Z", PT);
check(
  "a Friday 3pm call is due Monday 3pm, not Saturday 3pm",
  wall(fridayAfternoon) === "Mon 2026-07-06 15:00",
  wall(fridayAfternoon),
);

// Monday 6 July 2026, 10:00am Pacific -> Tuesday 10:00am.
const mondayMorning = followThroughDueAt("2026-07-06T17:00:00.000Z", PT);
check("a Monday morning call is due Tuesday morning", wall(mondayMorning) === "Tue 2026-07-07 10:00", wall(mondayMorning));

// Saturday 4 July 2026, 11:00am Pacific. No weekend hours count, so the clock starts Monday 00:00.
const saturday = followThroughDueAt("2026-07-04T18:00:00.000Z", PT);
check(
  "a Saturday call starts its clock on Monday",
  wall(saturday) === "Tue 2026-07-07 00:00",
  wall(saturday),
);

// Thursday 2 July 2026, 11:00pm Pacific: one hour of Thursday, then 23 hours of Friday.
const lateThursday = followThroughDueAt("2026-07-03T06:00:00.000Z", PT);
check("a late Thursday call is due late Friday", wall(lateThursday) === "Fri 2026-07-03 23:00", wall(lateThursday));

// The same instant read on a different clock gives a different local deadline, which is the point
// of measuring it in the AM's zone rather than the server's.
const newYork = followThroughDueAt("2026-07-03T22:00:00.000Z", "America/New_York");
check(
  "an east-coast AM gets the deadline on their own clock",
  wall(newYork, "America/New_York") === "Mon 2026-07-06 18:00",
  wall(newYork, "America/New_York"),
);

check("no call end means no deadline", followThroughDueAt(undefined) === undefined);
check("an unparseable call end means no deadline", followThroughDueAt("after lunch") === undefined);

// A call that ends the Friday before the clocks go back: the extra hour belongs to the weekend, so
// the Monday deadline is still at the same wall-clock time the AM read on Friday.
const beforeFallBack = followThroughDueAt("2026-10-30T22:00:00.000Z", PT);
check(
  "a daylight-saving weekend does not shift the Monday deadline",
  wall(beforeFallBack) === "Mon 2026-11-02 15:00",
  wall(beforeFallBack),
);

// ---------------------------------------------------------------------------
scenario("the countdown an AM reads");

const due = "2026-07-06T22:00:00.000Z";
const atDue = Date.parse(due);
check(
  "a full day out is calm",
  followThroughDeadline(due, atDue - 20 * 3600_000)?.tone === "ok",
);
check(
  "four hours out is amber",
  followThroughDeadline(due, atDue - 4 * 3600_000)?.tone === "amber",
);
check(
  "three hours out is amber, and says so",
  followThroughDeadline(due, atDue - 3 * 3600_000)?.label === "3h 0m left",
);
check("past the deadline is red", followThroughDeadline(due, atDue + 60_000)?.tone === "red");
check(
  "past the deadline says overdue, not a negative number",
  followThroughDeadline(due, atDue + 150 * 60_000)?.label === "2h 30m overdue",
);
check("more than a day out reads in days", followThroughDeadline(due, atDue - 30 * 3600_000)?.label === "1d 6h left");
check("no due date means no countdown", followThroughDeadline(undefined) === undefined);

// ---------------------------------------------------------------------------

console.log(`\n${checks - failures} of ${checks} checks passed.`);
console.log(
  [
    "",
    "Not covered here (needs Firestore, so it is checked by hand against a real touch):",
    "  - the transaction in `advanceTouchProgress` and `saveTouchDraft`, and its merge of",
    "    concurrent writes from the review screen and a background job",
    "  - the autosave's coalescing and its re-queue of a patch whose request failed",
    "  - reading the AM's time zone off their profile document",
  ].join("\n"),
);

if (failures > 0) {
  process.exitCode = 1;
}
