/**
 * Pins the one approval button: what it promises, and what a retry does.
 *
 * One click performs four outward writes — the approval itself, the client's agenda email, the
 * Client's Book page, and the call build. Four things here are requirements rather than behaviour
 * that happens to work:
 *
 *   1. A step that settled never runs again. The email is the reason: Intercom takes no
 *      idempotency key on `POST /messages`, so the stored conversation id is the only thing
 *      standing between a retry and a second email landing in the client's inbox.
 *   2. A failed step is returned again rather than stepped past. The Client's Book post and the
 *      call are both built from the approved sections, so an approval that did not record must
 *      not be followed by a filing nobody approved.
 *   3. The plan under the button is built from the same values the service uses, so the screen
 *      cannot promise one thing and the server do another.
 *   4. The filed brief distinguishes "declined" from "never written". Next month's preparation
 *      reads this page back, and a hole where a section should be is indistinguishable from a
 *      section the AM deliberately left out.
 *
 * Exercises the pure rules and the markdown the filing writes. The Firestore writes, the ClickUp
 * page call and the generators are listed at the end of the run.
 *
 * Run with: npm run check:touch-approval
 */
import { approvedBriefMarkdown, EMPTY_PREP_BRIEF } from "@/src/lib/contracts/prep-brief";
import { htmlToMarkdown, markdownToPlainText } from "@/src/lib/contracts/rich-text";
import {
  approvalHint,
  approvalIsComplete,
  approvalIsPartial,
  approvalPlan,
  APPROVAL_STEPS,
  APPROVAL_STEP_LABEL,
  emptyApprovalState,
  nextApprovalStep,
  stepIsSettled,
  type ApprovalStepId,
  type ApprovalStepStatus,
  type TouchApprovalState,
} from "@/src/lib/contracts/touch-approval";

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

/** An approval state with the named steps set, everything else still pending. */
function state(statuses: Partial<Record<ApprovalStepId, ApprovalStepStatus>>): TouchApprovalState {
  const next = emptyApprovalState();
  for (const [id, status] of Object.entries(statuses) as [ApprovalStepId, ApprovalStepStatus][]) {
    next.steps[id] = { status };
  }
  return next;
}

// ---------------------------------------------------------------------------
scenario("The four steps and their order");

check("there are exactly four", APPROVAL_STEPS.length === 4);
check(
  "in the order the service runs them",
  APPROVAL_STEPS.join(",") === "approve,email,book,build",
  APPROVAL_STEPS.join(","),
);
check(
  "every step has a label the AM can read",
  APPROVAL_STEPS.every((id) => (APPROVAL_STEP_LABEL[id] || "").length > 5),
);
check(
  "a fresh state has every step pending",
  APPROVAL_STEPS.every((id) => emptyApprovalState().steps[id].status === "pending"),
);

// ---------------------------------------------------------------------------
scenario("A settled step is one that will not run again");

check("done is settled", stepIsSettled({ status: "done" }));
check("skipped is settled — a declined email is a decision, not a gap", stepIsSettled({ status: "skipped" }));
check("pending is not settled", !stepIsSettled({ status: "pending" }));
check("running is not settled, so a crashed run retries that step", !stepIsSettled({ status: "running" }));
check("failed is not settled", !stepIsSettled({ status: "failed" }));
check("a missing step is not settled", !stepIsSettled(undefined));

// ---------------------------------------------------------------------------
scenario("Which step a run picks up");

