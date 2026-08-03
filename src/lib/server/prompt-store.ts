import fs from "fs";
import path from "path";

import bundledPromptsJson from "@/src/prompts/mtos-prompts.json";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";

export type PromptRole =
  | "Research Agent"
  | "Reasoning Agent"
  | "Workflow Agent"
  | "Quality Agent"
  | "Memory Agent"
  | "Writing Agent";

export type PromptProvider = "gemini" | "claude";

export type PromptTaskDifficulty = "simple" | "moderate" | "difficult";

/** A point-in-time snapshot of a prompt, kept so any edit can be rolled back. */
export type PromptVersion = {
  version: number;
  prompt: string;
  runtimeContract?: string;
  updatedAt: string;
  note?: string;
};

export type PromptDefinition = {
  key: string;
  title: string;
  role: PromptRole;
  /** The behavioural instruction. The Prompt Engine is its only source of truth. */
  prompt: string;
  /** What this prompt is for -- shown as "Purpose" in the Prompt Engine. */
  description?: string;
  provider?: PromptProvider;
  difficulty?: PromptTaskDifficulty;
  /**
   * Binding-specific operating instructions for the MTOS module that executes
   * this prompt: the evidence it may use and the exact JSON shape it must
   * return. Appended after `prompt` at execution time and declared
   * authoritative, so an operator can rewrite the library half freely without
   * breaking the module that parses the result. Still engine-owned -- no
   * instruction text lives in application code.
   */
  runtimeContract?: string;
  /** MTOS workflows this prompt governs, for operator context. */
  workflows?: string[];
  version: number;
  updatedAt: string;
  history?: PromptVersion[];
};

export type PromptPhase = {
  phase: string;
  prompts: PromptDefinition[];
};

export type PromptConfig = PromptPhase[];

export type PromptValidationIssue = {
  level: "error" | "warning";
  message: string;
};

/** Editable fields. `key` is intentionally excluded -- it is the runtime binding. */
export type PromptPatch = Partial<
  Pick<
    PromptDefinition,
    | "title"
    | "role"
    | "prompt"
    | "description"
    | "provider"
    | "difficulty"
    | "runtimeContract"
    | "workflows"
  >
>;

const PROMPT_FILE = path.join(process.cwd(), "src", "prompts", "mtos-prompts.json");

const MAX_HISTORY_ENTRIES = 25;
const MIN_PROMPT_LENGTH = 40;
const MAX_PROMPT_LENGTH = 60_000;

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * The Global System Preamble. The v2 library defines a single operating standard
 * that is prepended to every module call; storing it as a normal prompt under
 * this key keeps it editable, versioned, and rollback-able through the same UI
 * as everything else. It is never itself a runnable module, so it is skipped
 * when composing its own text.
 */
export const GLOBAL_PREAMBLE_KEY = "global_system_preamble";

function nowIso() {
  return new Date().toISOString();
}

function withDefaults(prompt: PromptDefinition): PromptDefinition {
  return {
    ...prompt,
    version: typeof prompt.version === "number" && prompt.version > 0 ? prompt.version : 1,
    updatedAt: prompt.updatedAt || nowIso(),
    history: Array.isArray(prompt.history) ? prompt.history : [],
  };
}

function normalizePromptConfig(value: unknown): PromptConfig {
  if (Array.isArray(value)) {
    return (value as PromptPhase[]).map((phase) => ({
      ...phase,
      prompts: (phase.prompts || []).map(withDefaults),
    }));
  }

  if (value && typeof value === "object") {
    const candidate = value as Record<string, unknown>;
    const entries = Object.entries(candidate);
    const stringEntries = entries.filter(([, prompt]) => typeof prompt === "string") as [string, string][];

    if (entries.length && stringEntries.length === entries.length) {
      return [
        {
          phase: "Phase 1 — Custom prompts",
          prompts: stringEntries.map(([key, prompt]) =>
            withDefaults({
              key,
              title: key.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase()),
              role: "Research Agent",
              prompt,
            } as PromptDefinition),
          ),
        },
      ];
    }

    const promptObjects = entries
      .filter(([, prompt]) => prompt && typeof prompt === "object" && "prompt" in (prompt as Record<string, unknown>))
      .map(([key, prompt]) =>
        withDefaults({
          key,
          ...(prompt as Record<string, unknown>),
        } as PromptDefinition),
      );

    if (entries.length && promptObjects.length === entries.length) {
      return [{ phase: "Imported prompts", prompts: promptObjects }];
    }
  }

  return [];
}

/**
 * Firestore is undefined-hostile, so drop undefined keys before any write.
 */
