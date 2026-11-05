/**
 * Closing the loop: a submitted QC becoming the next call's coaching block.
 *
 * Pure checks: nothing is read from or written to Firestore.
 *
 * Two rules the whole suite protects.
 *
 * **The ids have to be stable.** The AM's Use / Adapt / Skip answers are stored in
 * `review.coaching`, keyed by proposal id. An id that changed between renders would detach a
 * decision from the item it was made about and quietly show the AM an answer they never gave.
 *
 * **Every proposal says where it came from and when to skip it.** A coaching idea with no stated
 * exception is one an AM will carry into a call where it is wrong, and one with no provenance is
 * advice from nobody. Both fields are checked to be non-empty on every item, including the ones
 * built from a reviewer who left the field blank.
 */
import { EMPTY_PREP_BRIEF, type BriefProposal, type PrepBrief } from "@/src/lib/contracts/prep-brief";
import {
  LOW_SCORE_AT_OR_BELOW,
  QC_CONTENT_CRITERION,
  lowestCriteria,
  mergeQcIntoBrief,
  qcToBriefCoaching,
} from "@/src/lib/contracts/qc-coaching";
import type { CoachingItem, QcScoreValue, TouchQc } from "@/src/lib/contracts/qc-record";
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

function crit(value: QcScoreValue, overrides: Record<number, QcScoreValue> = {}): QcScoreValue[] {
  const out = Array.from({ length: QC_CRITERION_COUNT }, () => value);
  for (const [n, override] of Object.entries(overrides)) out[Number(n) - 1] = override;
  return out;
}

const coachingItem: CoachingItem = {
  idea: "Open with the booked jobs number",
  why: "At 00:12:40 the call opened with rankings and the owner asked twice about calls.",
  how: "Last month you booked 14 jobs from Maps — let's start there.",
  skip: "Skip it if the client opens with a complaint.",
};

function qc(partial: Partial<TouchQc> = {}): TouchQc {
  return {
    status: "scored",
    rubricVersion: "placeholder-17-v1",
    readyAt: "2026-07-04T10:00:00.000Z",
    evidence: [],
    tickets: 3,
    crit: crit(4),
    score: 80,
    rating: "B",
    ...partial,
  };
}

const base = {
  touchId: "touch-1",
  client: "Oakline Dental Group",
  date: "2026-07-03",
  sameClient: true,
};

// ---------------------------------------------------------------------------
// The lowest criteria
// ---------------------------------------------------------------------------

const lowest = lowestCriteria(crit(4, { 6: 2, 9: 1, 14: 3 }));
check("worst first", lowest.map((row) => row.n).join() === "9,6,14");
check("three by default", lowest.length === 3);
check("the value is carried", lowest[0].value === 1);
// N/A is not a weakness; a criterion that did not apply was not done badly.
check("N/A is skipped", !lowestCriteria(crit(5, { 2: null })).some((row) => row.n === 2));
check("an ungraded record has none", lowestCriteria(undefined).length === 0);
// Ties break on the lower number, which is what makes the ids below reproducible.
const tied = lowestCriteria(crit(5, { 3: 2, 11: 2, 15: 2 }));
check("ties break on the criterion number", tied.map((row) => row.n).join() === "3,11,15");
check("the count is adjustable", lowestCriteria(crit(3), 1).length === 1);

// ---------------------------------------------------------------------------
// Turning a QC into coaching
// ---------------------------------------------------------------------------

check(
  "a record with nothing in it produces nothing",
  qcToBriefCoaching({ ...base, qc: qc({ crit: undefined, coaching: [] }) }) === undefined,
);

const fromPlan = qcToBriefCoaching({ ...base, qc: qc({ coaching: [coachingItem] }) });
check("the reviewer's plan becomes the focus list", fromPlan?.focus.length === 1);
check("the idea is carried through", fromPlan?.focus[0].idea === coachingItem.idea);
check("how it could sound is carried through", fromPlan?.focus[0].howItCouldSound === coachingItem.how);
check("when to skip is carried through", fromPlan?.focus[0].whenToSkip === coachingItem.skip);
check("the why names the call it came from", fromPlan?.focus[0].why.includes("Oakline Dental Group") === true);
check("the why names the date", fromPlan?.focus[0].why.includes("Jul 3, 2026") === true);
check("the why names the score", fromPlan?.focus[0].why.includes("scored 80") === true);

// A reviewer who left "skip it when" blank must not produce an item with no exception.
const noSkip = qcToBriefCoaching({
  ...base,
  qc: qc({ coaching: [{ ...coachingItem, skip: "", why: "" }] }),
});
check("a blank exception is filled rather than left empty", (noSkip?.focus[0].whenToSkip.length || 0) > 10);
check("a blank why still says where it came from", noSkip?.focus[0].why.includes("Oakline") === true);

const blankIdea = qcToBriefCoaching({
  ...base,
  qc: qc({ coaching: [{ idea: "   ", why: "x", how: "", skip: "" }] }),
});
check("an item with no idea is dropped", blankIdea?.focus.length === 0);

// ---------------------------------------------------------------------------
// The ids
// ---------------------------------------------------------------------------

const again = qcToBriefCoaching({ ...base, qc: qc({ coaching: [coachingItem] }) });
check("the same QC yields the same focus id", fromPlan?.focus[0].id === again?.focus[0].id);
check("the id names the touch it came from", fromPlan?.focus[0].id.includes("touch-1") === true);

