/**
 * Pins the shape of the restructured Monthly Touch workflow: five stages, in order, each holding
 * its parts in one order, with one hand-over between them and one email.
 *
 * Four things here are requirements rather than behaviour that happens to work:
 *
 *   1. There is one progress indicator and it has five stages, Prep → Review → Live →
 *      Follow-Through → QA. There used to be three indicators -- the rail, a second numbered rail
 *      inside the preparation panel for its own four sub-steps, and a card between them naming a
 *      stage of its own. Each was right about something different, so "where am I" had three
 *      answers. The order lives in one list and the screen renders from it.
 *   2. Prep holds the touch until all fifteen brief sections are populated, and hands over to
 *      Review by itself when they are. The gate is the brief rather than the stage record: until
 *      9 November 2026 every section of every brief read "the preparation did not write this
 *      section", because the response was rebuilt from six keys and the sections were dropped
 *      before the brief reader saw them, and the stage record said `complete` throughout.
 *   3. Review's four parts are in the order the AM has to decide them: the brief, then the client
 *      email, then the format the approval will build, then the approval.
 *   4. The agenda email is sent at most once, whichever of the two buttons asks. "Approve and
 *      Send" sends it from the review screen and the approval sends it if it is still waiting;
 *      Intercom takes no idempotency key on `POST /messages`, so the stored conversation id is the
 *      only thing standing between the second press and a second agenda in a client's inbox.
 *
 * Exercises the pure rules -- the orders, the brief gate, the stage derivation and the plan the
 * approval prints -- rather than the service around them: a rule that needs Firestore to run is a
 * rule nobody checks. What is NOT covered is listed at the end of the run.
 *
 * Run with: npm run check:touch-stages
 */
import {
  BRIEF_BODY_SECTION_IDS,
  BRIEF_SECTIONS,
  briefCompleteness,
  EMPTY_PREP_BRIEF,
  type BriefSectionId,
  type PrepBrief,
} from "@/src/lib/contracts/prep-brief";
import {
  DEFAULT_LIVE_CALL_FORMAT,
  PREP_SECTION_LABEL,
  PREP_SECTION_ORDER,
  PREP_SECTION_PURPOSE,
  REVIEW_SECTION_LABEL,
  REVIEW_SECTION_ORDER,
  REVIEW_SECTION_PURPOSE,
  TOUCH_STAGE_PURPOSE,
} from "@/src/lib/contracts/touch-stages";
import { TOUCH_STEPS, TOUCH_STEP_SHORT, advanceProgress, resolveOpeningStep } from "@/src/lib/contracts/touch-progress";
import {
  APPROVAL_STEPS,
  approvalPlan,
  emptyApprovalState,
  nextApprovalStep,
  stepIsSettled,
  type ApprovalStepId,
  type ApprovalStepStatus,
  type TouchApprovalState,
} from "@/src/lib/contracts/touch-approval";
import { deriveRunSheetStage } from "@/src/lib/server/services/prep-readiness-service";
import type { MonthlyTouchRecord } from "@/src/lib/mtos-data";

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

// ---------------------------------------------------------------------------
scenario("One timeline, five stages, in the owner's order");

check("there are exactly five", TOUCH_STEPS.length === 5, String(TOUCH_STEPS.length));
check(
  "Prep, Review, Live, Follow-Through, QA",
  TOUCH_STEPS.join(",") === "prep,review,live,follow,qa",
  TOUCH_STEPS.join(","),
);
check(
  "every stage has a short name for the rail",
  TOUCH_STEPS.every((step) => (TOUCH_STEP_SHORT[step] || "").length > 1),
);
check(
  "and a line saying what it is for, so the rail does not need a second one under it",
  TOUCH_STEPS.every((step) => (TOUCH_STAGE_PURPOSE[step] || "").length > 20),
);
check(
  "an earlier stage can be revisited without the touch moving back",
  advanceProgress("live", "review") === "live",
);
check(
  "and the screen opens on the one that was asked for",
  resolveOpeningStep("live", "review") === "review",
);
check(
  "a stage the touch has not reached is not opened",
  resolveOpeningStep("prep", "live") === "prep",
);

// ---------------------------------------------------------------------------
scenario("Prep holds three parts, in this order");