function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function toStorable(prompt: PromptDefinition) {
  return stripUndefined({
    ...prompt,
    history: (prompt.history || []).map((entry) => stripUndefined({ ...entry })),
  } as unknown as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// File backend. Used for local development and seed mode. Serverless hosts mount
// the app read-only, so this is a development convenience, not the deploy target.
// ---------------------------------------------------------------------------

async function readFileConfig(): Promise<PromptConfig> {
  try {
    const text = await fs.promises.readFile(PROMPT_FILE, "utf8");
    return normalizePromptConfig(JSON.parse(text));
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

async function writeFileConfig(config: PromptConfig): Promise<void> {
  await fs.promises.mkdir(path.dirname(PROMPT_FILE), { recursive: true });
  await fs.promises.writeFile(PROMPT_FILE, JSON.stringify(config, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Firestore backend. The deploy target. One document per prompt so a save
// touches only that prompt and the runtime can resolve a single key with a
// single read, plus an order document that preserves the phase grouping.
// ---------------------------------------------------------------------------

const PROMPT_COLLECTION = "promptEngine";
const LIBRARY_DOC = "library";

type PromptOrder = { phase: string; keys: string[] }[];

type Db = NonNullable<ReturnType<typeof getFirebaseAdminDb>>;

function libraryDoc(db: Db) {
  return db.collection(PROMPT_COLLECTION).doc(LIBRARY_DOC);
}

function promptsCollection(db: Db) {
  return libraryDoc(db).collection("prompts");
}

/** Guards against re-seeding on every request within a warm instance. */
let seedPromise: Promise<void> | null = null;

/**
 * On an empty database, publish the bundled JSON library as the initial
 * content. The JSON file ships with the build and stays the default the
 * platform boots from; Firestore holds every edit made after that.
 */
async function ensureSeeded(db: Db): Promise<void> {
  if (!seedPromise) {
    seedPromise = (async () => {
      const existing = await libraryDoc(db).get();
      if (existing.exists) return;

      const seed = await readFileConfig();
      if (!seed.length) return;

      const batch = db.batch();
      batch.set(libraryDoc(db), {
        order: seed.map((phase) => ({ phase: phase.phase, keys: phase.prompts.map((p) => p.key) })),
        seededAt: nowIso(),
      });
      for (const phase of seed) {
        for (const prompt of phase.prompts) {
          batch.set(promptsCollection(db).doc(prompt.key), toStorable(prompt));
        }
      }
      await batch.commit();
    })().catch((error) => {
      // Let a later request retry rather than caching the failure forever.
      seedPromise = null;
      throw error;
    });
  }

  return seedPromise;
}

async function readFirestoreConfig(db: Db): Promise<PromptConfig> {
  await ensureSeeded(db);

  const [library, prompts] = await Promise.all([
    libraryDoc(db).get(),
    promptsCollection(db).get(),
  ]);

  const byKey = new Map<string, PromptDefinition>();
  for (const doc of prompts.docs) {
    byKey.set(doc.id, withDefaults(doc.data() as PromptDefinition));
  }

  const order = ((library.data()?.order as PromptOrder) || []).map((phase) => ({
    phase: phase.phase,
    prompts: phase.keys.map((key) => byKey.get(key)).filter((p): p is PromptDefinition => Boolean(p)),
  }));

  // Anything written without an order entry still has to be reachable.
  const ordered = new Set(order.flatMap((phase) => phase.prompts.map((p) => p.key)));
  const orphans = [...byKey.values()].filter((prompt) => !ordered.has(prompt.key));
  if (orphans.length) {
    order.push({ phase: "Unassigned", prompts: orphans });
  }

  return order;
}

async function writeFirestoreConfig(db: Db, config: PromptConfig): Promise<void> {
  await ensureSeeded(db);

  const existing = await promptsCollection(db).get();
  const nextKeys = new Set(config.flatMap((phase) => phase.prompts.map((prompt) => prompt.key)));

  const batch = db.batch();
  batch.set(libraryDoc(db), {
    order: config.map((phase) => ({ phase: phase.phase, keys: phase.prompts.map((p) => p.key) })),
    updatedAt: nowIso(),
  });
  for (const phase of config) {
    for (const prompt of phase.prompts) {
      batch.set(promptsCollection(db).doc(prompt.key), toStorable(prompt));
    }
  }
  for (const doc of existing.docs) {
    if (!nextKeys.has(doc.id)) {
      batch.delete(doc.ref);
    }
  }
  await batch.commit();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getPrompts(): Promise<PromptConfig> {
  const db = getFirebaseAdminDb();
  return db ? readFirestoreConfig(db) : readFileConfig();
}

export async function savePrompts(data: PromptConfig): Promise<void> {
  const normalized = normalizePromptConfig(data);
  const db = getFirebaseAdminDb();
  if (db) {
    await writeFirestoreConfig(db, normalized);
    return;
  }
  await writeFileConfig(normalized);
}

function locate(config: PromptConfig, key: string) {
  for (let phaseIndex = 0; phaseIndex < config.length; phaseIndex += 1) {
    const promptIndex = config[phaseIndex].prompts.findIndex((item) => item.key === key);
    if (promptIndex !== -1) {
      return { phaseIndex, promptIndex, prompt: config[phaseIndex].prompts[promptIndex] };
    }
  }
  return null;
}

/** Index of the bundled prompt library, so a newly-added prompt can be resolved by key. */
let bundledPromptIndex: Map<string, PromptDefinition> | null = null;
function findBundledPrompt(key: string): PromptDefinition | null {
  if (!bundledPromptIndex) {
    bundledPromptIndex = new Map();
    for (const phase of normalizePromptConfig(bundledPromptsJson)) {
      for (const prompt of phase.prompts) {
        bundledPromptIndex.set(prompt.key, prompt);
      }
    }
  }
  return bundledPromptIndex.get(key) ?? null;
}

export async function getPromptRecord(key: string): Promise<PromptDefinition | null> {
  const db = getFirebaseAdminDb();
  if (db) {
    // The runtime path: one document read, no matter how large the library is.
    await ensureSeeded(db);
    const doc = await promptsCollection(db).doc(key).get();
    if (doc.exists) {
      return withDefaults(doc.data() as PromptDefinition);
    }

    // The DB self-seeds only when empty, so a prompt added to the bundled library
    // AFTER the first seed is missing in production. Lazily publish it on first use
    // so new AI modules work without a manual `import:prompts`.
    const bundled = findBundledPrompt(key);
    if (bundled) {
      await promptsCollection(db).doc(key).set(toStorable(bundled)).catch(() => undefined);
      return bundled;
    }
    return null;
  }

  const config = await readFileConfig();
  return locate(config, key)?.prompt ?? null;
}

/**
 * Persist a single prompt without touching any other prompt in the library, and
 * snapshot the previous state so the change can be rolled back.
 */
export async function savePromptRecord(
  key: string,
  patch: PromptPatch,
  note?: string,
): Promise<PromptDefinition> {
  const applyPatch = (current: PromptDefinition): PromptDefinition => ({
    ...current,
    ...patch,
    key: current.key,
    version: current.version + 1,
    updatedAt: nowIso(),
    history: [
      {
        version: current.version,
        prompt: current.prompt,
        runtimeContract: current.runtimeContract,
        updatedAt: current.updatedAt,
        note,
      },
      ...(current.history || []),
    ].slice(0, MAX_HISTORY_ENTRIES),
  });

  const db = getFirebaseAdminDb();
  if (db) {
    await ensureSeeded(db);
    const ref = promptsCollection(db).doc(key);
    // A transaction so two concurrent edits cannot skip a version or drop a
    // history entry.
    return db.runTransaction(async (transaction) => {
      const doc = await transaction.get(ref);
      if (!doc.exists) {
        throw new Error(`Prompt "${key}" does not exist in the Prompt Engine`);
      }
      const next = applyPatch(withDefaults(doc.data() as PromptDefinition));
      transaction.set(ref, toStorable(next));
      return next;
    });
  }

  const config = await readFileConfig();
  const found = locate(config, key);
  if (!found) {
    throw new Error(`Prompt "${key}" does not exist in the Prompt Engine`);
  }

  const next = applyPatch(found.prompt);
  config[found.phaseIndex].prompts[found.promptIndex] = next;
  await writeFileConfig(config);
  return next;
}

/** Restore an earlier version by writing it forward as a new version. */
export async function rollbackPrompt(key: string, version: number): Promise<PromptDefinition> {
  const record = await getPromptRecord(key);
  if (!record) {
    throw new Error(`Prompt "${key}" does not exist in the Prompt Engine`);
  }

  const target = (record.history || []).find((entry) => entry.version === version);
  if (!target) {
    throw new Error(`Prompt "${key}" has no version ${version} in its history`);
  }

  return savePromptRecord(
    key,
    { prompt: target.prompt, runtimeContract: target.runtimeContract },
    `Rolled back to v${version}`,
  );
}

export function collectPromptVariables(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    found.add(match[1]);
  }
  return [...found];
}

function interpolate(text: string, variables: Record<string, string>): string {
  return text.replace(VARIABLE_PATTERN, (original, name: string) =>
    Object.prototype.hasOwnProperty.call(variables, name) ? variables[name] : original,
  );
}

const RUNTIME_CONTRACT_HEADER = [
  "RUNTIME CONTRACT (authoritative -- these operating rules and this output",
  "format override anything above that conflicts with them):",
];

/**
 * Assemble the final system prompt from its parts, exactly as it runs at
 * execution time: Global System Preamble, then the module body, then the
 * runtime contract, with variables interpolated. Kept pure so the Prompt
 * Engine's preview can call it on unsaved draft text and get byte-for-byte
 * what getPromptText would send to the model.
 *
 * The preamble leads so its non-negotiable rules frame the module, while the
 * runtime contract comes last and is declared authoritative so it still wins
 * on output shape. The preamble is skipped for the preamble module itself so
 * it never self-nests.
 */
export function composePromptText(params: {
  key: string;
  prompt: string;
  runtimeContract?: string;
  preamble?: string;
  variables?: Record<string, string>;
}): string {
  const body = (params.prompt || "").trim();
  const contract = (params.runtimeContract || "").trim();
  const withContract = contract
    ? [body, "", ...RUNTIME_CONTRACT_HEADER, contract].join("\n")
    : body;

  const preamble = (params.preamble || "").trim();
  const composed =
    preamble && params.key !== GLOBAL_PREAMBLE_KEY
      ? [preamble, "", "---", "", withContract].join("\n")
      : withContract;

  return interpolate(composed, params.variables || {});
}

/** The active Global System Preamble text, or "" when none is configured. */
export async function getGlobalPreambleText(): Promise<string> {
  const preamble = await getPromptRecord(GLOBAL_PREAMBLE_KEY);
  return (preamble?.prompt || "").trim();
}

/**
 * Compose the executable system prompt for a module. Throws when the key is
 * missing or empty rather than falling back to code, because the Prompt Engine
 * is the single source of truth for every AI-powered workflow in MTOS -- a
 * silent code fallback would let behaviour drift away from what the engine shows.
 */
export async function getPromptText(
  key: string,
  variables: Record<string, string> = {},
): Promise<string> {
  const record = await getPromptRecord(key);
  if (!record) {
    throw new Error(
      `Prompt "${key}" is not defined in the Prompt Engine. Add it under Settings → Prompt Engine.`,
    );
  }

  if (!(record.prompt || "").trim()) {
    throw new Error(`Prompt "${key}" is empty in the Prompt Engine.`);
  }

  const preamble = key === GLOBAL_PREAMBLE_KEY ? "" : await getGlobalPreambleText();

  return composePromptText({
    key,
    prompt: record.prompt,
    runtimeContract: record.runtimeContract,
    preamble,
    variables,
  });
}

/**
 * Testing seam. The Firestore helpers already take their database handle as an
 * argument, so exposing them lets a test drive the backend with a fake instead
 * of requiring an emulator. Not part of the supported API.
 */
export const __internal = {
  ensureSeeded,
  readFirestoreConfig,
  writeFirestoreConfig,
  resetSeedCache: () => {
    seedPromise = null;
  },
};

export function validatePromptDraft(
  draft: { prompt?: string; runtimeContract?: string; title?: string },
  suppliedVariables: string[] = [],
): PromptValidationIssue[] {
  const issues: PromptValidationIssue[] = [];
  const body = (draft.prompt || "").trim();

  if (!draft.title?.trim()) {
    issues.push({ level: "error", message: "Title is required." });
  }

  if (!body) {
    issues.push({ level: "error", message: "Prompt text is empty — the module that uses it would fail." });
  } else if (body.length < MIN_PROMPT_LENGTH) {
    issues.push({
      level: "warning",
      message: `Prompt is only ${body.length} characters. Very short instructions produce unstable output.`,
    });
  }

  if (body.length > MAX_PROMPT_LENGTH) {
    issues.push({
      level: "error",
      message: `Prompt is ${body.length} characters, over the ${MAX_PROMPT_LENGTH} limit.`,
    });
  }

  const unresolved = collectPromptVariables(`${body}\n${draft.runtimeContract || ""}`).filter(
    (name) => !suppliedVariables.includes(name),
  );
  if (unresolved.length) {
    issues.push({
      level: "warning",
      message: `Unresolved variables: ${unresolved.join(", ")}. These stay as literal text unless the calling module supplies them.`,
    });
  }

  const contract = (draft.runtimeContract || "").trim();
  if (contract && !/json/i.test(contract)) {
    issues.push({
      level: "warning",
      message: "Output contract does not mention JSON. Modules parse responses as JSON.",
    });
  }

  return issues;
}