check("a fresh approval starts at the approval itself", nextApprovalStep(emptyApprovalState()) === "approve");
check("no state at all starts at the beginning", nextApprovalStep(undefined) === "approve");
check("after the approval comes the email", nextApprovalStep(state({ approve: "done" })) === "email");
check(
  "a declined email is skipped over, not retried",
  nextApprovalStep(state({ approve: "done", email: "skipped" })) === "book",
);
check(
  "after the book comes the build",
  nextApprovalStep(state({ approve: "done", email: "done", book: "done" })) === "build",
);
check(
  "all four settled means there is nothing left to do",
  nextApprovalStep(state({ approve: "done", email: "done", book: "done", build: "done" })) === undefined,
);
check(
  "a failed email is returned again rather than stepped past",
  nextApprovalStep(state({ approve: "done", email: "failed", book: "done" })) === "email",
);
check(
  "a failed approval blocks everything after it, even steps that already landed",
  nextApprovalStep(state({ approve: "failed", email: "done", book: "done", build: "done" })) === "approve",
);
check(
  "a step left running is picked up again",
  nextApprovalStep(state({ approve: "done", email: "running" })) === "email",
);

// ---------------------------------------------------------------------------
scenario("Complete and partial");

check("all four settled is complete", approvalIsComplete(state({ approve: "done", email: "done", book: "done", build: "done" })));
check(
  "skipped counts towards complete",
  approvalIsComplete(state({ approve: "done", email: "skipped", book: "done", build: "done" })),
);
check("a fresh approval is not complete", !approvalIsComplete(emptyApprovalState()));
check("no state is not complete", !approvalIsComplete(undefined));
check(
  "one failed step means not complete",
  !approvalIsComplete(state({ approve: "done", email: "done", book: "done", build: "failed" })),
);

check("a fresh approval is not partial — nothing has happened yet", !approvalIsPartial(emptyApprovalState()));
check("no state is not partial", !approvalIsPartial(undefined));
check(
  "some landed and some did not is partial — the state a retry exists for",
  approvalIsPartial(state({ approve: "done", email: "done", book: "failed" })),
);
check(
  "a complete approval is not partial",
  !approvalIsPartial(state({ approve: "done", email: "done", book: "done", build: "done" })),
);

// ---------------------------------------------------------------------------
scenario("What the button promises, in the AM's words");

const plan = approvalPlan({
  approving: 14,
  declined: [],
  sendingEmail: true,
  recipient: "maya@oaklinedental.test",
  format: "guide",
  pageName: "Monthly Touch (11/5/2026)",
});

check("one line per outward write", plan.length === 4, String(plan.length));
check("it says how many sections are approved", plan[0].includes("all 14 brief sections"), plan[0]);
check("it names who the email goes to", plan[1].includes("maya@oaklinedental.test"), plan[1]);
check("it says the reply comes back to the AM", /reply comes back to you/i.test(plan[1]));
check("it names the Client's Book page by name", plan[2].includes("Monthly Touch (11/5/2026)"), plan[2]);
check(
  "and promises the empty write-up subpage inside it",
  plan[2].includes("Post Monthly Touch Notes"),
  plan[2],
);
check("it says the guide is built when the guide was chosen", /call guide/i.test(plan[3]), plan[3]);

const deckPlan = approvalPlan({
  approving: 12,
  declined: ["2", "9"],
  sendingEmail: false,
  recipient: "",
  format: "deck",
  pageName: "Monthly Touch (11/5/2026)",
});

check("declines are counted out of the total", deckPlan[0].includes("12 of 14"), deckPlan[0]);
check("and the declined sections are named", deckPlan[0].includes("sections 2, 9"), deckPlan[0]);
check("a declined email says plainly that the client is told nothing", /told nothing/i.test(deckPlan[1]), deckPlan[1]);
check("the deck is promised when the deck was chosen", /presentation/i.test(deckPlan[3]), deckPlan[3]);
check(
  "no recipient does not leave a dangling 'to'",
  !approvalPlan({
    approving: 14,
    declined: [],
    sendingEmail: true,
    recipient: "",
    format: "guide",
    pageName: "P",
  })[1].includes(" to  "),
);

