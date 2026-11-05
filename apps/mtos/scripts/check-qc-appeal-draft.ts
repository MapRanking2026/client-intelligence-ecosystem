/**
 * The AM's appeal form: what can be appealed, and when it may be sent.
 *
 * Pure checks: nothing is read from or written to Firestore.
 *
 * The rule the whole suite protects: **an appeal a reviewer cannot answer is worse for the AM than
 * a form that stopped them.** A request to raise a 5, to grade something marked N/A, or to change
 * a score with two words of explanation can only be declined -- and a declined appeal reads to the
 * person who filed it as having been dismissed. So every refusal here is in the AM's interest, and
 * each one is checked from both sides: that it blocks what it should, and that it does not block
 * anything else.
 */
import {
  APPEAL_INTRO,
  MIN_CONTEXT_LENGTH,
  appealBlockers,
  appealCandidates,
  appealHint,
  appealPicked,
  canAppeal,
  newAppealEntry,
  toAppealItems,
  type QcAppealDraft,
} from "@/src/lib/contracts/qc-appeal-draft";
import type { QcScoreValue } from "@/src/lib/contracts/qc-record";
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

const GOOD_CONTEXT = "Handled by email on 2 July, thread in Intercom";

// ---------------------------------------------------------------------------
// Which criteria can be appealed
// ---------------------------------------------------------------------------

const all3 = appealCandidates(crit(3));
check("every graded criterion below 5 is a candidate", all3.length === QC_CRITERION_COUNT);
check("candidates are in rubric order", all3[0].n === 1 && all3[1].n === 2);
check("the current score is carried", all3[0].current === 3);
check("the options are the scores above it", all3[0].options.join() === "4,5");

// Nothing sits above a 5. Offering the row would invite context that could change nothing.
check("a 5 cannot be appealed", appealCandidates(crit(5)).length === 0);
// N/A is not a low score; it is a statement that the criterion did not apply.
check("an N/A cannot be appealed", appealCandidates(crit(null)).length === 0);
check("an ungraded record has no candidates", appealCandidates(undefined).length === 0);
const mixed = appealCandidates(crit(5, { 4: 2, 9: null, 12: 4 }));
check("only the graded, sub-5 criteria are offered", mixed.map((c) => c.n).join() === "4,12");
check("a 4 offers only 5", mixed[1].options.join() === "5");
check("a 1 offers four options", appealCandidates(crit(1))[0].options.length === 4);

const withNote = appealCandidates(crit(2), { 1: { found: "No new date was given" } });
check("the reviewer's note is shown on the row", withNote[0].found === "No new date was given");
check("a criterion with no note carries none", withNote[1].found === undefined);
check(
  "a whitespace-only note is treated as none",
  appealCandidates(crit(2), { 1: { found: "   " } })[0].found === undefined,
);

check("a fresh entry asks for one point more", newAppealEntry(3).to === 4);
check("a fresh entry has no context yet", newAppealEntry(3).ctx === "");
check("a fresh entry on a 4 asks for 5", newAppealEntry(4).to === 5);

// ---------------------------------------------------------------------------
// What stops it being sent
// ---------------------------------------------------------------------------

const candidates = appealCandidates(crit(3));

check("an empty form needs a criterion", appealBlockers({}, candidates)[0] === "Pick at least one criterion");

const thin: QcAppealDraft = { 1: { to: 4, ctx: "no" } };
check("thin context blocks the send", appealBlockers(thin, candidates).length > 0);
check(
  "thin context says what is missing",
  appealBlockers(thin, candidates).some((blocker) => blocker.includes("context")),
);
check(
  `context of exactly ${MIN_CONTEXT_LENGTH} characters is still too thin`,
  appealBlockers({ 1: { to: 4, ctx: "a".repeat(MIN_CONTEXT_LENGTH) } }, candidates).length > 0,
);
check(
  `context of ${MIN_CONTEXT_LENGTH + 1} characters is enough`,
  appealBlockers({ 1: { to: 4, ctx: "a".repeat(MIN_CONTEXT_LENGTH + 1) } }, candidates).length === 0,
);
check(
  "whitespace does not count towards the length",
  appealBlockers({ 1: { to: 4, ctx: "  ab  " } }, candidates).length > 0,
);

