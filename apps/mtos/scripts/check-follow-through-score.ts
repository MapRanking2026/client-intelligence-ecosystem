/**
 * The rules of the follow-through's score gate.
 *
 * Pure checks: no transcript, no model, no Firestore. What they pin is the arithmetic of the caps
 * and the wording of the refusals, because both are read by an account manager under time
 * pressure and both decide what happens to a real client's account.
 */
import {
  RED_FLAGS,
  aboveCapWarning,
  capForFinding,
  fallbackJustification,
  isScoreValue,
  recommendedCap,
  redFlagRule,
  scoreBand,
  scoreConfirmed,
  scoreGateBlockers,
  scoreObligations,
  type RedFlagFinding,
} from "@/src/lib/contracts/follow-through-score";

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

function found(id: RedFlagFinding["id"], severe = false): RedFlagFinding {
  return { id, found: true, evidence: "She said it on the call.", severe };
}

function clear(id: RedFlagFinding["id"]): RedFlagFinding {
  return { id, found: false };
}

// ---------------------------------------------------------------------------
// The six flags and their caps, exactly as the guideline sets them
// ---------------------------------------------------------------------------

check("there are six red flags", RED_FLAGS.length === 6);
check(
  "they are in the guideline's order",
  RED_FLAGS.map((flag) => flag.id).join(",") ===
    "money,responsiveness,lifeChange,technical,otherAgency,performance",
);

check("Money / Cash Flow caps at 8", redFlagRule("money")?.cap === 8);
check("Responsiveness caps at 5", redFlagRule("responsiveness")?.cap === 5);
check("going quiet caps at 3", redFlagRule("responsiveness")?.severe?.cap === 3);
check("Life Change caps at 7", redFlagRule("lifeChange")?.cap === 7);
check("Technical Challenge caps at 7", redFlagRule("technical")?.cap === 7);
check("blocking technical trouble caps at 4", redFlagRule("technical")?.severe?.cap === 4);
check("Other Agency / Advisor caps at 7", redFlagRule("otherAgency")?.cap === 7);
check("audit-style questions cap at 5", redFlagRule("otherAgency")?.severe?.cap === 5);
check("Performance caps at 4", redFlagRule("performance")?.cap === 4);
check("a named competitor or cancelling caps at 3", redFlagRule("performance")?.severe?.cap === 3);

check("Money has no harsher case", !redFlagRule("money")?.severe);
check("Life Change has no harsher case", !redFlagRule("lifeChange")?.severe);

// ---------------------------------------------------------------------------
// One finding's cap
// ---------------------------------------------------------------------------

check("a flag that was not found caps nothing", capForFinding(clear("performance")) === null);
check("an ordinary case uses the ordinary cap", capForFinding(found("responsiveness")) === 5);
check("a severe case uses the harsher cap", capForFinding(found("responsiveness", true)) === 3);
check(
  "severity on a flag with no harsher case changes nothing",
  capForFinding(found("money", true)) === 8,
);
check(
  "severity on a flag that was not found still caps nothing",
  capForFinding({ id: "performance", found: false, severe: true }) === null,
);

// ---------------------------------------------------------------------------
// The recommended cap across the whole check
// ---------------------------------------------------------------------------

const nothing = recommendedCap(RED_FLAGS.map((flag) => clear(flag.id)));
check("a clean call has no cap", nothing.cap === null);
check("and says so plainly", nothing.sentence.includes("nothing caps the score"));
check("and names no flag", nothing.from.length === 0);

const oneFlag = recommendedCap([found("money"), clear("performance")]);
check("one flag caps at its own number", oneFlag.cap === 8);
check("and the sentence names it", oneFlag.sentence.includes("Money / Cash Flow"));
check("and reads as one flag", oneFlag.sentence.includes("was found"));

// The whole point of the rule: the flags compound, and the worst one wins.
const compounded = recommendedCap([found("money"), found("lifeChange"), found("performance")]);
check("the lowest cap wins, not the first or the average", compounded.cap === 4);
check("and only the flag at the cap is named", compounded.from.join() === "performance");

const tied = recommendedCap([found("otherAgency"), found("lifeChange")]);
check("a tie keeps both flags", tied.cap === 7 && tied.from.length === 2);
check("and the sentence joins them", tied.sentence.includes(" and "));
check("and reads as more than one", tied.sentence.includes("were found"));

const severeWins = recommendedCap([found("money"), found("responsiveness", true)]);
check("a severe case can take the cap below every ordinary one", severeWins.cap === 3);

// ---------------------------------------------------------------------------
// The warning, which is a warning and not a refusal
// ---------------------------------------------------------------------------

check("scoring at the cap is not warned about", aboveCapWarning(4, compounded) === "");
check("scoring under the cap is not warned about", aboveCapWarning(2, compounded) === "");
check("no score is not warned about", aboveCapWarning(null, compounded) === "");
check("no cap means no warning however high the score", aboveCapWarning(10, nothing) === "");

const warning = aboveCapWarning(8, compounded);
check("scoring above the cap is warned about", warning.length > 0);
check("the warning names the flag behind the cap", warning.includes("Performance"));
check("the warning names both numbers", warning.includes("8/10") && warning.includes("4"));
check("the warning leaves the decision with the AM", warning.includes("your call"));

