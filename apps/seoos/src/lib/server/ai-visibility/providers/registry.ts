import type { ProviderId } from "@/src/lib/ai-visibility/types";
import { registerPricing } from "@/src/lib/ai-visibility/cost";

import { anthropicAdapter } from "./anthropic";
import { fixtureAdapter, fixtureEnabled } from "./fixture";
import { geminiAdapter } from "./gemini";
import { openaiAdapter } from "./openai";
import type { ProviderAdapter } from "./types";

registerPricing({
  "fixture:fixture-1": { inputPerMTok: 1, outputPerMTok: 5, perSearch: 0.01, source: "fixture (synthetic)" },
});

/** Placeholder for a provider whose adapter is not implemented/verified yet. */
function unsupported(id: ProviderId, displayName: string, reason: string): ProviderAdapter {
  return {
    id,
    displayName,
    surfaceLabel: displayName,
    docsUrl: "",
    defaultModel: "",
    capabilities: { webSearch: false, locationControl: "none", reportsSearchExecuted: false, citationSpans: false },
    credentialStatus: () => ({ state: "unsupported", detail: reason }),
    testConnection: async () => ({ ok: false, message: `Unsupported: ${reason}`, latencyMs: 0 }),
    collect: async () => {
      throw new Error(`Unsupported provider: ${reason}`);
    },
  };
}

const ADAPTERS: Partial<Record<ProviderId, ProviderAdapter>> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
  gemini: geminiAdapter,
  // Perplexity: no credentials available to verify an adapter → shown as unsupported.
};

export function getAdapter(id: ProviderId): ProviderAdapter {
  if (id === "fixture") return fixtureEnabled() ? fixtureAdapter : unsupported("fixture", "Fixture provider", "test-only");
  return (
    ADAPTERS[id] ??
    unsupported(id, { openai: "OpenAI", gemini: "Google Gemini", perplexity: "Perplexity", anthropic: "Anthropic" }[id] ?? id, id === "perplexity" ? "Adapter not implemented — no credentials were available to verify the Sonar API integration" : "Adapter not implemented yet")
  );
}

/** Providers shown in settings (fixture only when enabled for tests). */
export function listAdapters(): ProviderAdapter[] {
  const ids: ProviderId[] = ["anthropic", "openai", "gemini", "perplexity"];
  if (fixtureEnabled()) ids.push("fixture");
  return ids.map(getAdapter);
}

export function registerAdapter(a: ProviderAdapter): void {
  ADAPTERS[a.id] = a;
}