// An appeal asking for the same number is a mistake in the form, not a request.
check(
  "asking for the same score blocks the send",
  appealBlockers({ 1: { to: 3, ctx: GOOD_CONTEXT } }, candidates).some((b) => b.includes("higher")),
);
check(
  "asking for a lower score blocks the send",
  appealBlockers({ 1: { to: 2, ctx: GOOD_CONTEXT } }, candidates).some((b) => b.includes("higher")),
);

const ready: QcAppealDraft = { 1: { to: 4, ctx: GOOD_CONTEXT }, 5: { to: 5, ctx: GOOD_CONTEXT } };
check("a complete form has no blockers", appealBlockers(ready, candidates).length === 0);
check("picked criteria are listed in order", appealPicked(ready).join() === "1,5");
check("an untouched criterion is not picked", !appealPicked(ready).includes(2));

const partial: QcAppealDraft = { 1: { to: 4, ctx: GOOD_CONTEXT }, 5: { to: 5, ctx: "x" } };
const partialBlockers = appealBlockers(partial, candidates);
check("one thin row of two blocks the send", partialBlockers.length > 0);
// It names the row rather than saying "add context for each", which would be wrong and confusing.
check("it names the row that is thin", partialBlockers.some((b) => b.includes("criterion 5")));
check(
  "all rows thin says each",
  appealBlockers({ 1: { to: 4, ctx: "x" }, 5: { to: 5, ctx: "y" } }, candidates).some((b) =>
    b.includes("each"),
  ),
);

check("the hint counts what is selected", appealHint(ready, candidates) === "2 selected");
check("the hint with nothing picked asks for one", appealHint({}, candidates).includes("at least one"));
check("the hint carries the blocker", appealHint(thin, candidates).includes("1 selected ·"));

// ---------------------------------------------------------------------------
// What gets stored
// ---------------------------------------------------------------------------

const items = toAppealItems(
  { 5: { to: 5, ctx: `  ${GOOD_CONTEXT}  `, link: "  https://example.com/t  " }, 1: { to: 4, ctx: GOOD_CONTEXT } },
  candidates,
);
check("items are in rubric order", items.map((item) => item.n).join() === "1,5");
check("context is trimmed", items[1].ctx === GOOD_CONTEXT);
check("a link is trimmed", items[1].link === "https://example.com/t");
check("the score asked for is kept", items[1].to === 5);
// An empty link stored as "" would render a dead "Evidence ↗" on the reviewer's screen.
check("an empty link is omitted rather than stored blank", items[0].link === undefined);
check(
  "a whitespace-only link is omitted",
  toAppealItems({ 1: { to: 4, ctx: GOOD_CONTEXT, link: "   " } }, candidates)[0].link === undefined,
);
check("a thin row is dropped rather than stored", toAppealItems(thin, candidates).length === 0);
check(
  "a row asking for no change is dropped",
  toAppealItems({ 1: { to: 3, ctx: GOOD_CONTEXT } }, candidates).length === 0,
);
check(
  "a row for a criterion that is not a candidate is dropped",
  toAppealItems({ 2: { to: 4, ctx: GOOD_CONTEXT } }, appealCandidates(crit(5, { 1: 3 }))).length === 0,
);
check("an empty draft stores nothing", toAppealItems({}, candidates).length === 0);

// ---------------------------------------------------------------------------
// Whether the touch can be appealed at all
// ---------------------------------------------------------------------------

check("the owner of a scored touch can appeal", canAppeal({ hasAppeal: false, hasScore: true, isOwner: true }));
// One appeal per touch: a second would leave two "from" scores with no way to order them.
check("a second appeal is refused", !canAppeal({ hasAppeal: true, hasScore: true, isOwner: true }));
check("an unscored touch cannot be appealed", !canAppeal({ hasAppeal: false, hasScore: false, isOwner: true }));
// Not the reviewer, not an admin. An appeal is written in the AM's own voice.
check("somebody else cannot appeal it", !canAppeal({ hasAppeal: false, hasScore: true, isOwner: false }));

check("the intro explains when to use it", APPEAL_INTRO.includes("QC didn't have the full picture"));
check("the intro says it is optional", APPEAL_INTRO.startsWith("Optional."));

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - the server-side re-check in `submitQcAppeal`, which needs a database");
console.log("  - the form's own markup and keyboard behaviour");
if (failed) process.exit(1);