// ---------------------------------------------------------------------------
// What a score commits the AM to
// ---------------------------------------------------------------------------

check("a 7 adds nothing", scoreObligations(7).length === 0);
check("a 10 adds nothing", scoreObligations(10).length === 0);
check("a 6 adds three obligations", scoreObligations(6).length === 3);
check("a 1 adds the same three", scoreObligations(1).length === 3);
check("no score adds none of them", scoreObligations(null).length === 0);
check(
  "the obligations are the Risk Register, the playbook and the Manager",
  scoreObligations(5).join(" ").includes("Risk Register") &&
    scoreObligations(5).join(" ").includes("playbook") &&
    scoreObligations(5).join(" ").includes("Manager"),
);

// ---------------------------------------------------------------------------
// The band
// ---------------------------------------------------------------------------

check("9 and 10 are Healthy", scoreBand(9)?.label === "Healthy" && scoreBand(10)?.label === "Healthy");
check("7 and 8 are stable with friction", scoreBand(8)?.label === "Stable with friction");
check("5 and 6 are at risk", scoreBand(6)?.label === "At risk" && scoreBand(5)?.label === "At risk");
check("3 and 4 are critical", scoreBand(4)?.label === "Critical" && scoreBand(3)?.label === "Critical");
check("1 and 2 are churn imminent", scoreBand(2)?.label === "Churn imminent");
check("no score has no band", scoreBand(null) === null);
check("every band carries a reading of it", [1, 3, 5, 7, 9].every((n) => (scoreBand(n)?.detail.length || 0) > 20));

// ---------------------------------------------------------------------------
// The justification MTOS falls back to
// ---------------------------------------------------------------------------

const clean = fallbackJustification(9, [clear("money")], "Oakline Dental");
check("a clean call's justification opens on the score", clean.startsWith("9/10"));
check("and names the band", clean.includes("healthy"));
check("and asks the AM for the part only they have", clean.includes("Add the one thing"));

const flagged = fallbackJustification(
  4,
  [{ id: "performance", found: true, evidence: "leads down two months running" }],
  "Oakline Dental",
);
check("a flagged call's justification names the flag", flagged.includes("Performance"));
check("and quotes the evidence rather than paraphrasing it", flagged.includes("leads down two months running"));

// The load-bearing half: it must never put words in the client's mouth.
check(
  "the fallback invents no client statement",
  !flagged.toLowerCase().includes("she said") && !flagged.toLowerCase().includes("the client said"),
);

const noScore = fallbackJustification(null, [], "Oakline Dental");
check("no score still produces a line to edit", noScore.includes("No score recorded"));
check("and names the client", noScore.includes("Oakline Dental"));

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

check("1 through 10 are scores", [1, 5, 10].every(isScoreValue));
check("0 and 11 are not", !isScoreValue(0) && !isScoreValue(11));
check("a half score is not", !isScoreValue(7.5));
check("a numeral in a string is not", !isScoreValue("7"));

check(
  "no score picked blocks the gate",
  scoreGateBlockers({}).some((line) => line.includes("Pick the score")),
);
check(
  "a score with no justification blocks the gate",
  scoreGateBlockers({ score: 7 }).some((line) => line.includes("Write the justification")),
);
check(
  "whitespace is not a justification",
  scoreGateBlockers({ score: 7, justification: "   " }).length === 1,
);
check(
  "a score and a justification clear the gate",
  scoreGateBlockers({ score: 7, justification: "Steady month, nothing rubbing." }).length === 0,
);

// An explicit "no score given" is a decision, not an absence, and must be allowed through.
check(
  "recording no score is a decision the gate accepts",
  scoreGateBlockers({ score: null, justification: "She left after ten minutes." }).length === 0,
);

const unevidenced = scoreGateBlockers({
  score: 4,
  justification: "Rough call.",
  findings: [{ id: "performance", found: true }, found("money")],
});
check("a found flag with nothing to quote blocks the gate", unevidenced.length === 1);
check("and the blocker names that flag only", unevidenced[0].includes("Performance") && !unevidenced[0].includes("Money"));
check(
  "scoring above the cap does NOT block the gate",
  scoreGateBlockers({
    score: 9,
    justification: "She was delighted; the invoice question was housekeeping.",
    findings: [found("money")],
  }).length === 0,
);

check("an unconfirmed gate is not confirmed", !scoreConfirmed({ score: 7, justification: "x" }));
check("a gate with no state at all is not confirmed", !scoreConfirmed(undefined));
check(
  "a confirmed gate is confirmed",
  scoreConfirmed({ score: 7, justification: "x", confirmedAt: "2026-11-02T10:00:00.000Z" }),
);
check(
  "a confirmed 'no score given' is still confirmed",
  scoreConfirmed({ score: null, justification: "x", confirmedAt: "2026-11-02T10:00:00.000Z" }),
);

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - the model call that reads the transcript for red flags, and its evidence quotes");
console.log("  - whether a transcript timestamp chip matches the moment it points at");
console.log("  - the justification the model writes for a score, as against this fallback");
if (failed) process.exit(1);
