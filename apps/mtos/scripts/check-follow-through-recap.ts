/**
 * The client recap email.
 *
 * Pure checks: nothing is sent, nothing is read from Intercom. What they pin is what the email
 * promises, because the email IS the commitment -- a line in here that nobody approved is a
 * promise the agency now owes.
 */
import {
  buildRecapEmailDraft,
  buildRecapEmailHtml,
  recapBlockers,
  recapEmailHasBody,
  sanitizeRecapEmailHtml,
  type RecapEmailFacts,
  type RecapEmailSource,
} from "@/src/lib/contracts/follow-through-recap-email";
import type { NotesDraft } from "@/src/lib/contracts/follow-through-notes";
import type { FollowThroughItem } from "@/src/lib/contracts/follow-through-tickets";

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

const source: RecapEmailSource = {
  businessName: "Oakline Dental",
  contactName: "Mara Oakes",
  metLabel: "Mon, 2 November",
  nextCheckInLabel: "Mon, 7 December",
  nextCheckInUrl: "https://calendar.google.com/event?eid=abc",
  signoff: "Talk soon,\nAna\nMap Ranking",
  accountManagerName: "Ana",
  appUrl: "https://mtos.example.com",
  wins: [
    { what: "New Tempe landing page", shipped: "14 October" },
    { what: "Review responses caught up", shipped: "" },
  ],
};

const notes: NotesDraft = {
  title: "Oakline Dental · 2026-11-02",
  nps: 8,
  npsJustification: "Steady month.",
  goalQuarter: "Q4 2026",
  goalText: "40 booked implant consults a month",
  goalStatus: "On track",
  goalEvidence: "31 in October.",
  summary: "A steady month, with the Tempe page the one thing she wants moved along.",
  bullets: {},
  departments: [],
  clientActions: [
    { id: "c1", what: "Send the new team photos", due: "Wed 5 Nov", tentative: true },
    { id: "c2", what: "Approve the new homepage copy", due: "Fri 7 Nov" },
  ],
  pending: [],
};

