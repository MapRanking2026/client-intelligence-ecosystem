/**
 * Model router (server-side only).
 *
 * Decides which provider + model a Prompt Engine prompt runs on. Nothing here
 * calls a model: `mtos-ai.ts` asks for a route and puts it at the front of its
 * existing failover chain, so an outage still falls through to the other
 * configured providers exactly as before.
 *
 * Resolution order for a prompt key:
 *   1. MTOS_MODEL_ROUTES[promptKey]            explicit override, set in the environment
 *   2. the prompt's own provider + difficulty  set per prompt in Settings -> Prompt Engine
 *   3. MTOS_MODEL_ROUTES.default               catch-all
 *   4. no route                                the caller keeps the default provider order
 *
 * Routing is OFF until at least one MTOS_MODEL_* variable is set, so deploying
 * this file changes nothing by itself.
 *
 * A tier resolves to a model through MTOS_MODEL_<TIER>; when that variable is
 * missing it falls back to the provider's existing default (ANTHROPIC_MODEL or
 * GEMINI_MODEL), so a model can be swapped without a code change.
 */

import type { getServerEnv } from "@/src/lib/server/env";

type ServerEnv = ReturnType<typeof getServerEnv>;

/** Provider ids as `mtos-ai.ts` names them. OpenAI is failover-only: no tier routes to it. */
export type RoutedProvider = "claude" | "gemini";

export const MODEL_TIERS = [
  "CLAUDE_HEAVY",
  "CLAUDE_STANDARD",
  "CLAUDE_FAST",
  "GEMINI_STANDARD",
  "GEMINI_FAST",
  "GEMINI_LIVE",
] as const;

export type ModelTier = (typeof MODEL_TIERS)[number];

export interface ModelRoute {
  tier: ModelTier;
  provider: RoutedProvider;
  model: string;
  /** Tried next when the routed model fails; absent when no fallback is configured. */
  fallback?: { tier: ModelTier; provider: RoutedProvider; model: string };
}

export interface ModelRouteInput {
  /** Prompt Engine key, e.g. "qa_evaluation_prompt". */
  promptKey?: string;
  /** The prompt's own provider, from its Prompt Engine record. */
  provider?: "claude" | "gemini";
  /** The prompt's own difficulty, from its Prompt Engine record. */
  difficulty?: "simple" | "moderate" | "difficult";
}

function isModelTier(value: unknown): value is ModelTier {
  return typeof value === "string" && (MODEL_TIERS as readonly string[]).includes(value);
}

function providerOf(tier: ModelTier): RoutedProvider {
  return tier.startsWith("GEMINI") ? "gemini" : "claude";
}

/**
 * Parse a JSON object of string -> tier. A malformed variable must not take
 * every AI feature down, so anything unreadable is ignored with a warning and
 * routing behaves as if that variable were unset.
 */
function parseTierMap(raw: string, variableName: string): Record<string, ModelTier> {
  if (!raw.trim()) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected a JSON object");
    }
    const result: Record<string, ModelTier> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isModelTier(value)) {
        result[key] = value;
      } else {
        console.warn(`[model-router] ${variableName}: "${key}" names an unknown tier and was ignored`);
      }
    }
    return result;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unreadable";
    console.warn(`[model-router] ${variableName} is not valid JSON (${reason}); ignoring it`);
    return {};
  }
}

/** The tier a prompt's own provider + difficulty map to. Gemini has no heavy tier. */
function tierFromPromptSettings(
  provider: ModelRouteInput["provider"],
  difficulty: ModelRouteInput["difficulty"],
): ModelTier | undefined {
  if (!provider) {
    return undefined;
  }
  if (provider === "gemini") {
    return difficulty === "simple" ? "GEMINI_FAST" : "GEMINI_STANDARD";
  }
  if (difficulty === "difficult") {
    return "CLAUDE_HEAVY";
  }
  return difficulty === "simple" ? "CLAUDE_FAST" : "CLAUDE_STANDARD";
}

function modelForTier(env: ServerEnv, tier: ModelTier): string {
  const configured = env.modelTiers[tier];
  if (configured) {
    return configured;
  }
  return providerOf(tier) === "gemini" ? env.geminiModel : env.anthropicModel;
}

/** True once any MTOS_MODEL_* variable is set. Until then every caller behaves as before. */
export function isModelRoutingEnabled(env: ServerEnv): boolean {
  return Boolean(
    env.modelRoutes.trim() ||
      env.modelFallbacks.trim() ||
      Object.values(env.modelTiers).some((model) => Boolean(model)),
  );
}

/** Resolve the route for a prompt, or null when routing is off or nothing matches. */
export function resolveModelRoute(env: ServerEnv, input: ModelRouteInput): ModelRoute | null {
  if (!isModelRoutingEnabled(env)) {
    return null;
  }

  const routes = parseTierMap(env.modelRoutes, "MTOS_MODEL_ROUTES");
  const fallbacks = parseTierMap(env.modelFallbacks, "MTOS_MODEL_FALLBACKS");

  const tier =
    (input.promptKey ? routes[input.promptKey] : undefined) ??
    tierFromPromptSettings(input.provider, input.difficulty) ??
    routes.default;

  if (!tier) {
    return null;
  }

  const fallbackTier = fallbacks[tier];

  return {
    tier,
    provider: providerOf(tier),
    model: modelForTier(env, tier),
    fallback:
      fallbackTier && fallbackTier !== tier
        ? {
            tier: fallbackTier,
            provider: providerOf(fallbackTier),
            model: modelForTier(env, fallbackTier),
          }
        : undefined,
  };
}
