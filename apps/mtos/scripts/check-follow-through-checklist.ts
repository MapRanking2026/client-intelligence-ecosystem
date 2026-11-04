/**
 * The post-touch checklist: what counts as done, and what refuses to.
 *
 * Pure checks: nothing is read from or written to Firestore.
 *
 * The rule worth pinning hardest is that a processing step which came back with a warning is not a
 * tick. A warning means the step ran and left something for the AM -- the recap that did not send,
 * the booking that needs doing by hand -- and a screen that ticked it would be the one thing on the
 * follow-through that reads as finished while the work is outstanding. The same rows become the
 * evidence QC scores the touch against, so a wrong tick here would be marked down later by
 * somebody who could no longer fix it.
 */
import {
  checklistProgress,
  followThroughChecklist,
} from "@/src/lib/contracts/follow-through-checklist";
import type { StepStatus } from "@/src/lib/contracts/follow-through-finish";
import type { MonthlyTouchRecord } from "@/src/lib/mtos-data";

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

function touch(overrides: Partial<MonthlyTouchRecord> = {}): MonthlyTouchRecord {
  return { id: "t1", clientId: "c1", ...overrides } as MonthlyTouchRecord;
}

function step(id: string, status: StepStatus, message = "something happened") {
  return { id, status, message };
}

function row(record: MonthlyTouchRecord, label: string) {
  return followThroughChecklist(record).find((entry) => entry.label === label);
}

// ---------------------------------------------------------------------------
// Shape and order
// ---------------------------------------------------------------------------

const empty = followThroughChecklist(touch());
check("there are eight rows", empty.length === 8);
check("the agenda is first", empty[0]?.label === "Agenda emailed");
check("the Client's Book page second", empty[1]?.label.includes("Client's Book") === true);
check("the transcript third", empty[2]?.label === "Transcript");
check("the notes fourth", empty[3]?.label === "Post-touch notes");
check("the tickets fifth", empty[4]?.label === "Tickets");
check("every row says something", empty.every((entry) => entry.detail.trim().length > 0));
check("a touch with nothing done has nothing ticked", checklistProgress(empty).ok === 0);
check("and counts all eight", checklistProgress(empty).total === 8);

// ---------------------------------------------------------------------------
// A warning is not a tick
// ---------------------------------------------------------------------------

const warned = touch({
  followThrough: { processing: { steps: [step("recap", "warning", "Intercom refused the send.")] } },
} as Partial<MonthlyTouchRecord>);
const recapWarned = row(warned, "Recap email");
check("a recap that warned is not ticked", recapWarned?.ok === false);
check("the rows use the handoff's evidence labels", empty.map((entry) => entry.label).slice(5).join(" · ") === "Recap email · Health Tracker · Next touch");
check("and the row carries the reason", recapWarned?.detail === "Intercom refused the send.");

const failedRecap = touch({
  followThrough: { processing: { steps: [step("recap", "failed", "Nothing was sent.")] } },
} as Partial<MonthlyTouchRecord>);
check("a recap that failed is not ticked either", row(failedRecap, "Recap email")?.ok === false);

const doneRecap = touch({
  followThrough: { processing: { steps: [step("recap", "done", "Sent to the client contact.")] } },
} as Partial<MonthlyTouchRecord>);
check("a recap that is done is ticked", row(doneRecap, "Recap email")?.ok === true);

// ---------------------------------------------------------------------------
// The agenda: sent, declined, and neither
// ---------------------------------------------------------------------------

check("an agenda nobody sent is outstanding", row(touch(), "Agenda emailed")?.ok === false);
const sent = touch({
  agendaEmail: { subject: "", html: "", sentAt: "2026-11-02T17:00:00.000Z", sentVia: "Intercom" },
} as Partial<MonthlyTouchRecord>);
check("a sent agenda is ticked", row(sent, "Agenda emailed")?.ok === true);
check("and says what carried it", row(sent, "Agenda emailed")?.detail === "Sent via Intercom.");
check(
  "no row prints a raw timestamp at the AM",
  followThroughChecklist(sent).every((entry) => !entry.detail.includes("2026-11-02T")),
);

// Declining is a decision, not an outstanding task -- but the line has to say which it was.
const declined = touch({ agendaEmail: { subject: "", html: "", declined: true } } as Partial<MonthlyTouchRecord>);
check("a declined agenda counts as settled", row(declined, "Agenda emailed")?.ok === true);
check("and is never described as sent", row(declined, "Agenda emailed")?.detail.includes("Declined") === true);

// ---------------------------------------------------------------------------
// Transcript and tickets
// ---------------------------------------------------------------------------

check(
  "a transcript still being waited on is outstanding",
  row(touch({ transcript: { status: "waiting", docIds: [] } } as Partial<MonthlyTouchRecord>), "Transcript")?.ok ===
    false,
);
check(
  "one found on the calendar event is ticked",
  row(touch({ transcript: { status: "found", docIds: ["a", "b"] } } as Partial<MonthlyTouchRecord>), "Transcript")
    ?.ok === true,
);
check(
  "and one attached by hand counts too",
  row(touch({ transcript: { status: "attached", docIds: ["a"] } } as Partial<MonthlyTouchRecord>), "Transcript")
    ?.ok === true,
);
check(
  "the transcript row says how many documents were joined",
  row(touch({ transcript: { status: "found", docIds: ["a", "b"] } } as Partial<MonthlyTouchRecord>), "Transcript")
    ?.detail.includes("2 documents") === true,
);

const tickets = touch({
  followThrough: { ticketIds: { a: "111", b: "222" } },
} as Partial<MonthlyTouchRecord>);
check("tickets are counted from the ids actually stored", row(tickets, "Tickets")?.detail === "2 created in ClickUp.");
check("and that ticks the row", row(tickets, "Tickets")?.ok === true);

// Nothing to create is a settled state, not a failure: the AM approved no tickets.
const noTickets = touch({
  followThrough: { processing: { steps: [step("tickets", "skipped", "No tickets were approved.")] } },
} as Partial<MonthlyTouchRecord>);
check("no tickets approved counts as settled", row(noTickets, "Tickets")?.ok === true);

// ---------------------------------------------------------------------------
// A fully processed touch
// ---------------------------------------------------------------------------

const processed = touch({
  agendaEmail: { subject: "", html: "", sentAt: "2026-11-02T17:00:00.000Z" },
  approval: { steps: {}, clientBook: { pageId: "p1", pageUrl: "u", pageName: "Monthly Touch (11/2/2026)" } } as never,
  transcript: { status: "found", docIds: ["a"] },
  followThrough: {
    notes: {} as never,
    ticketIds: { a: "111" },
    processing: {
      steps: [
        step("tickets", "done"),
        step("notes", "done"),
        step("recap", "done"),
        step("health", "done"),
        step("booking", "done"),
      ],
    },
  },
} as Partial<MonthlyTouchRecord>);
const full = followThroughChecklist(processed);
check("a touch where everything happened ticks all eight", checklistProgress(full).ok === 8);
check("the Client's Book row names the page", row(processed, "Prep page in the Client's Book")?.detail.includes("Monthly Touch (11/2/2026)") === true);

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - whether the sidebar actually sticks, which is a screen to look at");
console.log("  - the Firestore read behind the touch record");
if (failed) process.exit(1);
