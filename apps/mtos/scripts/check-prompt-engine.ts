/**
 * The Prompt Engine is the one place MTOS's AI instructions live, and only an admin may touch it.
 *
 * Three things are checked here, and all three are things a human reading the code would have to
 * take on trust otherwise.
 *
 * 1. **The admin gate.** Every one of the four `/api/prompts/*` routes refuses an account manager,
 *    a manager and a QC reviewer with a 403. Written mostly as negative checks, like
 *    `check-qc-access.ts`: a rule that returns true for everybody passes every positive check.
 *    Until 9 November 2026 these routes had no role check at all -- they sat behind the sign-in
 *    cookie gate, so they were never public, but any signed-in AM or QC reviewer could rewrite
 *    every prompt the platform runs on.
 *
 * 2. **The library matches the code.** Every prompt key a module resolves exists in the bundled
 *    library, every `{{variable}}` a row expects is supplied by the module that resolves it, and
 *    no module that calls a model still carries instruction text of its own. That last one is the
 *    check with teeth: the engine screen tells the owner it is the single source of truth, and a
 *    system prompt or an output contract left in code makes that a lie without anything failing.
 *
 * 3. **An edit takes effect immediately.** No prompt is captured at module load, nothing caches a
 *    resolved prompt, and the routes are not allowed to be prerendered or revalidated. The store
 *    reads one Firestore document per call, so the only way an edit could arrive late is a cache
 *    added above it.
 *
 * Pure: no Firestore, no server, no model. Run with `npm run check:prompt-engine`.
 */
import fs from "fs";
import path from "path";

import type { Role } from "@/src/lib/contracts/mtos";
import { PROMPT_ENGINE_ADMIN_ONLY, canUsePromptEngine } from "@/src/lib/contracts/prompt-engine-access";
import { promptEngineDenial } from "@/src/lib/server/prompt-engine-guard";
import bundledLibrary from "@/src/prompts/mtos-prompts.json";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`FAILED: ${label}${detail ? ` — ${detail}` : ""}`);
}

const ROLES: Role[] = ["account_manager", "manager", "qa_reviewer", "tenant_admin"];
const NON_ADMIN_ROLES = ROLES.filter((role) => role !== "tenant_admin");

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

/**
 * The source with its comments removed, keeping the line count so a failure can still name a line.
 *
 * Comments are where this file would otherwise trip over itself: several of the modules explain in
 * prose what their hardcoded prompt used to say, and the routes explain why they are not allowed
 * to be static. Those sentences are the record of the fix, not the thing being looked for.
 */
function readCode(file: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, " ");
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^\s*\/\/.*$/gm, blank);
}

// ---------------------------------------------------------------------------
// 1. The admin gate
// ---------------------------------------------------------------------------

const PROMPT_ROUTES = [
  "src/app/api/prompts/route.ts",
  "src/app/api/prompts/[key]/route.ts",
  "src/app/api/prompts/[key]/rollback/route.ts",
  "src/app/api/prompts/[key]/test/route.ts",
];

check("an admin may use the Prompt Engine", canUsePromptEngine("tenant_admin"));
for (const role of NON_ADMIN_ROLES) {
  check(`a ${role} may not`, !canUsePromptEngine(role));
}
check(
  "exactly one of the four roles may",
  ROLES.filter((role) => canUsePromptEngine(role)).length === 1,
);

check("an admin is not refused", promptEngineDenial("tenant_admin") === null);
for (const role of NON_ADMIN_ROLES) {
  const denial = promptEngineDenial(role);
  check(`a ${role} is refused with a 403`, denial?.status === 403, String(denial?.status));
}
// The body matters: the screen and the API say the same thing, so an AM who hits the URL is told
// why rather than seeing a bare error.
check("the refusal explains itself", PROMPT_ENGINE_ADMIN_ONLY.includes("administrators"));

for (const route of PROMPT_ROUTES) {
  const source = read(route);
  const handlers = [...source.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\(/g)].map(
    (match) => match[1],
  );
  check(`${route} has at least one handler`, handlers.length > 0);
  check(
    `${route} runs the gate in every handler`,
    (source.match(/requirePromptEngineAdmin\(request\)/g) || []).length === handlers.length,
    `${(source.match(/requirePromptEngineAdmin\(request\)/g) || []).length} gates for ${handlers.length} handlers`,
  );
  // The gate has to come before the work. A check after the Firestore read would still answer 403
  // while having already read, and in the save routes, written.
  for (const handler of handlers) {
    const body = source.slice(source.indexOf(`export async function ${handler}(`));
    const gateAt = body.indexOf("requirePromptEngineAdmin");
    const storeAt = Math.min(
      ...["getPrompts(", "savePrompts(", "getPromptRecord(", "savePromptRecord(", "rollbackPrompt("]
        .map((call) => body.indexOf(call))
        .filter((at) => at !== -1)
        .concat([Number.MAX_SAFE_INTEGER]),
    );
    check(`${route} ${handler} gates before it touches the store`, gateAt !== -1 && gateAt < storeAt);
  }
}

