import { registerPricing } from "@/src/lib/ai-visibility/cost";
import {
  httpError,
  mergeCitations,
  ProviderCallError,
  redact,
  serializeRaw,
  timedFetch,
  type CollectionRequest,
  type CollectionResult,
  type ProviderAdapter,
} from "./types";

/**
 * Gemini API — Interactions endpoint with the `google_search` grounding tool.
 * Docs (verified 2026-10-19):
 *  - https://ai.google.dev/gemini-api/docs/google-search — `POST /v1beta/interactions`
 *    with `tools: [{"type":"google_search"}]`; steps `google_search_call`
 *    (arguments.queries), `google_search_result` (is_error, search_suggestions),
 *    `model_output` (content[].text + `url_citation` annotations with start/end index).
 *  - https://ai.google.dev/api/interactions-api — usage.total_input_tokens,
 *    total_output_tokens, total_thought_tokens, total_tool_use_tokens,
 *    total_cached_tokens, grounding_tool_count; status completed|incomplete|failed…;
 *    `store` flag.
 *  - Pricing: https://ai.google.dev/gemini-api/docs/pricing — Gemini 3+: grounding
 *    billed per search query, $14 / 1,000 after a shared free monthly allowance
 *    (the allowance is ignored here so estimates stay conservative).
 *  - No user-location control is documented for google_search, so "near me"
 *    prompts on Gemini are labelled location-ambiguous.
 *
 * Observations are labelled "Gemini API + Google Search grounding" — NOT Google
 * AI Overviews / AI Mode and NOT the Gemini app.
 */

const SRC = "ai.google.dev/gemini-api/docs/pricing (2026-10-19; Flash prices rise 2027-01-01)";
registerPricing({
  "gemini:gemini-3.8-flash": { inputPerMTok: 0.75, outputPerMTok: 3.75, perSearch: 0.014, source: SRC },
  "gemini:gemini-3.6-flash": { inputPerMTok: 0.75, outputPerMTok: 3.75, perSearch: 0.014, source: SRC },
  "gemini:gemini-3.5-flash-lite": { inputPerMTok: 0.3, outputPerMTok: 2.5, perSearch: 0.014, source: SRC },
});

const API = "https://generativelanguage.googleapis.com/v1beta/interactions";

function apiKey(): string {
  return process.env.AIV_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "";
}

interface GemStep {
  type: string;
  arguments?: { queries?: string[] };
  is_error?: boolean;
  content?: Array<{ type?: string; text?: string; annotations?: Array<{ type?: string; url?: string; title?: string; start_index?: number; end_index?: number }> }>;
}
interface GemInteraction {
  id?: string;
  model?: string;
  status?: string;
  steps?: GemStep[];
  errors?: Array<{ code?: string; message?: string }>;
  usage?: {
    total_input_tokens?: number;
    total_output_tokens?: number;
    total_thought_tokens?: number;
    total_tool_use_tokens?: number;
    total_cached_tokens?: number;
    grounding_tool_count?: Array<{ type?: string; count?: number }>;
  };
}

/** Exported for fixture tests. */
export function parseGeminiSteps(steps: GemStep[]) {
  const queries: string[] = [];
  let calls = 0;
  let errored = 0;
  let answer = "";
  const cites: Array<{ url: string; title?: string; span?: { start: number; end: number } }> = [];
  for (const s of steps) {
    if (s.type === "google_search_call") {
      calls += 1;
      for (const q of s.arguments?.queries ?? []) if (q) queries.push(q);
    }
    if (s.type === "google_search_result" && s.is_error) errored += 1;
    if (s.type === "model_output") {
      for (const c of s.content ?? []) {
        if (typeof c.text !== "string" || (c.type && c.type !== "text")) continue;
        const base = answer.length ? answer.length + 2 : 0;
        answer += (answer ? "\n\n" : "") + c.text;
        for (const a of c.annotations ?? []) {
          if (a.type === "url_citation" && a.url) {
            cites.push({ url: a.url, title: a.title, span: typeof a.start_index === "number" && typeof a.end_index === "number" ? { start: base + a.start_index, end: base + a.end_index } : undefined });
          }
        }
      }
    }
  }
  return { answer, citations: mergeCitations(cites), queries, calls, errored };
}

