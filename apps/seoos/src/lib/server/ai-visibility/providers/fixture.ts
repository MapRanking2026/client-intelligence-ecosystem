import { mergeCitations, ProviderCallError, type CollectionRequest, type CollectionResult, type ProviderAdapter } from "./types";

/**
 * TEST-ONLY provider. Enabled solely when AIV_ENABLE_FIXTURE_PROVIDER=true.
 * Its observations are flagged `isFixture` and are excluded from every live
 * dashboard/metric. Behaviour is scripted via markers in the prompt text:
 *   [rate_limit:N]  → first N calls per prompt return HTTP-429-style errors
 *   [timeout]       → always times out (retryable)
 *   [auth]          → credential error (not retryable)
 *   [malformed]     → response that cannot be parsed
 *   [crash_after_write] → handled by queue tests
 */

const calls = new Map<string, number>();
export function resetFixtureCalls(): void {
  calls.clear();
}
export function fixtureCallCount(prompt: string): number {
  return calls.get(prompt) ?? 0;
}

export const FIXTURE_ANSWER = (city: string) => `Here are a few options in ${city}:

1. **Music City Maids** - Highly rated for deep cleaning.
2. **Sparkle Pro Cleaning** - Reliable and well-reviewed locally.
3. **Tidy Nest Cleaning Services** - Good for move-out cleans.`;

export function fixtureEnabled(): boolean {
  return process.env.AIV_ENABLE_FIXTURE_PROVIDER === "true";
}

export const fixtureAdapter: ProviderAdapter = {
  id: "fixture",
  displayName: "Fixture provider (tests only)",
  surfaceLabel: "Fixture — synthetic test data",
  docsUrl: "about:blank",
  defaultModel: "fixture-1",
  capabilities: { webSearch: true, locationControl: "approximate_user_location", reportsSearchExecuted: true, citationSpans: true },
  credentialStatus() {
    return fixtureEnabled()
      ? { state: "configured", detail: "Test fixture provider enabled (AIV_ENABLE_FIXTURE_PROVIDER)" }
      : { state: "unsupported", detail: "Test-only provider" };
  },
  async testConnection() {
    return { ok: fixtureEnabled(), message: fixtureEnabled() ? "Fixture provider ready" : "Disabled", latencyMs: 0 };
  },
  async collect(req: CollectionRequest): Promise<CollectionResult> {
    const n = (calls.get(req.prompt) ?? 0) + 1;
    calls.set(req.prompt, n);
    const rl = req.prompt.match(/\[rate_limit:(\d+)\]/);
    if (rl && n <= Number(rl[1])) throw new ProviderCallError("rate_limited", "fixture 429", true, { httpStatus: 429, retryAfterMs: 10 });
    if (req.prompt.includes("[timeout]")) throw new ProviderCallError("timeout", "fixture timeout", true);
    if (req.prompt.includes("[auth]")) throw new ProviderCallError("auth_error", "fixture invalid key", false, { httpStatus: 401 });
    if (req.prompt.includes("[malformed]")) throw new ProviderCallError("parse_failure", "fixture malformed body", false);
    const answer = FIXTURE_ANSWER(req.location?.city ?? "the area");
    const spanStart = answer.indexOf("2.");
    return {
      status: "success",
      answerText: answer,
      citations: mergeCitations([
        { url: "https://www.yelp.com/search?find_desc=cleaning", title: "Top 10 Best Cleaning - Yelp", span: { start: 0, end: 30 } },
        { url: "https://sparkleprocleaning.com/", title: "Sparkle Pro Cleaning", span: { start: spanStart, end: spanStart + 40 } },
        { url: "https://www.yelp.com/search?find_desc=cleaning&utm_source=x", title: "Top 10 Best Cleaning - Yelp", span: { start: 0, end: 30 } },
      ]),
      searchExecuted: true,
      searchQueries: [`fixture: ${req.prompt.slice(0, 40)}`],
      searchResults: [],
      usage: { inputTokens: 1000, outputTokens: 200, searchRequests: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      requestId: `fixture_${n}`,
      model: req.model,
      apiVersion: "fixture",
      stopReason: "end_turn",
      rawResponse: JSON.stringify({ fixture: true }),
      rawResponseTruncated: false,
      appliedLocation: req.location ? { control: "fixture", ...req.location } : undefined,
      searchConfig: { tool: "fixture" },
      generationSettings: { max_tokens: req.maxOutputTokens },
    };
  },
};