// The screen, and the Settings card that links to it.
const enginePage = read("src/app/settings/prompt-engine/page.tsx");
check("the Prompt Engine page checks the role", enginePage.includes("canUsePromptEngine(context.role)"));
check(
  "and does not read the library for someone it is going to refuse",
  enginePage.indexOf("canUsePromptEngine") < enginePage.indexOf("await getPrompts()"),
);
check(
  "the Settings card is hidden from non-admins",
  read("src/app/settings/page.tsx").includes("visibleTo: canUsePromptEngine"),
);

// ---------------------------------------------------------------------------
// 2. The library matches the code
// ---------------------------------------------------------------------------

/** Narrowed to the fields this file reads, as in `check-prompt-store.ts`. */
type Row = { key: string; prompt: string; runtimeContract?: string };
const ROWS: Row[] = (bundledLibrary as { prompts: Row[] }[]).flatMap((phase) => phase.prompts);
const BY_KEY = new Map(ROWS.map((row) => [row.key, row]));

/**
 * Every module that sends instruction text to a model. Taken from the callers of `callLlmForJson`,
 * `callLlmForText` and `callClaudeForJson`; `mtos-ai.ts` is the transport and carries none.
 */
const CONSUMERS = [
  "client-intelligence-service",
  "confirmation-email-service",
  "follow-through-notes-service",
  "follow-through-score-service",
  "lead-verification-service",
  "live-call-guide-service",
  "monthly-touch-prep-service",
  "post-meeting-service",
  "post-touch-notes-service",
  "prep-document-service",
  "presentation-service",
  "qa-review-service",
  "qc-preread-service",
].map((name) => `src/lib/server/services/${name}.ts`);

// The preparation document resolves its two rows through constants, so its keys are declared where
// those constants live.
const KEY_SOURCES = [...CONSUMERS, "src/lib/server/prompts/prep-document-prompt.ts"];