check("three parts", PREP_SECTION_ORDER.length === 3, String(PREP_SECTION_ORDER.length));
check(
  "the Google Meet sync, readiness and confidence, then the account review",
  PREP_SECTION_ORDER.join(",") === "meet_sync,readiness,account_review",
  PREP_SECTION_ORDER.join(","),
);
check(
  "the meeting is confirmed before anything quotes its time at a client",
  PREP_SECTION_ORDER.indexOf("meet_sync") < PREP_SECTION_ORDER.indexOf("account_review"),
);
check(
  "readiness is read before the five-minute review is started, not after",
  PREP_SECTION_ORDER.indexOf("readiness") < PREP_SECTION_ORDER.indexOf("account_review"),
);
check(
  "every part is labelled and explained",
  PREP_SECTION_ORDER.every(
    (id) => (PREP_SECTION_LABEL[id] || "").length > 5 && (PREP_SECTION_PURPOSE[id] || "").length > 20,
  ),
);

// ---------------------------------------------------------------------------
scenario("Review holds four parts, in the order they are decided");

check("four parts", REVIEW_SECTION_ORDER.length === 4, String(REVIEW_SECTION_ORDER.length));
check(
  "the brief, the client email, the call format, the approval",
  REVIEW_SECTION_ORDER.join(",") === "brief,confirmation_email,call_format,approval",
  REVIEW_SECTION_ORDER.join(","),
);
check(
  "the brief is read before the email that describes it",
  REVIEW_SECTION_ORDER.indexOf("brief") < REVIEW_SECTION_ORDER.indexOf("confirmation_email"),
);
check(
  "the format is chosen before the button that builds it",
  REVIEW_SECTION_ORDER.indexOf("call_format") < REVIEW_SECTION_ORDER.indexOf("approval"),
);
check("the approval is last", REVIEW_SECTION_ORDER[REVIEW_SECTION_ORDER.length - 1] === "approval");
check(
  "every part is labelled and explained",
  REVIEW_SECTION_ORDER.every(
    (id) => (REVIEW_SECTION_LABEL[id] || "").length > 5 && (REVIEW_SECTION_PURPOSE[id] || "").length > 20,
  ),
);
check("a presentation is what a review runs on unless the AM says otherwise", DEFAULT_LIVE_CALL_FORMAT === "deck");

// ---------------------------------------------------------------------------
scenario("The brief has fifteen sections, and Prep counts them");

check("fifteen, without the header", BRIEF_BODY_SECTION_IDS.length === 15, String(BRIEF_BODY_SECTION_IDS.length));
check("the header is not one of them", !BRIEF_BODY_SECTION_IDS.includes("h"));
check(
  "they are 1 through 15 in order",
  BRIEF_BODY_SECTION_IDS.join(",") === "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15",
  BRIEF_BODY_SECTION_IDS.join(","),
);
check("the registry is the header plus those fifteen", BRIEF_SECTIONS.length === 16, String(BRIEF_SECTIONS.length));

/** A brief whose named sections carry text. */
function briefWith(ids: BriefSectionId[]): PrepBrief {
  return {
    ...EMPTY_PREP_BRIEF,
    sections: ids.map((id) => ({ id, title: `Section ${id}`, markdown: `What section ${id} found.` })),
  };
}

const everySection = BRIEF_BODY_SECTION_IDS.filter((id) => id !== "15");
const whole = briefCompleteness(briefWith(everySection));

check("a brief with every section written is ready", whole.ready);
check("and counts all fifteen", whole.populated === 15, String(whole.populated));
check("with nothing missing", whole.missing.length === 0, whole.missing.join(","));

const nothing = briefCompleteness(undefined);
check("no brief at all is not ready", !nothing.ready);
check(
  "it counts only section 15, which the agenda email fills rather than the model",
  nothing.populated === 1,
  String(nothing.populated),
);
check("and names the fourteen the preparation owes", nothing.missing.length === 14, String(nothing.missing.length));

const emptyMarkdown = briefCompleteness({
  ...EMPTY_PREP_BRIEF,
  sections: everySection.map((id) => ({ id, title: `Section ${id}`, markdown: "   " })),
});
check(
  "a section with a heading and no text under it is not written -- the November regression",
  !emptyMarkdown.ready,
  `populated ${emptyMarkdown.populated}`,
);

