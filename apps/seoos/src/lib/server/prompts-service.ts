import { DEFAULT_PROMPTS, GLOBAL_GUARDRAILS, PromptV1, getDefaultPrompt } from "@/src/lib/domain/prompt";
import { nowIso } from "@/src/lib/ids";
import { getPromptRepo } from "@/src/lib/server/repositories/prompt-repo";
import { buildStyleDirective } from "@/src/lib/server/specialist-style-service";

export interface PromptView {
  key: string;
  category: string;
  name: string;
  description: string;
  template: string;
  isCustom: boolean;
  updatedAt?: string;
}

/** Full catalog: default prompts with any admin override merged in. */
export async function listPromptCatalog(tenantId: string): Promise<PromptView[]> {
  const overrides = new Map((await getPromptRepo().list(tenantId)).map((p) => [p.key, p]));
  return DEFAULT_PROMPTS.map((def) => {
    const o = overrides.get(def.key);
    return {
      key: def.key,
      category: def.category,
      name: def.name,
      description: def.description,
      template: o?.template ?? def.template,
      isCustom: Boolean(o),
      updatedAt: o?.updatedAt,
    };
  });
}

/** The instruction that governs an AI action right now — override, else default. */
export async function getEffectivePrompt(tenantId: string, key: string): Promise<string> {
  const o = await getPromptRepo().get(tenantId, key);
  if (o?.template) return o.template;
  return getDefaultPrompt(key)?.template ?? "";
}

/**
 * Compose the full system instruction for ANY AI action:
 * global guardrails (always) + the action's effective prompt + the account
 * specialist's style directive. This is the one place every AI call goes through.
 */
export async function composeAiSystem(
  tenantId: string,
  promptKey: string,
  specialistId: string | undefined,
  specialistName?: string,
): Promise<string> {
  const [prompt, style] = await Promise.all([
    getEffectivePrompt(tenantId, promptKey),
    buildStyleDirective(tenantId, specialistId, specialistName),
  ]);
  return `${GLOBAL_GUARDRAILS}\n\n${prompt}\n\n${style}`;
}

/** Admin: save an override; takes effect immediately. */
export async function upsertPrompt(
  tenantId: string,
  key: string,
  template: string,
  userId: string,
): Promise<PromptV1> {
  if (!getDefaultPrompt(key)) throw new Error(`Unknown prompt key: ${key}`);
  if (!template.trim()) throw new Error("Prompt template cannot be empty.");
  return getPromptRepo().save(
    PromptV1.parse({
      schemaVersion: 1,
      tenantId,
      key,
      template: template.trim(),
      updatedAt: nowIso(),
      updatedByUserId: userId,
    }),
  );
}

/** Admin: drop the override, reverting to the built-in default. */
export async function resetPrompt(tenantId: string, key: string): Promise<void> {
  await getPromptRepo().remove(tenantId, key);
}
