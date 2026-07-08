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

export type PromptDefinition = {
  key: string;
  title: string;
  role: PromptRole;
  prompt: string;
  description?: string;
  provider?: PromptProvider;
  difficulty?: PromptTaskDifficulty;
};

export type PromptPhase = {
  phase: string;
  prompts: PromptDefinition[];
};

export type PromptConfig = PromptPhase[];

const PROMPT_FILE = path.join(process.cwd(), "src", "prompts", "mtos-prompts.json");

export async function getPrompt(key: string, fallback: string): Promise<string> {
  const prompts = await getPrompts();

  for (const phase of prompts) {
    const match = phase.prompts.find((item) => item.key === key);
    if (match) {
      return match.prompt;
    }
  }

  return fallback;
}

function normalizePromptConfig(value: unknown): PromptConfig {
  if (Array.isArray(value)) {
    return value as PromptConfig;
  }

  if (value && typeof value === "object") {
    const candidate = value as Record<string, unknown>;
    const entries = Object.entries(candidate);
    const stringEntries = entries.filter(([, prompt]) => typeof prompt === "string") as [string, string][];

    if (stringEntries.length === entries.length) {
      return [
        {
          phase: "Phase 1 — Custom prompts",
          prompts: stringEntries.map(([key, prompt]) => ({
            key,
            title: key
              .replace(/_/g, " ")
              .replace(/\b\w/g, (character) => character.toUpperCase()),
            role: "Research Agent",
            prompt,
          })),
        },
      ];
    }

    const promptObjects = entries
      .filter(([, prompt]) => prompt && typeof prompt === "object" && "prompt" in (prompt as Record<string, unknown>))
      .map(([key, prompt]) => ({
        key,
        ...(prompt as Record<string, unknown>),
      })) as PromptDefinition[];

    if (promptObjects.length === entries.length) {
      return [
        {
          phase: "Imported prompts",
          prompts: promptObjects,
        },
      ];
    }
  }

  return [];
}

export async function getPrompts(): Promise<PromptConfig> {
  try {
    const text = await fs.promises.readFile(PROMPT_FILE, "utf8");
    const json = JSON.parse(text);
    return normalizePromptConfig(json);
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

export async function savePrompts(data: PromptConfig): Promise<void> {
  await fs.promises.mkdir(path.dirname(PROMPT_FILE), { recursive: true });
  await fs.promises.writeFile(PROMPT_FILE, JSON.stringify(data, null, 2), "utf8");
}