const lowProposals = qcToBriefCoaching({
  ...base,
  qc: qc({ crit: crit(5, { 6: 2, 9: 3 }), coaching: [] }),
});
const lowAgain = qcToBriefCoaching({
  ...base,
  qc: qc({ crit: crit(5, { 6: 2, 9: 3 }), coaching: [] }),
});
check(
  "the same QC yields the same proposal ids",
  lowProposals?.proposals.map((p) => p.id).join() === lowAgain?.proposals.map((p) => p.id).join(),
);
// Keyed by criterion, not by position: a criterion that moves up the list keeps its id, so the
// AM's answer stays attached to the point it was about.
check(
  "a proposal id is keyed by its criterion",
  lowProposals?.proposals.some((p) => p.id.endsWith("-low-6")) === true,
);
const allIds = [...(lowProposals?.proposals || []), ...(fromPlan?.focus || [])].map((p) => p.id);
check("ids are unique", new Set(allIds).size === allIds.length);

// ---------------------------------------------------------------------------
// Which criteria become proposals
// ---------------------------------------------------------------------------

check("a low criterion becomes a proposal", lowProposals?.proposals.length === 2);
// A criterion the reviewer was happy with is not something to work on next month.
const solid = qcToBriefCoaching({ ...base, qc: qc({ crit: crit(5, { 6: 4 }), coaching: [] }) });
check(
  `nothing above ${LOW_SCORE_AT_OR_BELOW} becomes a proposal`,
  solid?.proposals.length === 0,
);

const withNotes = qcToBriefCoaching({
  ...base,
  qc: qc({
    crit: crit(5, { 6: 2 }),
    notes: { 6: { found: "Rankings came first at 00:12:40", next: "Lead with booked jobs" } },
    coaching: [],
  }),
});
check("the reviewer's next-time note becomes the idea", withNotes?.proposals[0].idea === "Lead with booked jobs");
check("the finding becomes the why", withNotes?.proposals[0].why.startsWith("Rankings came first") === true);
check(
  "every proposal has an exception",
  (withNotes?.proposals || []).every((p) => p.whenToSkip.length > 10),
);

const noNote = qcToBriefCoaching({ ...base, qc: qc({ crit: crit(5, { 6: 2 }), coaching: [] }) });
check("with no note the idea falls back to the criterion", (noNote?.proposals[0].idea.length || 0) > 10);
check("with no note the why still carries the score", noNote?.proposals[0].why.includes("2 out of 5") === true);

const content = qcToBriefCoaching({
  ...base,
  qc: qc({
    crit: crit(5, { [QC_CONTENT_CRITERION]: 3 }),
    notes: { [QC_CONTENT_CRITERION]: { found: "No testimonial was asked for", next: "Ask for one reaction" } },
    coaching: [],
  }),
});
check("the content criterion gets its own proposal", content?.proposals[0].id.endsWith("-content") === true);
check("the content proposal leads", content?.proposals[0].idea === "Ask for one reaction");
// It must not appear twice: once as the content proposal and again in the lowest list.
check("the content criterion is not duplicated", content?.proposals.length === 1);

// ---------------------------------------------------------------------------
// Which client it came from
// ---------------------------------------------------------------------------

const other = qcToBriefCoaching({ ...base, sameClient: false, qc: qc({ coaching: [coachingItem] }) });
check("another client's QC names that client", other?.note.includes("Oakline Dental Group") === true);
check("the same client's QC says this client", fromPlan?.note.includes("this client") === true);
check("the note says they are proposals", fromPlan?.note.includes("not orders") === true);
check("the source records which client it was", other?.source.sameClient === false);

// ---------------------------------------------------------------------------
// The merge
// ---------------------------------------------------------------------------

const modelFocus: BriefProposal = {
  id: "model-1",
  idea: "Something the model found in the tracker",
  why: "because",
  howItCouldSound: "",
  whenToSkip: "never",
};
const modelProposal: BriefProposal = { ...modelFocus, id: "model-2", idea: "A content idea" };
const brief: PrepBrief = {
  ...EMPTY_PREP_BRIEF,
  focus: [modelFocus],
  proposals: [modelProposal],
};

check("no QC leaves the brief alone", mergeQcIntoBrief(brief, undefined) === brief);

const merged = mergeQcIntoBrief(brief, fromPlan);
check("the reviewer's plan replaces the model's focus", merged.focus.length === 1);
check("the replacement is the QC's own item", merged.focus[0].id === fromPlan?.focus[0].id);

// The brief's own proposals are this client's content and strategy ideas -- a different question
// from how the last call went. Dropping them would lose work rather than replace it.
const mergedLow = mergeQcIntoBrief(brief, lowProposals);
check("the model's proposals are kept", mergedLow.proposals.some((p) => p.id === "model-2"));
check("QC's proposals come first", mergedLow.proposals[0].id.startsWith("qc-"));
check("nothing is lost", mergedLow.proposals.length === (lowProposals?.proposals.length || 0) + 1);

// A QC with no coaching plan must not blank out the focus the model did write.
const planless = qcToBriefCoaching({ ...base, qc: qc({ crit: crit(5, { 6: 2 }), coaching: [] }) });
check("an empty plan leaves the model's focus standing", mergeQcIntoBrief(brief, planless).focus[0].id === "model-1");

const duplicate = mergeQcIntoBrief(
  { ...brief, proposals: [{ ...modelProposal, idea: withNotes?.proposals[0].idea || "" }] },
  withNotes,
);
check("the same idea is not added twice", duplicate.proposals.length === 1);

check("the brief itself is not mutated", brief.focus[0].id === "model-1" && brief.proposals.length === 1);

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - the query that finds the latest submitted QC, which needs a database");
console.log("  - how the coaching block renders, and the Use / Adapt / Skip controls on it");
if (failed) process.exit(1);
