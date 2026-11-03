/**
 * The gate on the follow-through, and what the processing run reports.
 *
 * Pure checks: nothing is created, filed or sent. The gate is the single human approval the
 * whole step is built around, so what it does and does not stop is worth pinning exactly.
 */
import {
  PROCESSING_STEPS,
  approvedClientActions,
  finishBlockers,
  processingOutcome,
  processingSummary,
  remainingCount,
  type FinishInputs,
  type StepResult,
} from "@/src/lib/contracts/follow-through-finish";
import { diffRow, HEALTH_TRACKER_FIELDS, type TrackerCard } from "@/src/lib/contracts/follow-through-trackers";
import type { NotesDraft } from "@/src/lib/contracts/follow-through-notes";
import type { FollowThroughItem } from "@/src/lib/contracts/follow-through-tickets";
import type { RecapEmailState } from "@/src/lib/contracts/follow-through-recap-email";

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

const notes: NotesDraft = {
  title: "Oakline Dental · 2026-11-02",
  nps: 8,
  npsJustification: "Steady.",
  goalQuarter: "Q4 2026",
  goalText: "40 consults",
  goalStatus: "On track",
  goalEvidence: "31 in October.",
  summary: "A steady month.",
  bullets: {},
  departments: [
    {
      department: "Web Development",
      clientFeedback: "The Tempe page looks wrong.",
      actions: [{ id: "a1", what: "Rebuild the Tempe page", team: "Web Development", due: "Fri 7 Nov" }],
    },
  ],
  clientActions: [{ id: "c1", what: "Send the photos", due: "Wed 5 Nov", decision: "approved" }],
  pending: [],
};

const item: FollowThroughItem = {
  id: "t1",
  formType: "ticket",
  taskName: "Rebuild the Tempe page",
  description: "x",
  timeEstimateMinutes: 120,
  department: "Web Development",
  assignee: "Ana",
  priority: "normal",
  decision: "approved",
};

const card: TrackerCard = {
  id: "health",
  kind: "health",
  current: { health: "Good" },
  next: { health: "Neutral" },
  decision: "approved",
};
const diffs = { health: diffRow(card.current, card.next, HEALTH_TRACKER_FIELDS) };

const recap: RecapEmailState = {
  subject: "Recap",
  html: "<p>Here is where we landed, with plenty of words so the body is not treated as empty.</p>",
  decision: "approved",
};

const complete: FinishInputs = {
  notes,
  items: [item],
  trackerCards: [card],
  trackerDiffs: diffs,
  recap,
};

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

check("a complete follow-through opens the gate", finishBlockers(complete).length === 0);

check(
  "no notes blocks, and says why first",
  finishBlockers({})[0].includes("Draft the notes"),
);
check("and reports nothing else until there are notes", finishBlockers({}).length === 1);

check(
  "no tickets built blocks",
  finishBlockers({ ...complete, items: undefined }).some((line) => line.includes("Build the tickets")),
);
check(
  "no tracker rows built blocks",
  finishBlockers({ ...complete, trackerCards: [] }).some((line) => line.includes("Build the tracker rows")),
);
check(
  "no recap blocks",
  finishBlockers({ ...complete, recap: undefined }).some((line) => line.includes("Build the recap")),
);

check(
  "an undecided ticket blocks",
  finishBlockers({ ...complete, items: [{ ...item, decision: undefined }] }).some((line) =>
    line.includes("Decide the remaining item"),
  ),
);
check(
  "an undecided tracker card blocks",
  finishBlockers({ ...complete, trackerCards: [{ ...card, decision: undefined }] }).some((line) =>
    line.includes("tracker card"),
  ),
);
check(
  "an undecided recap blocks",
  finishBlockers({ ...complete, recap: { ...recap, decision: undefined } }).some((line) =>
    line.includes("Decide the recap"),
  ),
);
check(
  "an undecided client action blocks",
  finishBlockers({
    ...complete,
    notes: { ...notes, clientActions: [{ id: "c1", what: "Send the photos", due: "Wed" }] },
  }).some((line) => line.includes("client action")),
);

