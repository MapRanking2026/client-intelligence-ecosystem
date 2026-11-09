/**
 * Pins the two defects that left "Generate prep" writing nothing into the sections.
 *
 * Both were in `generateClaudeTouchOutput`, both reported by the owner as "it tells me what it was
 * supposed to do instead of doing it", and both are the kind that come back, because the code
 * reads as correct either way round.
 *
 *   1. **The message must not countermand the contract.** The system prompt's output contract asks
 *      for fourteen written sections plus six legacy fields. The user message that followed it
 *      said "Return a JSON object with exactly these keys and types:" and listed six. A model
 *      obeys the narrower, later instruction, so `sections` was never written and every section on
 *      the review screen read "the preparation did not write this section".
 *
 *   2. **A short list must cost a tile, not the document.** `claudeResponseSchema.parse` ran before
 *      `normalizePrepBrief`, so a response with two wins instead of three threw, took the brief
 *      with it, and failed the research stage -- which blocks steps 2, 3 and 4, so the sixteen
 *      section document could never be written at all. One missing win cost the whole document.
 *
 * Checks 1 and 2 are read off the source text rather than from behaviour, deliberately. The order
 * of two statements and the wording of a prompt are not observable from outside the function
 * without calling a model, and they are exactly what regressed. The rest of this file is ordinary
 * behaviour: `salvageTouchOutput` is exercised against the shapes a model actually returns.
 *
 *   npm run --silent check:prep-generation
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  claudeResponseSchema,
  salvageTouchOutput,
} from "@/src/lib/server/services/monthly-touch-prep-service";
import { normalizePrepBrief } from "@/src/lib/contracts/prep-brief";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAILED: ${label}`);
  }
}

/**
 * The source with every comment stripped out.
 *
 * It matters that this is the stripped text. The fix for defect 1 left a comment quoting the old
 * wording verbatim, so that the next reader knows what changed and why -- and the first run of this
 * file failed on its own explanation. A check that a string is absent, or present, is worthless if
 * a comment can satisfy it: what the model is sent is the code.
 */
const SOURCE = readFileSync(
  join(process.cwd(), "src/lib/server/services/monthly-touch-prep-service.ts"),
  "utf8",
)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

function good() {
  return {
    executiveBrief: "Two paragraphs about the month.\n\nAnd the second one.",
    agenda: ["One", "Two", "Three", "Four"],
    talkingPoints: ["A", "B", "C"],
    wins: ["W1", "W2", "W3"],
    risks: ["R1", "R2"],
    recommendations: [
      {
        title: "T1",
        summary: "S1",
        rationale: "Why",
        confidence: "High",
        evidence: [{ label: "L", source: "ClickUp", freshness: "today" }],
      },
      {
        title: "T2",
        summary: "S2",
        rationale: "Why",
        confidence: "Medium",
        evidence: [{ label: "L", source: "GBP", freshness: "7 days" }],
      },
    ],
  };
}

console.log("the message must not countermand the contract");
{
  check(
    'the old "exactly these keys" framing is gone',
    !SOURCE.includes("Return a JSON object with exactly these keys and types:"),
  );
  check(
    "the message asks for the sections by name",
    SOURCE.includes("It must carry the fourteen written sections"),
  );
  for (const key of [
    "sections",
    "missing",
    "retention",
    "qcPromises",
    "qcFocus",
    "qcProposals",
    "agendaReadAloud",
    "clientAgendaEmail",
    "unreportedSeoWins",
  ]) {
    check(`and names \`${key}\``, SOURCE.includes("`" + key + "`"));
  }
  check(
    "and says that writing only the six is not a usable answer",
    SOURCE.includes("leaving `sections` out is not a usable answer"),
  );
  check(
    "the six strict shapes are still spelled out, since those are validated hard",
    SOURCE.includes("recommendations: array of 2-4 objects, each exactly:") &&
      SOURCE.includes("wins: array of 3-8 strings"),
  );
}

