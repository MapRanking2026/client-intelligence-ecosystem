/**
 * Bridges the Prompt Engine and the model router (server-side only).
 *
 * A service that executes a Prompt Engine prompt calls this with the prompt key
 * and passes the result to callLlmForJson / callLlmForText as `route`:
 *
 *   const route = await getModelRouteForPrompt(env, "qa_evaluation_prompt");
 *   const result = await callLlmForJson({ env, system, userText, route });
 *
 * It reads the prompt's own provider and difficulty (set per prompt in
 * Settings -> Prompt Engine) and lets the environment override them per key.
 * It never throws: a missing prompt record or a store error yields the
 * environment-only route, and with routing off it returns null so the call
 * behaves exactly as it did before routing existed.
 */

import type { getServerEnv } from "@/src/lib/server/env";
import { isModelRoutingEnabled, resolveModelRoute, type ModelRoute } from "@/src/lib/server/model-router";
import { getPromptRecord } from "@/src/lib/server/prompt-store";

type ServerEnv = ReturnType<typeof getServerEnv>;

export async function getModelRouteForPrompt(
  env: ServerEnv,
  promptKey: string,
): Promise<ModelRoute | null> {
  try {
    if (!isModelRoutingEnabled(env)) {
      return null;
    }

    const record = await getPromptRecord(promptKey).catch(() => null);

    return resolveModelRoute(env, {
      promptKey,
      provider: record?.provider,
      difficulty: record?.difficulty,
    });
  } catch (error) {
    // Routing is an optimisation. A failure here must never stop the AI call:
    // with no route the caller uses the default provider order.
    const reason = error instanceof Error ? error.message : "unknown error";
    console.warn(`[model-router] no route for "${promptKey}" (${reason}); using the default provider order`);
    return null;
  }
}
