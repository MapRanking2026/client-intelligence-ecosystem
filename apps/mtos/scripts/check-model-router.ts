/**
 * Checks the model router: routing is off by default, the environment and the
 * prompt's own provider/difficulty resolve to the right tier and model, and a
 * malformed variable cannot take AI calls down. Pure functions, no network.
 */
import assert from "node:assert/strict";

import { getServerEnv } from "../src/lib/server/env";
import { isModelRoutingEnabled, resolveModelRoute } from "../src/lib/server/model-router";

const ROUTING_VARS = [
  "MTOS_MODEL_CLAUDE_HEAVY",
  "MTOS_MODEL_CLAUDE_STANDARD",
  "MTOS_MODEL_CLAUDE_FAST",
  "MTOS_MODEL_GEMINI_STANDARD",
  "MTOS_MODEL_GEMINI_FAST",
  "MTOS_MODEL_GEMINI_LIVE",
  "MTOS_MODEL_ROUTES",
  "MTOS_MODEL_FALLBACKS",
];

function withEnv(values: Record<string, string>) {
  for (const name of ROUTING_VARS) {
    delete process.env[name];
  }
  process.env.ANTHROPIC_MODEL = "claude-default";
  process.env.GEMINI_MODEL = "gemini-default";
  Object.assign(process.env, values);
  return getServerEnv();
}

// 1. Off by default: nothing set means no route, so callers behave as before.
let env = withEnv({});
assert.equal(isModelRoutingEnabled(env), false);
assert.equal(resolveModelRoute(env, { promptKey: "qa_evaluation_prompt", provider: "claude", difficulty: "difficult" }), null);

// 2. An explicit route wins over the prompt's own settings.
env = withEnv({
  MTOS_MODEL_CLAUDE_HEAVY: "claude-heavy",
  MTOS_MODEL_GEMINI_STANDARD: "gemini-standard",
  MTOS_MODEL_ROUTES: JSON.stringify({ default: "CLAUDE_STANDARD", qa_evaluation_prompt: "CLAUDE_HEAVY" }),
  MTOS_MODEL_FALLBACKS: JSON.stringify({ CLAUDE_HEAVY: "GEMINI_STANDARD" }),
});
let route = resolveModelRoute(env, { promptKey: "qa_evaluation_prompt", provider: "gemini", difficulty: "simple" });
assert.deepEqual(route, {
  tier: "CLAUDE_HEAVY",
  provider: "claude",
  model: "claude-heavy",
  fallback: { tier: "GEMINI_STANDARD", provider: "gemini", model: "gemini-standard" },
});

// 3. No explicit route: the prompt's provider + difficulty pick the tier.
route = resolveModelRoute(env, { promptKey: "lead_verification_prompt", provider: "gemini", difficulty: "moderate" });
assert.equal(route?.tier, "GEMINI_STANDARD");
assert.equal(route?.model, "gemini-standard");
route = resolveModelRoute(env, { promptKey: "x", provider: "claude", difficulty: "simple" });
assert.equal(route?.tier, "CLAUDE_FAST");
// A tier with no model of its own falls back to the provider default.
assert.equal(route?.model, "claude-default");

// 4. Neither: the default route applies.
route = resolveModelRoute(env, { promptKey: "unlisted_prompt" });
assert.equal(route?.tier, "CLAUDE_STANDARD");
assert.equal(route?.fallback, undefined);

// 5. Malformed JSON and unknown tiers are ignored, never thrown.
env = withEnv({ MTOS_MODEL_ROUTES: "{not json", MTOS_MODEL_CLAUDE_FAST: "claude-fast" });
assert.equal(resolveModelRoute(env, { promptKey: "unlisted_prompt" }), null);
env = withEnv({ MTOS_MODEL_ROUTES: JSON.stringify({ default: "NOT_A_TIER", a: "CLAUDE_FAST" }), MTOS_MODEL_CLAUDE_FAST: "claude-fast" });
assert.equal(resolveModelRoute(env, { promptKey: "unlisted_prompt" }), null);
assert.equal(resolveModelRoute(env, { promptKey: "a" })?.model, "claude-fast");

console.log("model router: all checks passed");
