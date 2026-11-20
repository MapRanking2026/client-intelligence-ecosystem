/**
 * Bridges the Prompt Engine and the model router (server-side only).
 *
 * A service that executes a Prompt Engine prompt calls this with the prompt key
 * and passes the result to callLlmForJson / callLlmForText as `route`:
 *
 *   const route = await getModelRouteForPrompt(env, "qa_evaluation_prompt");
 *   const result = await callLlmForJson({ env, system, userText, route });
 *
 * It reads the model pinned on the prompt, and the prompt's own provider and
 * difficulty (all set per prompt in Settings -> Prompt Engine). A pinned model
 * wins; otherwise the environment can override provider and difficulty per key.
 * It never throws: a missing prompt record or a store error yields the
 * environment-only route, and with nothing pinned and routing off it returns
 * null so the call behaves exactly as it did before routing existed.
 */

import type { getServerEnv } from "@/src/lib/server/env";
import { resolveModelRoute, type ModelRoute } from "@/src/lib/server/model-router";
import { getPromptRecord } from "@/src/lib/server/prompt-store";

type ServerEnv = ReturnType<typeof getServerEnv>;

export async function getModelRouteForPrompt(
  env: ServerEnv,
  promptKey: string,
): Promise<ModelRoute | null> {
  try {
    // Read first: a model pinned on the prompt applies even when environment
    // routing is off.
    const record = await getPromptRecord(promptKey).catch(() => null);

    return resolveModelRoute(env, {
      promptKey,
      provider: record?.provider,
      difficulty: record?.difficulty,
      model: record?.model,
    });
  } catch (error) {
    // Routing is an optimisation. A failure here must never stop the AI call:
    // with no route the caller uses the default provider order.
    const reason = error instanceof Error ? error.message : "unknown error";
    console.warn(`[model-router] no route for "${promptKey}" (${reason}); using the default provider order`);
    return null;
  }
}
