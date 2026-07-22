import fs from "fs";
import path from "path";

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

export async function getPrompts(): Promise<PromptConfig> {
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

export async function savePrompts(data: PromptConfig): Promise<void> {
  const normalized = normalizePromptConfig(data);
  await fs.promises.mkdir(path.dirname(PROMPT_FILE), { recursive: true });
  await fs.promises.writeFile(PROMPT_FILE, JSON.stringify(normalized, null, 2), "utf8");
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

export async function getPromptRecord(key: string): Promise<PromptDefinition | null> {
  const config = await getPrompts();
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
  const config = await getPrompts();
  const found = locate(config, key);
  if (!found) {
    throw new Error(`Prompt "${key}" does not exist in the Prompt Engine`);
  }

  const { phaseIndex, promptIndex, prompt: current } = found;
  const next: PromptDefinition = {
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
  };

  config[phaseIndex].prompts[promptIndex] = next;
  await savePrompts(config);
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

  const body = (record.prompt || "").trim();
  if (!body) {
    throw new Error(`Prompt "${key}" is empty in the Prompt Engine.`);
  }

  const contract = (record.runtimeContract || "").trim();
  const composed = contract
    ? [
        body,
        "",
        "RUNTIME CONTRACT (authoritative -- these operating rules and this output",
        "format override anything above that conflicts with them):",
        contract,
      ].join("\n")
    : body;

  return interpolate(composed, variables);
}

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
