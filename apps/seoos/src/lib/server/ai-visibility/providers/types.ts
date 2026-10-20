import type { AivCitation, AivUsage, CollectionStatus, ProviderId } from "@/src/lib/ai-visibility/types";
import { hostOf, normalizeUrl } from "@/src/lib/ai-visibility/url";

/**
 * Provider adapter contract for the OFFICIAL-API measurement channel.
 *
 * An adapter sends ONE fresh, isolated request (no system prompt, no history,
 * no client context) and returns a normalized result. It never falls back to a
 * different provider or model; failures are thrown as ProviderCallError so the
 * queue can record and (if retryable) retry them.
 */

export interface CollectionRequest {
  prompt: string;
  model: string;
  maxSearchUses: number;
  maxOutputTokens: number;
  timeoutMs: number;
  language: string;
  /** Requested location for the provider's location control (if supported). */
  location?: { city?: string; region?: string; country?: string; timezone?: string };
}

export interface CollectionResult {
  status: Extract<CollectionStatus, "success" | "no_ai_answer" | "refusal" | "grounding_unavailable" | "parse_failure">;
  answerText: string;
  citations: AivCitation[];
  /** null = provider does not report whether search ran. */
  searchExecuted: boolean | null;
  searchQueries: string[];
  searchResults: Array<{ url: string; title?: string; pageAge?: string }>;
  usage: AivUsage;
  requestId?: string;
  model: string;
  apiVersion: string;
  stopReason?: string;
  rawResponse: string;
  rawResponseTruncated: boolean;
  appliedLocation?: { control: string; city?: string; region?: string; country?: string; timezone?: string };
  searchConfig: Record<string, string | number | boolean>;
  generationSettings: Record<string, string | number | boolean>;
  note?: string;
}

export class ProviderCallError extends Error {
  constructor(
    readonly errorClass: Extract<CollectionStatus, "timeout" | "rate_limited" | "provider_error" | "auth_error" | "grounding_unavailable" | "parse_failure">,
    message: string,
    readonly retryable: boolean,
    readonly extra: { httpStatus?: number; requestId?: string; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = "ProviderCallError";
  }
}

export type CredentialState = "configured" | "not_configured" | "unsupported";

export interface ProviderCapabilities {
  webSearch: boolean;
  locationControl: "approximate_user_location" | "none";
  reportsSearchExecuted: boolean;
  citationSpans: boolean;
}

export interface ProviderAdapter {
  id: ProviderId;
  displayName: string;
  /** Exactly what the observation is — never a consumer-app label. */
  surfaceLabel: string;
  docsUrl: string;
  defaultModel: string;
  capabilities: ProviderCapabilities;
  credentialStatus(): { state: CredentialState; detail: string };
  testConnection(model: string): Promise<{ ok: boolean; message: string; latencyMs: number }>;
  collect(req: CollectionRequest, signal?: AbortSignal): Promise<CollectionResult>;
}

/* ------------------------------ helpers ------------------------------- */

export const RAW_LIMIT = 300_000;

/** Serialize provider JSON for evidence: drops opaque encrypted blobs, caps size. */
export function serializeRaw(body: unknown, dropKeys: string[] = []): { raw: string; truncated: boolean } {
  const drop = new Set(dropKeys);
  const json = JSON.stringify(body, (k, v) => (drop.has(k) ? "[omitted]" : v));
  if (json.length <= RAW_LIMIT) return { raw: json, truncated: false };
  return { raw: json.slice(0, RAW_LIMIT), truncated: true };
}

/** Merge citations by normalized URL, keeping first-appearance order and all spans. */
export function mergeCitations(
  items: Array<{ url: string; title?: string; citedText?: string; span?: { start: number; end: number } }>,
): AivCitation[] {
  const byUrl = new Map<string, AivCitation>();
  for (const it of items) {
    if (!it.url) continue;
    const n = normalizeUrl(it.url);
    let c = byUrl.get(n);
    if (!c) {
      c = { url: it.url, normalizedUrl: n, domain: hostOf(it.url), title: it.title, citedText: it.citedText, answerSpans: [], order: byUrl.size + 1 };
      byUrl.set(n, c);
    }
    if (it.span && !c.answerSpans.some((s) => s.start === it.span!.start && s.end === it.span!.end)) c.answerSpans.push(it.span);
    if (!c.citedText && it.citedText) c.citedText = it.citedText;
    if (!c.title && it.title) c.title = it.title;
  }
  return [...byUrl.values()];
}

export function retryAfterMs(h: Headers): number | undefined {
  const ra = h.get("retry-after");
  if (!ra) return undefined;
  const secs = Number(ra);
  if (Number.isFinite(secs)) return Math.min(secs * 1000, 300_000);
  const date = Date.parse(ra);
  return Number.isFinite(date) ? Math.max(0, Math.min(date - Date.now(), 300_000)) : undefined;
}

/** Map an HTTP failure to an error class without leaking credentials. */
export function httpError(provider: string, status: number, bodyText: string, headers: Headers, requestId?: string): ProviderCallError {
  const msg = `${provider} HTTP ${status}: ${redact(bodyText).slice(0, 400)}`;
  const extra = { httpStatus: status, requestId, retryAfterMs: retryAfterMs(headers) };
  // Account/billing problems look like 400/402/429 but are not retryable.
  if (/credit balance|billing|insufficient_quota|exceeded your current quota|payment required|account is not active/i.test(bodyText) || status === 402) {
    return new ProviderCallError("auth_error", `Account/billing problem — ${msg}`, false, extra);
  }
  if (status === 429) return new ProviderCallError("rate_limited", msg, true, extra);
  if (status === 401 || status === 403) return new ProviderCallError("auth_error", msg, false, extra);
  if (status === 408) return new ProviderCallError("timeout", msg, true, extra);
  if (status >= 500) return new ProviderCallError("provider_error", msg, true, extra);
  if (/web[_ ]search.*(not enabled|disabled|not available)|grounding.*(not supported|unavailable)/i.test(bodyText)) {
    return new ProviderCallError("grounding_unavailable", msg, false, extra);
  }
  return new ProviderCallError("provider_error", msg, false, extra);
}

/** Remove anything that looks like a credential from text bound for logs/storage. */
export function redact(s: string): string {
  return s
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, "[redacted]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]")
    .replace(/pplx-[A-Za-z0-9]{10,}/g, "[redacted]")
    .replace(/(key=)[^&\s"]+/gi, "$1[redacted]")
    .replace(/(bearer\s+)[A-Za-z0-9._-]+/gi, "$1[redacted]");
}

export async function timedFetch(url: string, init: RequestInit, timeoutMs: number, outer?: AbortSignal): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("timeout")), timeoutMs);
  const onAbort = () => ctrl.abort(new Error("cancelled"));
  outer?.addEventListener("abort", onAbort);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (ctrl.signal.aborted) {
      const reason = ctrl.signal.reason instanceof Error ? ctrl.signal.reason.message : "timeout";
      throw new ProviderCallError("timeout", `Request ${reason} after ${timeoutMs} ms`, reason === "timeout");
    }
    throw new ProviderCallError("provider_error", `Network error: ${redact(e instanceof Error ? e.message : String(e))}`, true);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onAbort);
  }
}

export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire",
  NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
};