console.log("\na short list costs a tile, not the document");
{
  // The ordering IS the fix. `parse` throws; anything after it does not run.
  const briefAt = SOURCE.indexOf("const brief = normalizePrepBrief(normalized");
  const parseAt = SOURCE.indexOf("claudeResponseSchema.safeParse(normalized)");
  check("the brief is read before the strict check", briefAt > 0 && parseAt > briefAt);
  check(
    "the strict check cannot throw any more",
    !SOURCE.includes("claudeResponseSchema.parse(normalized)"),
  );
  check("and a shortfall is recorded rather than swallowed", SOURCE.includes("shortfall,"));

  // The schema still has teeth where the call guide and the deck depend on it.
  check("a good payload passes", claudeResponseSchema.safeParse(good()).success);
  check(
    "two wins still fails the strict schema",
    !claudeResponseSchema.safeParse({ ...good(), wins: ["W1", "W2"] }).success,
  );

  // And the brief survives that same payload, which is the behaviour the owner was missing.
  const withSections = {
    ...good(),
    wins: ["W1", "W2"],
    sections: [
      { id: "1", title: "Quick Client Snapshot", markdown: "Maria runs an HVAC company." },
      { id: "3", title: "Look-back", markdown: "We promised two things." },
    ],
  };
  const brief = normalizePrepBrief(withSections, "2026-11-09T12:00:00.000Z");
  check("the sections are read even though the strict schema rejected the payload", brief.sections.length === 2);
  // The agent numbers its sections the way the manual skill does; the brief is numbered 1-15.
  // Agent 1 -> brief 3, agent 3 -> brief 5.
  check("in brief numbering", brief.sections[0].id === "3" && brief.sections[1].id === "5");
}

console.log("\nwhat survives a salvaged run");
{
  const salvaged = salvageTouchOutput({ ...good(), wins: ["W1", "W2"] });
  check("the two wins are kept, not discarded", salvaged.wins?.length === 2);
  check("the executive brief survives", (salvaged.executiveBrief || "").includes("Two paragraphs"));
  check("so does the agenda", salvaged.agenda?.length === 4);
  check("and the recommendations", salvaged.recommendations?.length === 2);
  check("each with an id for the review screen", Boolean(salvaged.recommendations?.[0].id));

  // A field the model mangled is left absent, so the caller keeps its deterministic text.
  const mangled = salvageTouchOutput({ ...good(), agenda: [{ text: "an object, not a string" }] });
  check("a mangled agenda is absent rather than half-built", mangled.agenda === undefined);
  check("and the rest of the response still comes through", mangled.wins?.length === 3);

  // Recommendations are salvaged per item: three sound ones and a broken fourth keeps three.
  const base = good().recommendations[0];
  const perItem = salvageTouchOutput({
    ...good(),
    recommendations: [base, base, base, { title: "no evidence", summary: "s", rationale: "r", confidence: "High" }],
  });
  check("a malformed recommendation does not take the sound ones down", perItem.recommendations?.length === 3);

  const noConfidence = salvageTouchOutput({
    ...good(),
    recommendations: [{ ...base, confidence: "Quite sure" }],
  });
  check("an invented confidence value is dropped, not coerced", noConfidence.recommendations === undefined);

  // The ceilings still apply: they are what the call guide and the deck have room for.
  const tooMany = salvageTouchOutput({
    ...good(),
    agenda: ["1", "2", "3", "4", "5", "6", "7", "8"],
    wins: Array.from({ length: 12 }, (_, i) => `w${i}`),
  });
  check("the agenda ceiling holds", tooMany.agenda?.length === 6);
  check("the wins ceiling holds", tooMany.wins?.length === 8);

  const repeated = salvageTouchOutput({ ...good(), wins: ["same", "same", "different"] });
  check("duplicates are still collapsed", repeated.wins?.length === 2);

  check("nothing usable gives nothing, rather than empty strings", Object.keys(salvageTouchOutput({})).length === 0);
  check("a non-object gives nothing", Object.keys(salvageTouchOutput("not json")).length === 0);
  check("an empty list is absent, not an empty tile", salvageTouchOutput({ ...good(), risks: [] }).risks === undefined);
}

console.log(
  [
    "",
    "Not covered by these checks: whether a model actually returns the fourteen sections now that it",
    "is asked for them (that needs a live run against a real client), whether the sections it writes",
    "are any good, and the sections that have no evidence source at all -- section 0's QC promises",
    "and section 13's quotes have nothing in the bundle to be written from, so they will keep saying",
    "so however well the rest of this works.",
    "",
    `${passed} passed, ${failed} failed`,
  ].join("\n"),
);

if (failed) {
  process.exit(1);
}
