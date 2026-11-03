/**
 * The shape of the Post Monthly Touch Notes.
 *
 * Pure checks: no model, no ClickUp, no Firestore. They pin the numbering, the two budgets, the
 * action-line format and the paste-safety of the rendered markdown -- the last because what this
 * renders is pasted into the Client's Book and read there for a year.
 */
import {
  ACTION_MAX_WORDS,
  GOAL_STATUSES,
  NOTES_SECTIONS,
  NO_AM_CONTEXT,
  SUMMARY_BULLETS,
  SUMMARY_MAX_SENTENCES,
  actionLineIssues,
  actionWordCount,
  formatActionLine,
  isGoalStatus,
  notesBlockers,
  notesTitle,
  pendingMarker,
  quarterLabel,
  renderNotesMarkdown,
  sentenceCount,
  summaryBudget,
  summaryNumbering,
  type ActionLine,
  type NotesDraft,
} from "@/src/lib/contracts/follow-through-notes";

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

function act(overrides: Partial<ActionLine> = {}): ActionLine {
  return {
    id: "a1",
    what: "Rebuild the Tempe service page",
    team: "Web Development",
    due: "Fri 7 Nov",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The sections
// ---------------------------------------------------------------------------

check("there are eight sections", NOTES_SECTIONS.length === 8);
check(
  "numbered 1 through 8 in order",
  NOTES_SECTIONS.map((section) => section.id).join("") === "12345678",
);
check("every section says what belongs in it", NOTES_SECTIONS.every((s) => s.blurb.length > 20));

// Section 2 is the one that renumbers, and it must renumber both halves together.
check("with no AM context the summary is plainly 2", summaryNumbering(false).summary === "2");
check("and there is no 2B at all", summaryNumbering(false).context === undefined);
check("with AM context the summary becomes 2A", summaryNumbering(true).summary === "2A");
check("and the context is 2B", summaryNumbering(true).context === "2B");

// ---------------------------------------------------------------------------
// Counting sentences
// ---------------------------------------------------------------------------

check("nothing is no sentences", sentenceCount("") === 0);
check("whitespace is no sentences", sentenceCount("   \n ") === 0);
check("one full stop is one sentence", sentenceCount("She was happy with the leads.") === 1);
check("a line still being typed counts as one", sentenceCount("She was happy with") === 1);
check("three sentences count as three", sentenceCount("One. Two. Three.") === 3);
check("a question and an exclamation terminate too", sentenceCount("Really? Yes! Fine.") === 3);
check("an ellipsis is not three sentences", sentenceCount("She paused... then agreed.") === 2);

// The reason this function exists rather than a split on ".": these all used to over-count, and
// an AM watching a four-sentence summary report six stops trusting the counter.
check("a decimal is not a sentence end", sentenceCount("CPL moved from 42.50 to 38.10 this month.") === 1);
check("a title is not a sentence end", sentenceCount("Dr. Chen asked about the quarter.") === 1);
check("an initial is not a sentence end", sentenceCount("J. Alvarez signed it off.") === 1);
check("a closing quote after the stop still terminates", sentenceCount('He said "fine." We moved on.') === 2);

const budget = summaryBudget("One. Two. Three. Four. Five.");
check("the counter counts", budget.count === 5);
check("and knows the budget", budget.max === SUMMARY_MAX_SENTENCES);
check("and says when it is over", budget.over);
check("four sentences are not over", !summaryBudget("One. Two. Three. Four.").over);

check("there are six labelled bullets", SUMMARY_BULLETS.length === 6);
check(
  "ending on client sentiment",
  SUMMARY_BULLETS[SUMMARY_BULLETS.length - 1].label === "Client sentiment",
);

// ---------------------------------------------------------------------------
// Action lines
// ---------------------------------------------------------------------------

check(
  "an action line takes the one format",
  formatActionLine(act()) === "**Action:** Rebuild the Tempe service page — Web Development — Fri 7 Nov",
);
check("a carry-over says so", formatActionLine(act({ carryOver: true })).includes("_(carry-over)_"));
check(
  "a cross-department action names the other team",
  formatActionLine(act({ crossDepartment: "SEO" })).includes("_(also SEO)_"),
);
check(
  "a real dependency is written as one",
  formatActionLine(act({ dependsOn: "her photo upload" })).includes("_(after her photo upload)_"),
);

check("the word count counts the deliverable only", actionWordCount(act()) === 5);
check("and not the team or the date", actionWordCount({ what: "Two words" }) === 2);

check("a complete action line has nothing wrong with it", actionLineIssues(act()).length === 0);
check("an action with no deliverable is flagged", actionLineIssues(act({ what: "" }))[0].includes("what we will"));
check("an action with no team is flagged", actionLineIssues(act({ team: "" }))[0].includes("team"));
check("an action with no date is flagged", actionLineIssues(act({ due: "" }))[0].includes("date"));

const longAction = act({ what: "a ".repeat(ACTION_MAX_WORDS + 1).trim() });
const longIssues = actionLineIssues(longAction);
check("a long action is flagged", longIssues.length === 1);
check("and the flag names both numbers", longIssues[0].includes("21") && longIssues[0].includes("20"));
check("and offers the way out", longIssues[0].includes("split it"));

// ---------------------------------------------------------------------------
// The goal and the title
// ---------------------------------------------------------------------------

check("there are eight goal statuses", GOAL_STATUSES.length === 8);
check("'Not discussed' is one of them", isGoalStatus("Not discussed"));
check("'Met' and 'Not met' are both there", isGoalStatus("Met") && isGoalStatus("Not met"));
check("anything else is not", !isGoalStatus("Probably fine"));

check("January is Q1", quarterLabel("2026-01-15T00:00:00.000Z") === "Q1 2026");
check("March is still Q1", quarterLabel("2026-03-31T00:00:00.000Z") === "Q1 2026");
check("April is Q2", quarterLabel("2026-04-01T00:00:00.000Z") === "Q2 2026");
check("November is Q4", quarterLabel("2026-11-02T00:00:00.000Z") === "Q4 2026");
check("an unparseable date gives no quarter", quarterLabel("not a date") === "");

check(
  "the title line carries client, date, AM and the touch",
  notesTitle({ clientName: "Oakline Dental", date: "2026-11-02", accountManager: "Mara", monthNumber: 7 }) ===
    "Oakline Dental · 2026-11-02 · AM: Mara · Recurring Monthly Touch (Month 7)",
);
// A guessed ordinal in a filed document gets quoted back later, so an unknown one is left out.
check(
  "an unknown month number is left out rather than guessed",
  notesTitle({ clientName: "Oakline Dental", date: "2026-11-02" }) ===
    "Oakline Dental · 2026-11-02 · Recurring Monthly Touch",
);

check("a pending item waiting on the client says so", pendingMarker({ waitingOn: "Client" }) === "[PENDING – waiting on Client]");
check("one waiting on the AM says that", pendingMarker({ waitingOn: "AM review" }) === "[PENDING – AM review]");

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function draft(overrides: Partial<NotesDraft> = {}): NotesDraft {
  return {
    title: "Oakline Dental · 2026-11-02 · AM: Mara · Recurring Monthly Touch (Month 7)",
    nps: 8,
    npsJustification: "Steady month; the invoice question was housekeeping.",
    goalQuarter: "Q4 2026",
    goalText: "40 booked implant consults a month",
    goalStatus: "On track",
    goalEvidence: "31 in October, up from 24.",
    summary: "A steady month. She wants the Tempe page rebuilt before the new year.",
    bullets: { metrics: "Calls up 18%", sentiment: "Warm" },
    departments: [
      {
        department: "Web Development",
        clientFeedback: "She said the Tempe page looks nothing like the rest of the site.",
        actions: [act()],
      },
    ],
    clientActions: [{ id: "c1", what: "Send the new team photos", due: "Wed 5 Nov", tentative: true }],
    pending: [
      {
        id: "p1",
        waitingOn: "Client",
        missing: "The updated price list",
        from: "Mara at Oakline",
        team: "SEO",
        owner: "Mara",
        reminderDate: "Mon 10 Nov",
      },
    ],
    ...overrides,
  };
}

const rendered = renderNotesMarkdown(draft());
check("the title is the one H1", (rendered.match(/^# /gm) || []).length === 1);
check("section 1 is a heading", rendered.includes("## 1 · Meeting identification"));
check("the score is in section 1", rendered.includes("**NPS / Account Health:** 8/10"));
check("so is the quarter", rendered.includes("**Quarterly goal (Q4 2026):**"));
check("the summary is section 2 when there is no AM context", rendered.includes("## 2 · Meeting summary"));
check("and there is no 2B", !rendered.includes("2B"));
check("a department is a sub-heading", rendered.includes("### Web Development"));
check("the action line is rendered in its format", rendered.includes("**Action:** Rebuild the Tempe service page"));
check("a tentative client date is marked", rendered.includes("(tentative)"));
check("the pending marker is rendered", rendered.includes("[PENDING – waiting on Client]"));
check("an absent section 4 is simply absent", !rendered.includes("## 4 ·"));

// The whole point of "paste-safe": ClickUp's importer mangles both of these.
check("no tables are emitted", !rendered.includes("|---") && !/^\|/m.test(rendered));
check("no code fences are emitted", !rendered.includes("```"));
check("headings never go below three levels", !rendered.includes("#### "));
check("there is never a run of blank lines", !rendered.includes("\n\n\n"));
check("it ends with exactly one newline", rendered.endsWith("\n") && !rendered.endsWith("\n\n"));

const withContext = renderNotesMarkdown(draft({ amContext: "She mentioned her partner is unwell." }));
check("AM context renumbers the summary to 2A", withContext.includes("## 2A · Meeting summary"));
check("and adds 2B", withContext.includes("## 2B · Additional AM context"));
check("with the AM's own words in it", withContext.includes("her partner is unwell"));

const emptyContext = renderNotesMarkdown(draft({ amContext: "" }));
check("an opened but empty context box still renumbers", emptyContext.includes("## 2A ·"));
check("and says None provided rather than leaving a blank", emptyContext.includes(NO_AM_CONTEXT));

const lowScore = renderNotesMarkdown(
  draft({
    nps: 4,
    healthRisk: {
      registerNote: "Logged as Performance, tier High.",
      playbook: "Run the Performance playbook.",
      managerTag: "@-tag Javier in the client channel.",
    },
  }),
);
check("a low score adds section 4", lowScore.includes("## 4 · Account health / risk"));
check("naming the register, the playbook and the Manager", lowScore.includes("Risk Register") && lowScore.includes("Playbook") && lowScore.includes("Manager"));

const empty = renderNotesMarkdown(draft({ departments: [], clientActions: [], pending: [] }));
check("an empty section says so rather than going blank", empty.includes("No department actions"));
check("the same for client actions", empty.includes("Nothing is owed by the client"));
check("and for pending", empty.includes("Nothing is pending."));

const linked = renderNotesMarkdown(draft(), {
  ticketLinks: { a1: "https://app.clickup.com/t/abc123" },
  createdTickets: [{ title: "Rebuild the Tempe service page", url: "https://app.clickup.com/t/abc123" }],
});
check("an action line ends with its ticket link", linked.includes("— [ticket](https://app.clickup.com/t/abc123)"));
check("and the created tickets are listed at the bottom", linked.includes("## Tickets created"));
check("a note with no links yet carries none", !rendered.includes("[ticket]"));
check("and no tickets-created list", !rendered.includes("Tickets created"));

// ---------------------------------------------------------------------------
// What blocks the notes
// ---------------------------------------------------------------------------

check("a complete draft blocks nothing", notesBlockers(draft()).length === 0);
check(
  "no summary blocks",
  notesBlockers(draft({ summary: "  " })).some((line) => line.includes("meeting summary")),
);
check(
  "an action with no owner blocks",
  notesBlockers(
    draft({ departments: [{ department: "SEO", clientFeedback: "x", actions: [act({ team: "" })] }] }),
  ).length === 1,
);
check(
  "and the blocker names the department and the action",
  notesBlockers(
    draft({ departments: [{ department: "SEO", clientFeedback: "x", actions: [act({ team: "" })] }] }),
  )[0].includes("SEO: Rebuild the Tempe service page"),
);

// The soft budget stays soft: it is shown, never enforced.
check(
  "a long action line does NOT block the notes",
  notesBlockers(
    draft({ departments: [{ department: "SEO", clientFeedback: "x", actions: [longAction] }] }),
  ).length === 0,
);
check("nor does an over-long summary", notesBlockers(draft({ summary: "One. Two. Three. Four. Five. Six." })).length === 0);

check(
  "a pending item with no chase date blocks",
  notesBlockers(draft({ pending: [{ ...draft().pending[0], reminderDate: "" }] })).length === 1,
);
check(
  "an empty client action blocks",
  notesBlockers(draft({ clientActions: [{ id: "c1", what: "", due: "Wed" }] })).length === 1,
);

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - the model pass that writes the first draft from the transcript");
console.log("  - how ClickUp's own importer renders this markdown once pasted");
console.log("  - the 24-business-hour deadline in section 8, which the touch computes");
if (failed) process.exit(1);
