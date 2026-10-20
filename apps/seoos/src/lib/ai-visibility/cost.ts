import type { AivUsage, ProviderId } from "./types";

/**
 * Pricing used to (a) ESTIMATE cost before a scan and (b) CALCULATE cost from
 * provider-reported usage after each call. Providers do not return a dollar
 * charge in the API response, so post-call figures are "calculated from
 * reported usage at the listed rates" — not an invoice. Rates can be
 * overridden with AIV_PRICING_JSON (same shape as PRICING) without a deploy of code.
 *
 * Sources (retrieved 2026-10-19):
 *  - Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
 *    (web search: $10 per 1,000 searches; errored searches are not billed)
 */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  /** USD per search / grounding request billed by the provider. */
  perSearch: number;
  source: string;
}

const ANTHROPIC_SRC = "platform.claude.com/docs/en/about-claude/pricing (2026-10-19)";
const a = (i: number, o: number): ModelPrice => ({ inputPerMTok: i, outputPerMTok: o, perSearch: 0.01, source: ANTHROPIC_SRC });

export const PRICING: Record<string, ModelPrice> = {
  "anthropic:claude-haiku-5-5": a(0.1, 0.5),
  "anthropic:claude-sonnet-5-5": a(2, 10),
  "anthropic:claude-opus-5-5": a(4, 20),
  "anthropic:claude-fable-5-1": a(10, 50),
  "anthropic:claude-fable-5": a(10, 50),
  "anthropic:claude-opus-5": a(5, 25),
  "anthropic:claude-sonnet-5": a(2, 10),
  "anthropic:claude-opus-4-8": a(5, 25),
  "anthropic:claude-opus-4-7": a(5, 25),
  "anthropic:claude-opus-4-6": a(5, 25),
  "anthropic:claude-opus-4-5-20251101": a(5, 25),
  "anthropic:claude-sonnet-4-6": a(3, 15),
  "anthropic:claude-sonnet-4-5-20250929": a(3, 15),
  "anthropic:claude-haiku-4-5-20251001": a(1, 5),
};

/** Extra rates registered by adapters (verified in their own modules). */
const registered: Record<string, ModelPrice> = {};
export function registerPricing(entries: Record<string, ModelPrice>): void {
  Object.assign(registered, entries);
}

function overrides(): Record<string, ModelPrice> {
  const raw = typeof process !== "undefined" ? process.env.AIV_PRICING_JSON : undefined;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, ModelPrice>;
  } catch {
    return {};
  }
}

export function priceFor(providerId: ProviderId, model: string): ModelPrice | null {
  const key = `${providerId}:${model}`;
  return overrides()[key] ?? registered[key] ?? PRICING[key] ?? null;
}

export function costFromUsage(price: ModelPrice, usage: AivUsage): number {
  const tokens =
    (usage.inputTokens + usage.cacheWriteTokens * 1.25 + usage.cacheReadTokens * 0.1) * price.inputPerMTok +
    usage.outputTokens * price.outputPerMTok;
  return round6(tokens / 1_000_000 + usage.searchRequests * price.perSearch);
}

export function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export interface EstimateAssumptions {
  /** Average input tokens added per search (results are billed as input). */
  inputTokensPerSearch: number;
  baseInputTokens: number;
  expectedOutputTokens: number;
  expectedSearches: number;
}

export const DEFAULT_ASSUMPTIONS: EstimateAssumptions = {
  inputTokensPerSearch: 12000,
  baseInputTokens: 600,
  expectedOutputTokens: 700,
  expectedSearches: 2,
};

export interface ObservationEstimate {
  expectedUsd: number;
  /** Worst case for one call: max searches and max output tokens. Used for budget reservation. */
  upperBoundUsd: number;
  basis: string;
}

export function estimateObservation(
  price: ModelPrice,
  maxSearches: number,
  maxOutputTokens: number,
  assumptions: EstimateAssumptions = DEFAULT_ASSUMPTIONS,
  historicalAvgUsd?: { avg: number; n: number },
): ObservationEstimate {
  const searches = Math.min(assumptions.expectedSearches, maxSearches);
  const modeled = costFromUsage(price, {
    inputTokens: assumptions.baseInputTokens + searches * assumptions.inputTokensPerSearch,
    outputTokens: assumptions.expectedOutputTokens,
    searchRequests: searches,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  const upper = costFromUsage(price, {
    inputTokens: assumptions.baseInputTokens + maxSearches * assumptions.inputTokensPerSearch * 1.5,
    outputTokens: maxOutputTokens,
    searchRequests: maxSearches,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  });
  if (historicalAvgUsd && historicalAvgUsd.n >= 5) {
    return {
      expectedUsd: round6(historicalAvgUsd.avg),
      upperBoundUsd: Math.max(upper, round6(historicalAvgUsd.avg * 2)),
      basis: `historical average of ${historicalAvgUsd.n} calculated observation costs for this model`,
    };
  }
  return {
    expectedUsd: modeled,
    upperBoundUsd: upper,
    basis: `modeled: ${searches} search(es) × ~${assumptions.inputTokensPerSearch.toLocaleString()} input tokens + ~${assumptions.expectedOutputTokens} output tokens at ${price.source}`,
  };
}