function ticket(overrides: Partial<Extract<FollowThroughItem, { formType: "ticket" }>> = {}) {
  return {
    id: "t1",
    formType: "ticket" as const,
    taskName: "Rebuild the Tempe service page",
    description: "x",
    timeEstimateMinutes: 120,
    department: "Web Development",
    assignee: "Ana",
    priority: "normal" as const,
    dueDate: "2026-11-14",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// What the email promises
// ---------------------------------------------------------------------------

const draft = buildRecapEmailDraft(source, notes, [
  ticket({ decision: "approved" }),
  ticket({ id: "t2", taskName: "Rewrite the homepage intro", decision: "denied", dueDate: "2026-11-20" }),
  ticket({ id: "t3", taskName: "Add the new service area", dueDate: "2026-11-21" }),
]);

check("the subject follows the client recap template", draft.subject === "Monthly Touch Recap & Next Steps | Oakline Dental");
check("one approved item makes one commitment", draft.facts.commitments.length === 1);
check("it is the approved one", draft.facts.commitments[0].what === "Rebuild the Tempe service page");

// The two that matter most: a denied item and an undecided one are both promises we did not make.
check("a denied item is not promised", !draft.html.includes("Rewrite the homepage intro"));
check("an undecided item is not promised either", !draft.html.includes("Add the new service area"));

check("every client action becomes an ask", draft.facts.asks.length === 2);
check("tentative client task dates stay internal", !draft.html.includes("(we said roughly)"));
check("firm client task dates stay internal", !draft.html.includes("by Fri 7 Nov"));

check("the summary opens the email", draft.facts.intro === notes.summary);
check("the goal is carried into the facts row", draft.facts.goalLabel === "40 booked implant consults a month");
check("the goal appears in the business goals section", draft.html.includes("Business Goals &amp; Growth Targets") && draft.html.includes("40 booked implant consults a month"));

// ---------------------------------------------------------------------------
// Ship dates: real or absent, never guessed
// ---------------------------------------------------------------------------

check("a win with a date says when it shipped", draft.html.includes("shipped 14 October"));
check("a win without one says nothing rather than guessing", draft.html.includes("Review responses caught up"));
check(
  "and no vague filler is invented for it",
  !draft.html.toLowerCase().includes("shipped recently") && !draft.html.toLowerCase().includes("shipped soon"),
);

const undatedCommitment = buildRecapEmailDraft(source, notes, [
  ticket({ decision: "approved", dueDate: undefined }),
]);
check("an approved item with no date is a blocking gap", undatedCommitment.blockingGaps.length === 1);
check(
  "and the gap says what to do about it",
  undatedCommitment.blockingGaps[0].includes("Set the due dates"),
);
check(
  "the email does not invent one",
  !undatedCommitment.html.includes("By </div>") && !undatedCommitment.html.includes("By soon"),
);

// ---------------------------------------------------------------------------
// The design
// ---------------------------------------------------------------------------

check("the header says it is a recap", draft.html.includes("Recap &amp; Next Steps"));
check("the meeting date is shown", draft.html.includes(source.metLabel));
check("and the next check-in", draft.html.includes(source.nextCheckInLabel));
check("and the goal", draft.html.includes(notes.goalText));
check("unfinished client asks are not rendered", !draft.html.includes("📋 B &middot; What we need from you"));
check("unfinished team commitments are not rendered", !draft.html.includes("What Map Ranking will do"));
check("the next check-in is a button when there is a link", draft.html.includes("https://calendar.google.com/event?eid=abc"));
check("the follow-up channel is named", draft.html.includes("reply to this email"));
check("the sign-off is the AM's own", draft.html.includes("Ana<br>Map Ranking"));
check("the footer is Map Ranking's", draft.html.includes("mapranking.com"));

// Every mail client throws away something different from a modern layout; these are what survive.
check("it is table based", draft.html.includes('role="presentation"'));
check("it carries no external stylesheet", !draft.html.includes("<link"));
check("and no class names to be stripped", !draft.html.includes('class="'));
check("the logo is an https url, not a data uri or cid", draft.html.includes("https://mtos.example.com/brand/"));

const noLogo = buildRecapEmailHtml({ ...draft.facts, logoUrl: "" });
check("without a public app url the logo is simply left out", !noLogo.includes("<img"));

const noLink = buildRecapEmailHtml({ ...draft.facts, nextCheckInUrl: "javascript:alert(1)" });
check("a non-https next-check-in link is not rendered as a button", !noLink.includes("javascript:"));
check("but the date is still said in words", noLink.includes("Mon, 7 December"));

const escaped = buildRecapEmailHtml({ ...draft.facts, businessName: 'Oak & "Line" <Dental>' } as RecapEmailFacts);
check("the business name is escaped", escaped.includes("Oak &amp; &quot;Line&quot; &lt;Dental&gt;"));

// ---------------------------------------------------------------------------
// Editing, sanitising, and approving
// ---------------------------------------------------------------------------

check("a script pasted into the editor is removed", !sanitizeRecapEmailHtml('<p>Hi</p><script>evil()</script>').includes("script"));
check("an onerror attribute is removed", !sanitizeRecapEmailHtml('<img src="https://x/y.png" onerror="evil()">').includes("onerror"));
check("an https image survives", sanitizeRecapEmailHtml('<img src="https://x/y.png">').includes("https://x/y.png"));
check("the inline-styled tables survive", sanitizeRecapEmailHtml(draft.html).includes('role="presentation"'));

check("a real email has a body", recapEmailHasBody(draft.html));
check("an empty one does not", !recapEmailHasBody("<p></p>"));
check("and nor does one with only tags", !recapEmailHasBody('<div style="padding:30px"></div>'));

check("no recap at all blocks", recapBlockers(undefined, [])[0].includes("Build the recap email"));
check(
  "an undecided recap blocks",
  recapBlockers({ subject: "x", html: draft.html }, []).some((line) => line.includes("Decide the recap")),
);
check("a denied recap is decided", recapBlockers({ subject: "x", html: draft.html, decision: "denied" }, []).length === 0);
check(
  "an approved recap with no subject blocks",
  recapBlockers({ subject: " ", html: draft.html, decision: "approved" }, []).some((line) =>
    line.includes("no subject"),
  ),
);
check(
  "an approved but empty recap blocks",
  recapBlockers({ subject: "x", html: "<p></p>", decision: "approved" }, []).some((line) =>
    line.includes("almost nothing"),
  ),
);
check(
  "a complete approved recap blocks nothing",
  recapBlockers({ subject: "Recap", html: draft.html, decision: "approved" }, []).length === 0,
);
check(
  "the build's own gaps are carried through",
  recapBlockers({ subject: "Recap", html: draft.html, decision: "approved" }, undatedCommitment.blockingGaps).length === 1,
);

// ---------------------------------------------------------------------------
// The sign-off
// ---------------------------------------------------------------------------

const unsigned = buildRecapEmailDraft({ ...source, signoff: "", accountManagerName: "" }, notes, []);
check("no sign-off and no name is a blocking gap", unsigned.blockingGaps.some((gap) => /signature|unsigned/i.test(gap)));
const fallbackSigned = buildRecapEmailDraft({ ...source, signoff: "" }, notes, []);
check("a known name produces a sign-off rather than a gap", fallbackSigned.facts.signoff.includes("Ana"));
check("and no gap", !fallbackSigned.blockingGaps.some((gap) => gap.includes("unsigned")));

const noSummary = buildRecapEmailDraft(source, { ...notes, summary: "  " }, []);
check("no summary is a blocking gap", noSummary.blockingGaps.some((gap) => gap.includes("summary")));

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - how this renders in Gmail, Outlook or Apple Mail");
console.log("  - sending it through the AM's Intercom, which step 6f does");
console.log("  - the wins list, which comes from the client's shipped work rather than from here");
if (failed) process.exit(1);