check("the hint counts the sections", approvalHint({ approving: 14, declined: [] }) === "All 14 sections will be approved");
check(
  "the hint counts the declines",
  approvalHint({ approving: 12, declined: ["2", "9"] }) === "12 of 14 sections will be approved · 2 declined",
  approvalHint({ approving: 12, declined: ["2", "9"] }),
);
check(
  "once it has run, the hint says so instead of promising again",
  approvalHint({ approving: 14, declined: [], finishedAt: "just now" }) === "Approved and prepared just now.",
);

// ---------------------------------------------------------------------------
scenario("The editor's HTML becomes the markdown ClickUp stores");

check(
  "an ordered list is numbered per list, not per document",
  htmlToMarkdown("<ol><li>First</li><li>Second</li></ol>") === "1. First\n2. Second",
  JSON.stringify(htmlToMarkdown("<ol><li>First</li><li>Second</li></ol>")),
);
check(
  "a second list starts again at one",
  htmlToMarkdown("<ol><li>A</li></ol><ol><li>B</li></ol>")
    .split("\n")
    .filter((line) => line.startsWith("1.")).length === 2,
  JSON.stringify(htmlToMarkdown("<ol><li>A</li></ol><ol><li>B</li></ol>")),
);
check("an unordered list uses dashes", htmlToMarkdown("<ul><li>A</li><li>B</li></ul>") === "- A\n- B");
check("bold becomes double asterisks", htmlToMarkdown("<p>A <strong>win</strong></p>") === "A **win**");
check("b is bold too", htmlToMarkdown("<b>win</b>") === "**win**");
check("italic becomes one asterisk", htmlToMarkdown("<em>maybe</em>") === "*maybe*");
check("underline becomes bold, because markdown has no underline", htmlToMarkdown("<u>note</u>") === "**note**");
check("code keeps backticks", htmlToMarkdown("<code>CPL</code>") === "`CPL`");
check(
  "an https link keeps its address",
  htmlToMarkdown('<a href="https://x.test">Here</a>') === "[Here](https://x.test)",
);
check(
  "a javascript link keeps the text and loses the address",
  htmlToMarkdown('<a href="javascript:alert(1)">Here</a>') === "Here",
);
check("a script body never reaches the page", htmlToMarkdown("<p>A</p><script>bad()</script>") === "A");
check("entities are decoded", htmlToMarkdown("<p>Smith &amp; Sons &#39;26</p>") === "Smith & Sons '26");
check("paragraphs become blank lines", htmlToMarkdown("<p>A</p><p>B</p>") === "A\n\nB");
check("a br becomes one newline", htmlToMarkdown("A<br>B") === "A\nB");
check("runs of blank lines are collapsed", !/\n\n\n/.test(htmlToMarkdown("<p>A</p><p></p><p></p><p>B</p>")));
check("empty input gives an empty string", htmlToMarkdown("") === "");

check("plain text drops link syntax", markdownToPlainText("[Here](https://x.test)") === "Here");
check("plain text drops emphasis marks", markdownToPlainText("**A** and *B*") === "A and B");
check("plain text is one line", markdownToPlainText("A\n\nB") === "A B");

// ---------------------------------------------------------------------------
scenario("The approved brief is what gets filed, declines included");

const brief = {
  ...EMPTY_PREP_BRIEF,
  gaps: [{ item: "October call volume", whyItMatters: "We cannot size the win", askOrCheck: "Ask on the call" }],
  sections: [
    { id: "3" as const, title: "Client snapshot", markdown: "Oakline runs two chairs." },
    { id: "8" as const, subtitle: "Rank tracker", title: "Performance", markdown: "Tempe moved 6.2 to 4.1." },
  ],
};

const markdown = approvedBriefMarkdown(brief, { declinedSections: ["2"] }, {
  clientName: "Oakline Dental Group",
  callLabel: "Thu, November 5, 10:00 AM PST",
  accountManager: "Javier",
});

