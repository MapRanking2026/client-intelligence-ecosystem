/**
 * What a QC submit writes, and what an appeal changes.
 *
 * Pure checks: nothing is read from or written to Firestore.
 *
 * Three rules are worth the suite. **Apply all suggestions never overwrites a human decision** --
 * the one way this feature could send a model's score out under a reviewer's name. **Empty is not
 * a value**, so a note nobody typed in and a coaching card with no idea are dropped rather than
 * rendered as QC having something to say and declining to say it. And **the appeal preview and the
 * saved result come from the same arithmetic**, because the preview is a promise in writing to the
 * AM.
 */
import {
  NOTES_OPEN_AT_OR_BELOW,
  appealDecisionsComplete,
  appealPreview,
  appealPreviewLabel,
  applyAllSuggestions,
  cleanCoaching,
  cleanNotes,
  draftToStore,
  finalizeSubmission,
  notesShouldOpen,
  prefillFound,
  submitBlockers,
  submitHint,
} from "@/src/lib/contracts/qc-submit";
import type { QcAiPreread, QcDraftValue, QcScoreValue } from "@/src/lib/contracts/qc-record";
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

function flat<T>(value: T): T[] {
  return Array.from({ length: QC_CRITERION_COUNT }, () => value);
}

const preread: QcAiPreread = {
  crit: flat<QcScoreValue>(4),
  evidence: flat("00:12:30 — the AM read the agenda out loud"),
  goal: "Partial",
  strengths: "Clear on the numbers.",
  focus: "Diagnose before proposing.",
  coaching: [],
  generatedAt: "2026-11-05T10:00:00.000Z",
  model: "test",
};

// ---------------------------------------------------------------------------
// Gating the submit
// ---------------------------------------------------------------------------

check("an empty form names every criterion", submitBlockers(flat<QcDraftValue>(-1), undefined)[0] === "17 criteria left");
check("an empty form also names the goal", submitBlockers(flat<QcDraftValue>(-1), undefined).includes("set the client goal KPI"));
check("one left is singular", submitBlockers([...flat<QcDraftValue>(4).slice(1), -1], "Yes")[0] === "1 criterion left");
check("a complete form has no blockers", submitBlockers(flat<QcDraftValue>(4), "Yes").length === 0);
// N/A is a decision, so a form of seventeen N/As is complete.
check("all N/A is a decided form", submitBlockers(flat<QcDraftValue>(null), "N/A").length === 0);
check("criteria without the goal still blocks", submitBlockers(flat<QcDraftValue>(4), undefined).length === 1);

check(
  "the hint states the consequence once complete",
  submitHint(flat<QcDraftValue>(4), "Yes", "Jordan") === "Score 80 (B) · Jordan gets a notification with the breakdown and coaching plan.",
);
check("the hint lists what is left while incomplete", submitHint(flat<QcDraftValue>(-1), undefined, "Jordan").includes("17 criteria left"));
// All N/A is complete but unscoreable. The bar must not claim a score.
check("an all-N/A form is not given a score in the hint", submitHint(flat<QcDraftValue>(null), "N/A", "Jordan").includes("No criterion applied"));
check("a missing first name still reads", submitHint(flat<QcDraftValue>(4), "Yes", "").includes("The account manager"));

// ---------------------------------------------------------------------------
// Apply all suggestions
// ---------------------------------------------------------------------------

const halfGraded: QcDraftValue[] = flat<QcDraftValue>(-1);
halfGraded[0] = 2;
halfGraded[1] = null;
const applied = applyAllSuggestions(halfGraded, {}, undefined, preread);
// The two the reviewer decided stay exactly as they were, including the explicit N/A.
check("a graded criterion is not overwritten", applied.crit[0] === 2);
check("an explicit N/A is not overwritten", applied.crit[1] === null);
check("an undecided criterion takes the suggestion", applied.crit[2] === 4);
check("the goal is taken from the pre-read when unset", applied.goal === "Partial");

const withGoal = applyAllSuggestions(halfGraded, {}, "Yes", preread);
check("a goal the reviewer set is not overwritten", withGoal.goal === "Yes");

check("applied suggestions fill the found note", applied.notes[3]?.found?.includes("00:12:30") === true);
const ownNote = applyAllSuggestions(flat<QcDraftValue>(-1), { 1: { found: "my own words" } }, undefined, preread);
check("a reviewer's own note is never replaced", ownNote.notes[1]?.found === "my own words");

// A criterion the model declined to grade is left undecided, not written as N/A.
const declined: QcAiPreread = { ...preread, crit: flat<QcScoreValue>(null) };
check(
  "a criterion the model declined stays undecided",
  applyAllSuggestions(flat<QcDraftValue>(-1), {}, undefined, declined).crit[0] === -1,
);
check(
  "no pre-read at all changes nothing",
  applyAllSuggestions(flat<QcDraftValue>(-1), {}, undefined, undefined).crit.every((value) => value === -1),
);

check("a blank note is prefilled from the evidence", prefillFound(undefined, "00:01:00 — something")?.found === "00:01:00 — something");
check("an existing note is left alone", prefillFound({ found: "mine" }, "00:01:00 — something")?.found === "mine");
check("no evidence leaves the note as it was", prefillFound(undefined, undefined) === undefined);
check("whitespace-only evidence is not a prefill", prefillFound(undefined, "   ") === undefined);

