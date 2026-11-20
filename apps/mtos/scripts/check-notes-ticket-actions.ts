/**
 * Section 3 of the filed notes IS the approved tickets.
 *
 * The call used to produce the same commitment twice: a draft action line the model wrote, and a
 * ticket the AM then renamed, re-routed, re-dated and approved. The Client's Book was filed from
 * the first of those, so the page said one thing and the ticket linked beneath it said another --
 * and the AM had to review both to find out which.
 *
 * There is now one list. The ticket is the action item, in the wording that was approved. What
 * the client said still comes from the notes, because that sentence exists nowhere on a ticket
 * form and it is the reason the ticket exists at all.
 *
 * Run with: npm run check:notes-ticket-actions
 */
import {
  NO_DEPARTMENT,
  formatTicketAction,
  renderNotesMarkdown,
  ticketsByDepartment,
  type NotesDraft,
  type TicketAction,
} from "@/src/lib/contracts/follow-through-notes";

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean) {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error(`FAILED: ${label}`);
  }
}

const notes: NotesDraft = {
  title: "Oakline Dental · 2026-11-02",
  nps: 8,
  npsJustification: "Steady month.",
  goalQuarter: "Q4 2026",
  goalText: "40 booked implant consults a month",
  goalStatus: "On track",
  goalEvidence: "31 in October.",
  summary: "A steady month.",
  bullets: {},
  departments: [
    {
      department: "SEO",
      clientFeedback: "She wants the Tempe page moved along.",
      actions: [{ id: "a1", what: "the wording the model drafted", team: "SEO", due: "Friday" }],
    },
    { department: "Google Ads", clientFeedback: "The budget is fine as it is.", actions: [] },
  ],
  clientActions: [],
  pending: [],
};

const tickets: TicketAction[] = [
  {
    department: "SEO",
    what: "Rebuild the Tempe service page",
    owner: "Ana Delgado",
    due: "2026-11-14",
    url: "https://app.clickup.com/t/abc",
  },
  { department: "Billing", what: "Upsell — Oakline Dental", owner: "Carlos Camacho", notFiled: true },
];

const filed = renderNotesMarkdown(notes, { ticketActions: tickets });
const section = filed.split("## 3 ·")[1]?.split("\n## ")[0] || "";

// --- the ticket is the action item -----------------------------------------
check("the approved ticket is the action line", section.includes("**Action:** Rebuild the Tempe service page"));
check("the owner it was assigned to is on it", section.includes("Ana Delgado"));
check("so is the date it carries", section.includes("2026-11-14"));
check("and the ticket itself is linked", section.includes("[ticket](https://app.clickup.com/t/abc)"));
check("the draft wording it replaced is gone", !filed.includes("the wording the model drafted"));

// A ticket approved but never filed is said out loud. A silently link-less line reads as a ticket
// somebody simply forgot to click, where the truth is that ClickUp refused it.
check("an approved ticket ClickUp refused says so", section.includes("not filed in ClickUp"));

// --- what the client said stays -------------------------------------------
check("the client's own words are kept with their department", section.includes("She wants the Tempe page moved along."));
check(
  "a department that produced no ticket is still recorded",
  section.includes("The budget is fine as it is.") && section.includes("No ticket came out of this one."),
);

// --- no second copy of the same list ---------------------------------------
check("the tickets are not then listed again at the bottom", !filed.includes("## Tickets created"));

// --- grouping ---------------------------------------------------------------
const groups = ticketsByDepartment([
  { what: "a", department: "SEO" },
  { what: "b" },
  { what: "c", department: "SEO" },
]);
check("tickets group under their department in approval order", groups[0].department === "SEO" && groups[0].tickets.length === 2);
check("a ticket with no department is grouped rather than dropped", groups[1].department === NO_DEPARTMENT);

// --- the old shape still renders -------------------------------------------
// The QC pre-read and the on-screen preview render the notes before any ticket exists, so the
// draft-line form has to keep working. Only the FILED document is built from the tickets.
const preview = renderNotesMarkdown(notes);
check("without tickets the draft lines still render", preview.includes("the wording the model drafted"));

check(
  "a line with nothing but a name is still a line",
  formatTicketAction({ what: "Fix the sitemap" }) === "**Action:** Fix the sitemap",
);

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - whether ClickUp actually created the ticket, which the processing step owns");
console.log("  - the pending items in section 6, which are deliberately left out of section 3");
console.log("  - how ClickUp's importer renders the markdown");
if (failed) process.exitCode = 1;