const resolved = new Map<string, string[]>();
for (const file of KEY_SOURCES) {
  const source = read(file);
  for (const match of source.matchAll(/getPrompt(?:Text|Record)\(\s*"([a-z0-9_]+)"/g)) {
    resolved.set(match[1], [...(resolved.get(match[1]) || []), file]);
  }
  for (const match of source.matchAll(/_KEY = "([a-z0-9_]+)"/g)) {
    resolved.set(match[1], [...(resolved.get(match[1]) || []), file]);
  }
}

check("the modules resolve prompts by key at all", resolved.size >= 20, `${resolved.size} keys`);
for (const [key, files] of resolved) {
  check(`${key} exists in the library`, BY_KEY.has(key), files.join(", "));
}

// Every {{variable}} a row expects has to be supplied by the module that resolves it. A variable
// nobody supplies is not an error the store can catch -- it reaches the model as literal
// `{{qc_criteria}}` text, and the answer comes back shaped by a rubric the model never saw.
for (const [key, files] of resolved) {
  const row = BY_KEY.get(key);
  if (!row) continue;
  const variables = [
    ...new Set(
      [...`${row.prompt}\n${row.runtimeContract || ""}`.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map(
        (match) => match[1],
      ),
    ),
  ];
  for (const variable of variables) {
    check(
      `${key}'s {{${variable}}} is supplied where it is resolved`,
      files.some((file) => read(file).includes(variable)),
      files.join(", "),
    );
  }
}

/**
 * What instruction text left in code looks like.
 *
 * Every one of these was in a service on 9 November 2026: a `const system = [...]` array of
 * sentences, an output contract opening with "Return a JSON object", or a `*_SYSTEM_PROMPT`
 * constant. The engine now holds all of it. These patterns are what would put it back.
 */
const INSTRUCTION_SMELLS: { pattern: RegExp; what: string }[] = [
  { pattern: /const system(?:Prompt)? = \[/, what: "a system prompt assembled from string literals" },
  { pattern: /const system(?:Prompt)? = "/, what: "a system prompt written as a string literal" },
  { pattern: /"Return (?:a|ONE|the) JSON/, what: 'an output contract starting "Return a JSON"' },
  { pattern: /"Return a JSON object with/, what: "an output contract" },
  { pattern: /_SYSTEM_PROMPT/, what: "a system-prompt constant" },
  { pattern: /"OUTPUT SHAPE/, what: "an output-shape block" },
];

for (const file of CONSUMERS) {
  const source = readCode(file);
  for (const { pattern, what } of INSTRUCTION_SMELLS) {
    const hit = pattern.exec(source);
    check(
      `${file} carries no ${what}`,
      hit === null,
      hit ? `line ${source.slice(0, hit.index).split("\n").length}: ${hit[0]}` : "",
    );
  }
  // And the positive half: whatever each module passes as `system` came from the engine. One
  // module composes it from two rows (the preparation prompt plus the meeting-variety prompt), so
  // the test is that the declaration resolves something from the store, not that it is one call.
  for (const match of source.matchAll(/\bconst system\b[^=]*=/g)) {
    const at = match.index ?? 0;
    const declaration = source.slice(at, at + 400);
    check(
      `${file} takes its system prompt from the engine`,
      /getPrompt(?:Text|Record)\(/.test(declaration) || /basePrompt/.test(declaration),
      `line ${source.slice(0, at).split("\n").length}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 2b. Nobody asks the client for a score
// ---------------------------------------------------------------------------

/**
 * The NPS is the account manager's own read of the account.
 *
 * Claude proposes it from the transcript, the AM confirms or changes it on the post-meeting screen,
 * and `reviewBlockers` will not let the review through without one. The client is never asked for a
 * number -- it is not a client survey and never has been (owner, 9 November 2026).
 *
 * This is pinned here because two rows got it wrong in opposite halves of the library and neither
 * failed anything: the Client Health row told the model to copy a number the client said out loud,
 * and the live call guide told the AM to ask for one on the call and put the question in the
 * client's prompts. A prompt is the only place this rule can be broken silently.
 */
const ASKS_THE_CLIENT = [
  /asks the client (?:directly )?for (?:a |their )?(?:NPS )?score/i,
  /ask the client for (?:a |their )?(?:NPS )?score/i,
  /the client said a number/i,
  /number the client gave/i,
  /stated by the client/i,
  /npsStatedByClient/,
  /how likely they are to recommend/i,
];

for (const row of ROWS) {
  const text = `${row.prompt}\n${row.runtimeContract || ""}`;
  for (const pattern of ASKS_THE_CLIENT) {
    const hit = pattern.exec(text);
    // A prohibition is allowed to name the thing it prohibits.
    const line = hit ? text.slice(0, hit.index).split("\n").pop() + hit[0] : "";
    const prohibits = /\b(never|not|no)\b/i.test(
      text.slice(Math.max(0, (hit?.index ?? 0) - 160), (hit?.index ?? 0) + (hit?.[0].length ?? 0)),
    );
    check(
      `${row.key} does not ask the client for a score`,
      hit === null || prohibits,
      line.trim().slice(0, 90),
    );
  }
}

check(
  "the review cannot be submitted without the AM's score",
  read("src/lib/contracts/post-meeting-review.ts").includes("if (!submission.npsChosen) {"),
);
check(
  "and the screen offers Claude's suggestion as one option beside the numbers",
  read("src/components/mtos/post-meeting-workflow.tsx").includes("Suggested {healthSuggestion.suggestedNps}"),
);

// ---------------------------------------------------------------------------
// 3. An edit takes effect immediately
// ---------------------------------------------------------------------------

const CACHE_SMELLS: { pattern: RegExp; what: string }[] = [
  { pattern: /unstable_cache/, what: "unstable_cache" },
  { pattern: /export const revalidate/, what: "a revalidate window" },
  { pattern: /force-static/, what: "force-static" },
  { pattern: /"use cache"/, what: 'a "use cache" directive' },
  { pattern: /cacheLife\(/, what: "cacheLife" },
];

const PROMPT_SURFACE = [
  ...PROMPT_ROUTES,
  ...CONSUMERS,
  "src/lib/server/prompt-store.ts",
  "src/lib/server/prompts/prep-document-prompt.ts",
  "src/app/settings/prompt-engine/page.tsx",
];

for (const file of PROMPT_SURFACE) {
  const source = readCode(file);
  for (const { pattern, what } of CACHE_SMELLS) {
    check(`${file} does not use ${what}`, !pattern.test(source));
  }
  // A prompt pulled once at module load is the one that would survive an edit: the module stays
  // warm between requests on a serverless host, so the next run would still send the old text.
  check(
    `${file} captures no prompt at module load`,
    !/^(?:const|let) [^\n=]+= await getPrompt/m.test(source),
  );
}

for (const route of PROMPT_ROUTES) {
  check(
    `${route} is explicitly dynamic`,
    read(route).includes('export const dynamic = "force-dynamic"'),
  );
}

// The store itself: one read per call, and no memo around it.
const store = read("src/lib/server/prompt-store.ts");
check(
  "getPromptRecord reads the document on every call",
  /export async function getPromptRecord[\s\S]*?promptsCollection\(db\)\.doc\(key\)\.get\(\)/.test(store),
);
check(
  "the only module-level caches are the seed guard and the bundled fallback index",
  (store.match(/^let \w+/gm) || []).join(",") === "let seedPromise,let bundledPromptIndex",
  (store.match(/^let \w+/gm) || []).join(","),
);

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - the Firestore security rules, which this work does not touch");
console.log("  - the one line that introduces the Michelin standard where the live-call aids");
console.log("    append it (\"Apply this communication standard to the wording of every line you");
console.log("    return\"). The standard itself is an engine row; that line is the frame around it,");
console.log("    and folding it in would leave the row reading as an instruction to itself.");
console.log("  - the per-request lines a module still assembles itself: which sources this call");
console.log("    has, whether the AM recorded a score, the roster a ticket may be assigned to.");
console.log("    They are built from this touch's state, not prompt wording, and the positive");
console.log("    check above is what holds the prompt itself in the engine.");
console.log("  - that a corrected row reaches a database seeded before the correction; that is");
console.log("    what `npm run publish:prompts -- <key>` is for");
if (failed) process.exit(1);
