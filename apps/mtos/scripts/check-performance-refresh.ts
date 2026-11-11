/**
 * Pins the Performance tab's refresh button to the one thing it must never do.
 *
 * The owner asked for a button at the top of each client's Performance screen so the figures could
 * be brought up to date without running a preparation. The obvious implementation is one line --
 * `prepareMonthlyTouch(touchId, { includeClaude: false })` -- and it is wrong in a way that would
 * not show up until it had already cost somebody a call: with no model in the run,
 * `executiveBrief`, `agenda`, `talkingPoints` and `aiRecommendations` fall back to their
 * deterministic text, so refreshing a touch whose brief had been written, edited or approved would
 * quietly replace the model's agenda with a placeholder one. The brief survives (it is explicitly
 * carried over) and the four fields around it do not.
 *
 * So the refresh rebuilds the pack in memory and writes exactly three panels back. Three things
 * here are requirements rather than behaviour that happens to work:
 *
 *   1. The refresh does not call the preparation. Whatever else changes, that shortcut stays shut.
 *   2. The write names its fields and is scoped with `mergeFields`, so no overlapping write can
 *      carry the rest of the document back to the version this run started from.
 *   3. The button forces the platform re-read. `refreshSnapshotsForPrep` skips a provider pulled
 *      recently, which is right inside a preparation and wrong behind a button: the person
 *      pressing it is asking for now.
 *
 * Source-level, in the same idiom as `check:prompt-engine` -- these are invariants about how the
 * code is wired, which no amount of running it with a mocked Firestore would catch.
 *
 * Run with: npm run check:performance-refresh
 */
import fs from "node:fs";
import path from "node:path";

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

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

const PREP = "src/lib/server/services/monthly-touch-prep-service.ts";
const ORCHESTRATOR = "src/lib/server/services/client-performance-service.ts";
const ROUTE = "src/app/api/clients/[clientId]/performance-refresh/route.ts";
const COMPONENT = "src/components/mtos/performance-refresh.tsx";
const PAGE = "src/app/clients/[clientId]/page.tsx";

const prep = read(PREP);
const orchestrator = read(ORCHESTRATOR);
const route = read(ROUTE);
const component = read(COMPONENT);
const page = read(PAGE);

/**
 * `rewriteTouchPerformancePanels`, with the doc comment above it included.
 *
 * The comment is part of what is being checked. The reason this function exists at all, rather than
 * a one-line call to the preparation, is exactly the thing a later tidy-up would delete first, so
 * the reasoning has to still be sitting next to the code.
 */
const rewriteStart = prep.indexOf("export async function rewriteTouchPerformancePanels");
const rewriteDocStart = rewriteStart >= 0 ? prep.lastIndexOf("/**", rewriteStart) : -1;
const rewriteBody =
  rewriteStart >= 0
    ? prep.slice(rewriteDocStart >= 0 ? rewriteDocStart : rewriteStart, prep.indexOf("\nexport ", rewriteStart + 10))
    : "";

// ---------------------------------------------------------------------------
scenario("The refresh exists and is wired end to end");

check("the rebuild lives with the panel builders", rewriteStart >= 0);
check("the orchestration is its own service", orchestrator.includes("export async function refreshClientPerformance"));
check(
  "which is where the refreshers and the builders can both be imported",
  orchestrator.includes("@/src/lib/server/integration-sync") &&
    orchestrator.includes("rewriteTouchPerformancePanels"),
);
check("the route exposes it", route.includes("export async function POST"));
check(
  "and only as a POST -- everything it does reaches outside MTOS",
  !/export async function (GET|PUT|PATCH|DELETE)\b/.test(route),
);
check("the button is a client component", component.startsWith('"use client"'));
check("the Performance tab renders it", page.includes("<PerformanceRefresh"));
check(
  "at the very top of the tab, above the scorecard",
  page.indexOf("<PerformanceRefresh") < page.indexOf("<ScorecardGrid"),
);

// ---------------------------------------------------------------------------
scenario("It never runs the preparation");

// A CALL, not a mention: the doc comment above the function names `prepareMonthlyTouch` precisely
// in order to explain why it is not used, and that sentence has to survive this check.
check(
  "the rebuild does not call prepareMonthlyTouch",
  !rewriteBody.includes("prepareMonthlyTouch("),
  "a model-less preparation replaces the agenda and the recommendations with placeholder text",
);
check("nor does the orchestrator", !orchestrator.includes("prepareMonthlyTouch("));
check("nor the route", !route.includes("prepareMonthlyTouch"));
check(
  "and it says why in the code, so the shortcut is not reintroduced as a simplification",
  rewriteBody.includes("includeClaude") && /wrong tool|must not rewrite the brief/i.test(rewriteBody),
);

// ---------------------------------------------------------------------------
scenario("The write touches three panels and nothing else");

check("it writes the business scorecard", rewriteBody.includes("businessScorecard:"));
check("the SEO panel", rewriteBody.includes("seoPerformance:"));
check("the paid-media panel", rewriteBody.includes("adsPerformance:"));
check("and records when it ran", rewriteBody.includes("performanceRefreshedAt"));
check(
  "scoped with mergeFields, so an overlapping write cannot restore the rest of the document",
  rewriteBody.includes('mergeFields: ["prepPack"]'),
);

for (const field of [
  "executiveBrief",
  "agenda",
  "talkingPoints",
  "aiRecommendations",
  "prepBrief",
  "review",
  "approval",
  "leadVerification",
]) {
  check(
    `it does not write \`${field}\``,
    !new RegExp(`(^|[^.\\w])${field}:`, "m").test(rewriteBody),
    "the refresh must leave everything the model and the account manager wrote alone",
  );
}

// ---------------------------------------------------------------------------
scenario("A button means now");

check(
  "the platform re-read is forced rather than skipped when recent",
  orchestrator.includes("freshWithinMs: 0"),
  "refreshSnapshotsForPrep skips a provider pulled recently, which is wrong behind a button",
);
check(
  "the per-client Business Profile and GoHighLevel reads are both asked",
  orchestrator.includes("refreshGbpInsightsForClient") && orchestrator.includes("refreshGhlLeadsForClient"),
);
check(
  "every platform is non-fatal, so one refusal does not lose the others' numbers",
  (orchestrator.match(/\.catch\(/g) || []).length >= 3,
);
check(
  "and each platform's outcome is reported rather than summarised away",
  orchestrator.includes("sources") && component.includes("result.sources.map"),
);
check(
  "a refused platform is still shown on the screen, not swallowed by an error box",
  route.includes("reported in the response") || /platform that refuses/i.test(route),
);

// ---------------------------------------------------------------------------

console.log(`\n${checks - failures} of ${checks} checks passed.`);
console.log(
  [
    "",
    "Not covered here (needs Firestore and the live platforms, so it is checked by hand against a",
    "real client):",
    "  - that the write really does leave the brief, the agenda and the approval untouched on a",
    "    touch that has them. The field list above is the guard; only a run proves the merge",
    "  - how long the refresh takes against a client with many locations and ad accounts, which is",
    "    the same set of calls the preparation's first half makes",
    "  - that the reload afterwards shows the rewritten panels: the three are server-rendered from",
    "    the touch this just wrote, so the screen and the database agree only after it",
  ].join("\n"),
);

if (failures > 0) {
  process.exitCode = 1;
}