const halfWritten = briefCompleteness(briefWith(["1", "2", "3"]));
check("a half-written brief is not ready", !halfWritten.ready);
check("the sections that are empty are named, in brief order", halfWritten.missing[0] === "4", halfWritten.missing.join(","));
check(
  "and section 15 is never counted against the preparation",
  !halfWritten.missing.includes("15"),
  halfWritten.missing.join(","),
);

check(
  "the AM's own words are not a gap",
  briefCompleteness(briefWith(everySection.filter((id) => id !== "9")), {
    sectionEdits: { "9": "<p>I wrote this one myself.</p>" },
  }).ready,
);
check(
  "an empty edit is not words",
  !briefCompleteness(briefWith(everySection.filter((id) => id !== "9")), { sectionEdits: { "9": "  " } }).ready,
);
check(
  "a decline is a decision about a section, not a hole in it",
  briefCompleteness(briefWith(everySection.filter((id) => id !== "9")), { declinedSections: ["9"] }).ready,
);

// ---------------------------------------------------------------------------
scenario("Prep hands over to Review only once the brief is whole");

const NOW = "2026-11-10T17:00:00.000Z";

function workflowStages(research: "ready" | "complete" | "failed") {
  return {
    version: 2 as const,
    stages: {
      research: { status: research },
      confirmation_email: { status: "blocked" as const },
      prep_notes: { status: "blocked" as const },
      clickup_filing: { status: "blocked" as const },
    },
    updatedAt: NOW,
  };
}

function touch(overrides: Partial<MonthlyTouchRecord> = {}): MonthlyTouchRecord {
  return {
    id: "touch-1",
    clientId: "client-1",
    status: "Preparing",
    agenda: [],
    commitments: [],
    aiRecommendations: [],
    ...overrides,
  } as unknown as MonthlyTouchRecord;
}

check("a touch nobody has prepared is in Prep", deriveRunSheetStage(touch()) === "prep");
check(
  "a failed account review stays in Prep",
  deriveRunSheetStage(
    touch({ prepWorkflow: workflowStages("failed") as never, prepBrief: briefWith(everySection) }),
  ) === "prep",
);
check(
  "a finished review with a half-written brief stays in Prep -- nobody reviews a brief with holes",
  deriveRunSheetStage(
    touch({ prepWorkflow: workflowStages("complete") as never, prepBrief: briefWith(["1", "2"]) }),
  ) === "prep",
);
check(
  "a finished review with no brief at all stays in Prep",
  deriveRunSheetStage(touch({ prepWorkflow: workflowStages("complete") as never })) === "prep",
);
check(
  "a finished review and a whole brief opens Review",
  deriveRunSheetStage(
    touch({ prepWorkflow: workflowStages("complete") as never, prepBrief: briefWith(everySection) }),
  ) === "review",
);
check(
  "the sections the AM wrote themselves count towards the hand-over",
  deriveRunSheetStage(
    touch({
      prepWorkflow: workflowStages("complete") as never,
      prepBrief: briefWith(everySection.filter((id) => id !== "11")),
      review: { sectionEdits: { "11": "<p>The goal, in my words.</p>" } } as never,
    }),
  ) === "review",
);

/** An approval with the named steps set, everything else still pending. */
function approval(statuses: Partial<Record<ApprovalStepId, ApprovalStepStatus>>): TouchApprovalState {
  const next = emptyApprovalState();
  for (const [id, status] of Object.entries(statuses) as [ApprovalStepId, ApprovalStepStatus][]) {
    next.steps[id] = { status };
  }
  return next;
}

check(
  "the one approval is what opens Live",
  deriveRunSheetStage(
    touch({
      prepWorkflow: workflowStages("complete") as never,
      prepBrief: briefWith(everySection),
      approval: approval({ approve: "done", email: "done", book: "done", build: "done" }),
    }),
  ) === "live",
);
check(
  "a skipped email still opens Live -- not sending one is a decision, not a gap",
  deriveRunSheetStage(
    touch({
      prepWorkflow: workflowStages("complete") as never,
      prepBrief: briefWith(everySection),
      approval: approval({ approve: "done", email: "skipped", book: "done", build: "done" }),
    }),
  ) === "live",
);
check(
  "a part-way approval does not open Live",
  deriveRunSheetStage(
    touch({
      prepWorkflow: workflowStages("complete") as never,
      prepBrief: briefWith(everySection),
      approval: approval({ approve: "done", email: "done", book: "failed" }),
    }),
  ) === "review",
);
check(
  "the call having happened beats everything before it",
  deriveRunSheetStage(touch({ status: "Live" })) === "live",
);