export const geminiAdapter: ProviderAdapter = {
  id: "gemini",
  displayName: "Google Gemini API",
  surfaceLabel: "Gemini API + Google Search grounding (not AI Overviews / AI Mode)",
  docsUrl: "https://ai.google.dev/gemini-api/docs/google-search",
  defaultModel: "gemini-3.8-flash",
  capabilities: { webSearch: true, locationControl: "none", reportsSearchExecuted: true, citationSpans: true },

  credentialStatus() {
    return apiKey() ? { state: "configured", detail: "GEMINI_API_KEY is set on the server" } : { state: "not_configured", detail: "Set GEMINI_API_KEY (server environment) to enable" };
  },

  async testConnection(model: string) {
    const t0 = Date.now();
    const key = apiKey();
    if (!key) return { ok: false, message: "Not configured: GEMINI_API_KEY is missing", latencyMs: 0 };
    try {
      const res = await timedFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`, { headers: { "x-goog-api-key": key } }, 15000);
      const text = await res.text();
      if (!res.ok) return { ok: false, message: redact(`HTTP ${res.status}: ${text.slice(0, 300)}`), latencyMs: Date.now() - t0 };
      return { ok: true, message: `Connected. Model ${model} is available to this key. (Metadata check only — no tokens spent.)`, latencyMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, message: redact(e instanceof Error ? e.message : "connection failed"), latencyMs: Date.now() - t0 };
    }
  },

  async collect(req: CollectionRequest, signal?: AbortSignal): Promise<CollectionResult> {
    const key = apiKey();
    if (!key) throw new ProviderCallError("auth_error", "GEMINI_API_KEY is not configured", false);
    // Fresh, isolated interaction: no system instruction, no previous_interaction_id, not stored.
    const body = { model: req.model, input: req.prompt, tools: [{ type: "google_search" }], generation_config: { max_output_tokens: req.maxOutputTokens }, store: false };
    const res = await timedFetch(API, { method: "POST", headers: { "x-goog-api-key": key, "content-type": "application/json" }, body: JSON.stringify(body) }, req.timeoutMs, signal);
    const requestId = res.headers.get("x-request-id") ?? res.headers.get("x-goog-request-id") ?? undefined;
    const text = await res.text();
    if (!res.ok) throw httpError("Gemini", res.status, text, res.headers, requestId);
    let json: GemInteraction;
    try {
      json = JSON.parse(text) as GemInteraction;
    } catch {
      throw new ProviderCallError("parse_failure", `Gemini returned non-JSON body: ${redact(text).slice(0, 200)}`, true, { requestId });
    }
    if (json.status === "failed") throw new ProviderCallError("provider_error", `Gemini interaction failed: ${json.errors?.map((e) => e.message).join("; ") ?? "unknown"}`, true, { requestId });
    if (!Array.isArray(json.steps)) throw new ProviderCallError("parse_failure", "Gemini response had no steps array", true, { requestId });
    const p = parseGeminiSteps(json.steps);
    const u = json.usage ?? {};
    const grounded = (u.grounding_tool_count ?? []).filter((g) => (g.type ?? "").includes("search")).reduce((s, g) => s + (g.count ?? 0), 0);
    const { raw, truncated } = serializeRaw(json, ["signature"]);
    let status: CollectionResult["status"] = "success";
    let note: string | undefined;
    if (!p.answer.trim()) status = "no_ai_answer";
    else if (p.calls > 0 && p.errored >= p.calls) {
      status = "grounding_unavailable";
      note = "All Google Search grounding calls errored; answer was not grounded.";
    }
    if (json.status === "incomplete") note = "Interaction incomplete (e.g. max_output_tokens reached); answer may be truncated.";
    return {
      status,
      answerText: p.answer,
      citations: p.citations,
      searchExecuted: p.calls - p.errored > 0 || grounded > 0,
      searchQueries: p.queries,
      searchResults: [],
      usage: {
        inputTokens: Math.max(0, (u.total_input_tokens ?? 0) + (u.total_tool_use_tokens ?? 0) - (u.total_cached_tokens ?? 0)),
        cacheReadTokens: u.total_cached_tokens ?? 0,
        cacheWriteTokens: 0,
        outputTokens: (u.total_output_tokens ?? 0) + (u.total_thought_tokens ?? 0),
        // Billed per executed search query on Gemini 3+.
        searchRequests: grounded || p.queries.length,
      },
      requestId: requestId ?? json.id,
      model: json.model ?? req.model,
      apiVersion: "v1beta interactions; tool google_search",
      stopReason: json.status,
      rawResponse: raw,
      rawResponseTruncated: truncated,
      appliedLocation: undefined,
      searchConfig: { tool: "google_search", location_control: "none documented" },
      generationSettings: { max_output_tokens: req.maxOutputTokens, thinking: "model default", system_instruction: "none", store: false },
      note,
    };
  },
};