check("the client is in the title", markdown.startsWith("# Pre-Monthly Touch brief — Oakline Dental Group"));
check(
  "the call and the AM are stated",
  markdown.includes("Call: Thu, November 5, 10:00 AM PST · Account manager: Javier"),
);
check(
  "the gaps are listed under a warning heading",
  markdown.includes("## ⚠️ Missing — confirm before or during the call"),
);
check("a gap carries its reason", markdown.includes("**October call volume** — We cannot size the win"));
check("a gap carries its ask", markdown.includes("_Ask or check: Ask on the call_"));
check("a written section is included", markdown.includes("Oakline runs two chairs."));
check("a subsection keeps its own heading", markdown.includes("### Rank tracker"));
check(
  "a declined section leaves a line rather than a hole",
  markdown.includes("_Declined by the account manager — left out of this call._"),
);
check(
  "an unwritten section says so, so next month can tell it apart from a decline",
  markdown.includes("_The preparation did not write this section._"),
);
check("the brief header section is not filed as a section", !markdown.includes("## i."));

check(
  "an AM's edit replaces the agent's text",
  approvedBriefMarkdown(brief, { sectionEdits: { "3": "<p>My own <strong>words</strong></p>" } }, {
    clientName: "Oakline Dental Group",
    callLabel: "Thu, November 5",
  }).includes("My own **words**"),
);
check(
  "an edit is converted to markdown, not left as HTML",
  !approvedBriefMarkdown(brief, { sectionEdits: { "3": "<p>Mine</p>" } }, {
    clientName: "Oakline Dental Group",
    callLabel: "Thu, November 5",
  }).includes("<p>"),
);
check(
  "a decline beats an edit — a declined section stays out even if it was edited first",
  approvedBriefMarkdown(brief, { declinedSections: ["3"], sectionEdits: { "3": "<p>Mine</p>" } }, {
    clientName: "Oakline Dental Group",
    callLabel: "Thu, November 5",
  }).includes("_Declined by the account manager"),
);
check(
  "no account manager leaves the line without a trailing separator",
  approvedBriefMarkdown(brief, undefined, {
    clientName: "Oakline Dental Group",
    callLabel: "Thu, November 5",
  }).includes("Call: Thu, November 5\n"),
);
check(
  "no client name leaves the title without a dangling dash",
  approvedBriefMarkdown(brief, undefined, { clientName: "", callLabel: "Thu, November 5" }).startsWith(
    "# Pre-Monthly Touch brief\n",
  ),
  approvedBriefMarkdown(brief, undefined, { clientName: "", callLabel: "Thu, November 5" }).split("\n")[0],
);
check(
  "a brief with no gaps leaves the warning heading out",
  !approvedBriefMarkdown(EMPTY_PREP_BRIEF, undefined, { clientName: "X", callLabel: "Y" }).includes("⚠️ Missing"),
);
check(
  "an empty brief still produces a filed page rather than nothing",
  approvedBriefMarkdown(EMPTY_PREP_BRIEF, undefined, { clientName: "X", callLabel: "Y" }).length > 100,
);

// ---------------------------------------------------------------------------

console.log(`\n${checks - failures} of ${checks} checks passed.`);
console.log(
  [
    "",
    "Not covered here (needs Firestore and live integrations, so it is checked by hand against a",
    "real touch):",
    "  - that each step is persisted BEFORE and AFTER its attempt, which is what makes a crashed",
    "    run resumable rather than a run that silently did half the work",
    "  - the `mergeFields` on each write: the two call builders rewrite the whole touch they read,",
    "    so an overlapping whole-document merge would put back the pre-build version",
    "  - `filePrepNotesToClientBook` taking the existing page id, so a second approval edits that",
    "    page instead of leaving two differently-dated briefs in the Client's Book",
    "  - that a missing integration permission degrades to a warning and a 'send it yourself'",
    "    rather than a crash",
  ].join("\n"),
);

if (failures > 0) {
  process.exitCode = 1;
}