// ---------------------------------------------------------------------------
scenario("The approval fans out to all four, and resumes rather than repeating");

check("four outward steps", APPROVAL_STEPS.length === 4);
check(
  "the brief, the email, the Client's Book, the call",
  APPROVAL_STEPS.join(",") === "approve,email,book,build",
  APPROVAL_STEPS.join(","),
);
check(
  "a run that stopped at the Client's Book picks up there, not at the email",
  nextApprovalStep(approval({ approve: "done", email: "done", book: "failed" })) === "book",
  String(nextApprovalStep(approval({ approve: "done", email: "done", book: "failed" }))),
);
check(
  "a failed build is the only thing left to do",
  nextApprovalStep(approval({ approve: "done", email: "done", book: "done", build: "failed" })) === "build",
);
check(
  "nothing is left when all four settled",
  nextApprovalStep(approval({ approve: "done", email: "done", book: "done", build: "done" })) === undefined,
);
check("a sent email is settled, so it is never sent again", stepIsSettled({ status: "done" }));
check("a skipped email is settled too", stepIsSettled({ status: "skipped" }));
check("a failed email is not settled, so it can be retried", !stepIsSettled({ status: "failed" }));

// ---------------------------------------------------------------------------
scenario("The email goes out once, whichever button asks");

const base = {
  approving: 15,
  declined: [] as string[],
  recipient: "maya@oaklinedental.test",
  format: "deck" as const,
  pageName: "Monthly Touch (11/10/2026)",
};

const willSend = approvalPlan({ ...base, sendingEmail: true });
const alreadyGone = approvalPlan({ ...base, sendingEmail: true, alreadySent: true });
const notSending = approvalPlan({ ...base, sendingEmail: false });

check("a waiting email is promised to the named address", willSend[1].includes("maya@oaklinedental.test"), willSend[1]);
check("and says it will be sent", /^Send the agenda email/.test(willSend[1]), willSend[1]);
check(
  "an email the AM already sent is promised NOT to be sent again",
  /not send the agenda email again/i.test(alreadyGone[1]),
  alreadyGone[1],
);
check("and says plainly that it goes out once", /once/i.test(alreadyGone[1]), alreadyGone[1]);
check(
  "an already-sent email is never described as one the client was not sent",
  !/told nothing/i.test(alreadyGone[1]),
  alreadyGone[1],
);
check(
  "moving forward without it says plainly that the client is told nothing",
  /told nothing/i.test(notSending[1]),
  notSending[1],
);
check(
  "the three cases are three different sentences",
  new Set([willSend[1], alreadyGone[1], notSending[1]]).size === 3,
);
check(
  "the deck is what the approval builds when the deck was chosen",
  /presentation/i.test(willSend[3]),
  willSend[3],
);
check(
  "the Client's Book page is named, so the AM can catch a wrong date",
  willSend[2].includes("Monthly Touch (11/10/2026)"),
  willSend[2],
);

// ---------------------------------------------------------------------------

console.log(`\n${checks - failures} of ${checks} checks passed.`);
console.log(
  [
    "",
    "Not covered here (needs Firestore, Intercom and ClickUp, so it is checked by hand against a",
    "real touch):",
    "  - the hand-over write itself: `runResearchStage` advances the stored marker to `review`",
    "    when the brief comes back whole, and swallows a failure to do so, because a preparation",
    "    that succeeded must not report a failure over a convenience",
    "  - `sendAgendaEmailNow` being the only sender: the idempotency check reads this touch's own",
    "    `sentAt` AND the Intercom conversation id, the second of which survives a write whose",
    "    response was lost",
    "  - the sticky rail's offset under the topbar, which is a CSS variable and a browser",
    "  - the Live screen's poll noticing the generated deck or guide and reloading once",
  ].join("\n"),
);

if (failures > 0) {
  process.exitCode = 1;
}