// The asymmetry the whole gate is built on: decided-but-denied costs nothing, approved must be complete.
check(
  "a denied ticket with every field missing opens the gate",
  finishBlockers({
    ...complete,
    items: [{ ...item, decision: "denied", taskName: "", description: "", assignee: "" }],
  }).length === 0,
);
check(
  "an approved ticket missing a required field blocks",
  finishBlockers({ ...complete, items: [{ ...item, assignee: "" }] }).some((line) =>
    line.includes("Assignee"),
  ),
);
check(
  "a denied recap opens the gate",
  finishBlockers({ ...complete, recap: { ...recap, decision: "denied" } }).length === 0,
);
check(
  "a denied tracker card opens the gate",
  finishBlockers({ ...complete, trackerCards: [{ ...card, decision: "denied" }] }).length === 0,
);

// The notes need no separate approval -- that is what Finish is.
check(
  "there is no 'approve the notes' blocker",
  !finishBlockers(complete).some((line) => line.toLowerCase().includes("approve the notes")),
);
// But they do have to be usable.
check(
  "notes with an ownerless action still block",
  finishBlockers({
    ...complete,
    notes: {
      ...notes,
      departments: [
        { department: "SEO", clientFeedback: "x", actions: [{ id: "a1", what: "Do it", team: "", due: "Fri" }] },
      ],
    },
  }).length === 1,
);

// ---------------------------------------------------------------------------
// Approve all remaining
// ---------------------------------------------------------------------------

check("nothing remaining counts zero", remainingCount(complete) === 0);
check(
  "every undecided thing is counted once",
  remainingCount({
    notes: { ...notes, clientActions: [{ id: "c1", what: "x", due: "y" }] },
    items: [{ ...item, decision: undefined }],
    trackerCards: [{ ...card, decision: undefined }],
    recap: { ...recap, decision: undefined },
  }) === 4,
);
check("an empty follow-through has nothing to approve", remainingCount({}) === 0);

check(
  "only approved client actions carry forward",
  approvedClientActions([
    { id: "c1", what: "a", due: "", decision: "approved" },
    { id: "c2", what: "b", due: "", decision: "denied" },
    { id: "c3", what: "c", due: "" },
  ]).length === 1,
);

// ---------------------------------------------------------------------------
// The steps
// ---------------------------------------------------------------------------

check("there are seven steps", PROCESSING_STEPS.length === 7);
check(
  "in the handoff's order",
  PROCESSING_STEPS.map((step) => step.id).join(",") === "tickets,notes,risk,health,recap,channel,booking",
);
check("tickets come before the notes that quote their links", PROCESSING_STEPS[0].id === "tickets");
check("the email goes after everything it describes is real", PROCESSING_STEPS[4].id === "recap");
check("booking is last", PROCESSING_STEPS[6].id === "booking");
check("every step says what it does", PROCESSING_STEPS.every((step) => step.detail.length > 25));
check(
  "the booking step names what happens without Calendar access",
  PROCESSING_STEPS[6].detail.includes("reminder ticket"),
);

// ---------------------------------------------------------------------------
// Reporting the run
// ---------------------------------------------------------------------------

const allDone: StepResult[] = PROCESSING_STEPS.map((step) => ({ id: step.id, status: "done", message: "ok" }));
check("every step done is processed", processingOutcome(allDone) === "processed");
check("a skipped step is still processed", processingOutcome([...allDone.slice(1), { id: "risk", status: "skipped", message: "not needed" }]) === "processed");

const withWarning: StepResult[] = [
  ...allDone.slice(0, 6),
  { id: "booking", status: "warning", message: "Calendar write access is not granted, so a reminder ticket was created instead." },
];
check("a warning makes it partial", processingOutcome(withWarning) === "partial");
check("the summary names the warning", processingSummary(withWarning).includes("reminder ticket"));
check("and says how many need attention", processingSummary(withWarning).includes("one step"));

const withFailure: StepResult[] = [
  { id: "tickets", status: "failed", message: "ClickUp refused the first ticket." },
  ...allDone.slice(1),
];
check("a failure outranks a warning", processingOutcome(withFailure) === "failed");
// The sentence an AM reads after a half-finished run decides whether they press it again.
check(
  "and the summary promises the run is safe to repeat",
  processingSummary(withFailure).includes("already succeeded") &&
    processingSummary(withFailure).includes("run it again"),
);
check("a clean run says so plainly", processingSummary(allDone).startsWith("Processed."));

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - the ClickUp, Intercom and Google Calendar calls each step makes");
console.log("  - idempotency across a real retry, which depends on the stored task ids");
if (failed) process.exit(1);