check("notes open at the threshold", notesShouldOpen(NOTES_OPEN_AT_OR_BELOW as QcDraftValue));
check("notes open below it", notesShouldOpen(1));
check("notes stay shut above it", !notesShouldOpen(4));
// N/A is not a low score, so it does not demand an explanation.
check("N/A does not open notes", !notesShouldOpen(null));
check("undecided does not open notes", !notesShouldOpen(-1));

// ---------------------------------------------------------------------------
// Empty is not a value
// ---------------------------------------------------------------------------

const notes = cleanNotes({ 1: { found: " a find " }, 2: { found: "   ", next: "" }, 3: { next: "try this" } });
check("a note is trimmed", notes[1]?.found === "a find");
check("an empty note is dropped", notes[2] === undefined);
check("a note with only advice is kept", notes[3]?.next === "try this");
check("no notes at all is an empty object", Object.keys(cleanNotes(undefined)).length === 0);

const coaching = cleanCoaching([
  { idea: " Ask first ", why: " because ", how: " like this ", skip: " when " },
  { idea: "   ", why: "x", how: "y", skip: "z" },
]);
check("a coaching card is trimmed", coaching[0].idea === "Ask first");
check("a card with no idea is dropped", coaching.length === 1);

// ---------------------------------------------------------------------------
// Finalising
// ---------------------------------------------------------------------------

const submission = finalizeSubmission({
  crit: flat<QcDraftValue>(4),
  notes: { 1: { found: "a find" }, 2: {} },
  goal: "Yes",
  strengths: "  good  ",
  focus: "   ",
  coaching: [{ idea: "one", why: "w", how: "h", skip: "s" }],
});
check("the score is computed", submission.score === 80);
check("the rating comes with it", submission.rating === "B");
check("every criterion is stored", submission.crit.length === QC_CRITERION_COUNT);
check("strengths are trimmed", submission.strengths === "good");
// Whitespace-only text is absent rather than stored as a blank heading on the AM's page.
check("whitespace-only focus is not stored", submission.focus === undefined);
check("empty notes did not survive", Object.keys(submission.notes).length === 1);

// An undecided value cannot reach a scored record as -1, whatever the caller did.
const folded = finalizeSubmission({ crit: flat<QcDraftValue>(-1), goal: "No" });
check("an undecided criterion is folded to N/A, never stored as -1", folded.crit.every((value) => value === null));
check("an all-N/A submission has no score", folded.score === null);
check("an all-N/A submission has no rating", folded.rating === undefined);

const stored = draftToStore({ crit: [4], notes: { 1: { found: "x" } }, goal: "Yes" }, "2026-11-05T10:00:00.000Z");
check("a short draft is padded to the full rubric", stored.crit.length === QC_CRITERION_COUNT);
check("the missing positions are undecided, not N/A", stored.crit[1] === -1);
check("the draft records when it was saved", stored.savedAt === "2026-11-05T10:00:00.000Z");
check("a draft with no goal stores none", draftToStore({ crit: [] }, "now").goal === undefined);
// An N/A must survive every autosave. Coalescing null with "never filled" would silently undo the
// reviewer's decision on each save and let the next suggestion overwrite it.
check("an N/A survives the draft round trip", draftToStore({ crit: [null, 4] }, "now").crit[0] === null);

// ---------------------------------------------------------------------------
// Appeals
// ---------------------------------------------------------------------------

const before: QcScoreValue[] = flat<QcScoreValue>(4);
const accepted = appealPreview(before, [{ n: 1, to: 5, accept: true }]);
check("an accepted appeal raises the score", accepted.from === 80 && accepted.to === 81);
check("the new rating comes with it", accepted.rating === "B");
check("an accepted appeal is a change", !accepted.unchanged);
check("the preview reads as an arrow", appealPreviewLabel(accepted) === "Score 80 → 81 (B)");

const declinedAppeal = appealPreview(before, [{ n: 1, to: 5, accept: false }]);
check("a declined appeal leaves the score alone", declinedAppeal.to === 80);
check("a declined appeal reports no change", declinedAppeal.unchanged);
check("the preview says the score stays", appealPreviewLabel(declinedAppeal) === "Score stays 80");

// A decision for a criterion the rubric no longer has must not be written past the array.
const outOfRange = appealPreview(before, [{ n: 99, to: 5, accept: true }]);
check("a decision outside the rubric is ignored", outOfRange.to === 80);

check("no score at all is said plainly", appealPreviewLabel(appealPreview(undefined, [])) === "No score on this touch");

const items = [
  { n: 1, to: 5, ctx: "QC did not see the email" },
  { n: 9, to: 4, ctx: "the number came from the client" },
];
check("an undecided appeal cannot be sent", !appealDecisionsComplete(items, [{ n: 1, to: 5, accept: true }]));
check("a fully decided appeal can be sent", appealDecisionsComplete(items, [
  { n: 1, to: 5, accept: true },
  { n: 9, to: 4, accept: false },
]));
// An appeal with no items is not "complete" -- there would be nothing to reply about.
check("an empty appeal is not complete", !appealDecisionsComplete([], []));

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - the transaction that writes a submission, which needs a Firestore emulator");
console.log("  - the notification the AM receives");
console.log("  - how the scoring screen and the submit bar look");
if (failed) process.exit(1);
