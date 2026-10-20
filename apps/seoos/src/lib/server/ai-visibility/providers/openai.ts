import { registerPricing } from "@/src/lib/ai-visibility/cost";
import {
  httpError,
  mergeCitations,
  ProviderCallError,
  redact,
  serializeRaw,
  STATE_NAMES,
  timedFetch,
  type CollectionRequest,
  type CollectionResult,
  type ProviderAdapter,
} from "./types";

/**
 * OpenAI Responses API + hosted `web_search` tool.
 * Docs (verified 2026-10-19):
 *  - https://developers.openai.com/api/docs/guides/tools-web-search
 *    tool `{"type":"web_search"}` with optional
 *    user_location {type:"approximate", country (ISO-2), city, region, timezone};
 *    output items `web_search_call` (status, action.type search|open_page|find_in_page,
 *    action.query / action.queries, action.sources when included via
 *    include:["web_search_call.action.sources"]) and `message` with
 *    output_text + `url_citation` annotations (url, title, start_index, end_index).
 *  - Pricing: https://developers.openai.com/api/docs/pricing — web search $10 / 1k
 *    calls + search content tokens at model rates;
 *    gpt-5.5 $5 / $30 per 1M; gpt-5.4-mini $0.75 / $4.50 per 1M.
 *
 * Observations are labelled "OpenAI API + web search" — NOT ChatGPT app results.
 */

const SRC = "developers.openai.com/api/docs/pricing + model pages (2026-10-19)";
registerPricing({
  "openai:gpt-5.5": { inputPerMTok: 5, outputPerMTok: 30, perSearch: 0.01, source: SRC },
  "openai:gpt-5.5-2026-04-23": { inputPerMTok: 5, outputPerMTok: 30, perSearch: 0.01, source: SRC },
  "openai:gpt-5.4-mini": { inputPerMTok: 0.75, outputPerMTok: 4.5, perSearch: 0.01, source: SRC },
  "openai:gpt-5.4-mini-2026-03-17": { inputPerMTok: 0.75, outputPerMTok: 4.5, perSearch: 0.01, source: SRC },
});

const API = "https://api.openai.com/v1/responses";

function apiKey(): string {
  return process.env.AIV_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "";
}

interface OAIItem {
  type: string;
  status?: string;
  action?: { type?: string; query?: string; queries?: string[]; sources?: Array<{ url?: string; type?: string }> };
  content?: Array<{ type: string; text?: string; refusal?: string; annotations?: Array<{ type: string; url?: string; title?: string; start_index?: number; end_index?: number }> }>;
}

interface OAIResponse {
  id?: string;
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  error?: { message?: string } | null;
  output?: OAIItem[];
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number }; output_tokens_details?: { reasoning_tokens?: number } };
}

/** Exported for fixture tests. */
export function parseOpenAIOutput(output: OAIItem[]) {
  const queries: string[] = [];
  const sources: Array<{ url: string }> = [];
  let searchCalls = 0;
  let searchFailed = 0;
  let answer = "";
  let refusal = "";
  const cites: Array<{ url: string; title?: string; span?: { start: number; end: number } }> = [];
  for (const item of output) {
    if (item.type === "web_search_call") {
      if (item.action?.type === "search" || !item.action?.type) {
        searchCalls += 1;
        if (item.status === "failed") searchFailed += 1;
      }
      if (item.action?.query) queries.push(item.action.query);
      for (const q of item.action?.queries ?? []) queries.push(q);
      for (const s of item.action?.sources ?? []) if (s.url) sources.push({ url: s.url });
    }
    if (item.type === "message") {
      for (const c of item.content ?? []) {
        if (c.type === "refusal" && c.refusal) refusal += c.refusal;
        if (c.type !== "output_text" || typeof c.text !== "string") continue;
        const offset = answer.length;
        answer += (answer ? "\n\n" : "") + c.text;
        const base = offset + (offset ? 2 : 0);
        for (const a of c.annotations ?? []) {
          if (a.type === "url_citation" && a.url) {
            cites.push({ url: a.url, title: a.title, span: typeof a.start_index === "number" && typeof a.end_index === "number" ? { start: base + a.start_index, end: base + a.end_index } : undefined });
          }
        }
      }
    }
  }
  return { answer, refusal, citations: mergeCitations(cites), queries: [...new Set(queries)], sources, searchCalls, searchFailed };
}

export const openaiAdapter: ProviderAdapter = {
  id: "openai",
  displayName: "OpenAI (Responses API)",
  surfaceLabel: "OpenAI API + web_search tool (not the ChatGPT app)",
  docsUrl: "https://developers.openai.com/api/docs/guides/tools-web-search",
  defaultModel: "gpt-5.4-mini",
  capabilities: { webSearch: true, locationControl: "approximate_user_location", reportsSearchExecuted: true, citationSpans: true },

  credentialStatus() {
    return apiKey() ? { state: "configured", detail: "OPENAI_API_KEY is set on the server" } : { state: "not_configured", detail: "Set OPENAI_API_KEY (server environment) to enable" };
  },

  async testConnection(model: string) {
    const t0 = Date.now();
    const key = apiKey();
    if (!key) return { ok: false, message: "Not configured: OPENAI_API_KEY is missing", latencyMs: 0 };
    try {
      const res = await timedFetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, { headers: { authorization: `Bearer ${key}` } }, 15000);
      const text = await res.text();
      if (!res.ok) return { ok: false, message: redact(`HTTP ${res.status}: ${text.slice(0, 300)}`), latencyMs: Date.now() - t0 };
      // Minimal billable call (no tools) so quota/billing problems show up here.
      const r = await timedFetch(
        API,
        { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ model, input: "ping", max_output_tokens: 16, store: false }) },
        30000,
      );
      const rt = await r.text();
      if (!r.ok) return { ok: false, message: httpError("OpenAI", r.status, rt, r.headers).message, latencyMs: Date.now() - t0 };
      return { ok: true, message: `Connected. Model ${model} available; a tiny test call succeeded (cost well under $0.001).`, latencyMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, message: redact(e instanceof Error ? e.message : "connection failed"), latencyMs: Date.now() - t0 };
    }
  },

  async collect(req: CollectionRequest, signal?: AbortSignal): Promise<CollectionResult> {
    const key = apiKey();
    if (!key) throw new ProviderCallError("auth_error", "OPENAI_API_KEY is not configured", false);
    const tool: Record<string, unknown> = { type: "web_search" };
    if (req.location) {
      const loc: Record<string, string> = { type: "approximate" };
      if (req.location.country) loc.country = req.location.country.toUpperCase();
      if (req.location.city) loc.city = req.location.city;
      if (req.location.region) loc.region = STATE_NAMES[req.location.region.toUpperCase()] ?? req.location.region;
      if (req.location.timezone) loc.timezone = req.location.timezone;
      tool.user_location = loc;
    }
    // Fresh, isolated request: single user input, no instructions, no history, not stored.
    const body = { model: req.model, input: req.prompt, tools: [tool], tool_choice: "auto", include: ["web_search_call.action.sources"], max_output_tokens: req.maxOutputTokens, store: false };
    const res = await timedFetch(API, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) }, req.timeoutMs, signal);
    const requestId = res.headers.get("x-request-id") ?? undefined;
    const text = await res.text();
    if (!res.ok) throw httpError("OpenAI", res.status, text, res.headers, requestId);
    let json: OAIResponse;
    try {
      json = JSON.parse(text) as OAIResponse;
    } catch {
      throw new ProviderCallError("parse_failure", `OpenAI returned non-JSON body: ${redact(text).slice(0, 200)}`, true, { requestId });
    }
    if (!Array.isArray(json.output)) throw new ProviderCallError("parse_failure", "OpenAI response had no output array", true, { requestId });
    if (json.status === "failed") throw new ProviderCallError("provider_error", `OpenAI response failed: ${json.error?.message ?? "unknown"}`, true, { requestId });

    const p = parseOpenAIOutput(json.output);
    const { raw, truncated } = serializeRaw(json);
    let status: CollectionResult["status"] = "success";
    let note: string | undefined;
    if (p.refusal && !p.answer) status = "refusal";
    else if (!p.answer.trim()) status = "no_ai_answer";
    else if (p.searchCalls > 0 && p.searchFailed === p.searchCalls) {
      status = "grounding_unavailable";
      note = "All web search calls failed; the answer was not grounded.";
    }
    if (json.status === "incomplete") note = `Response incomplete (${json.incomplete_details?.reason ?? "unknown"}); answer may be truncated.`;
    const reasoning = json.usage?.output_tokens_details?.reasoning_tokens ?? 0;
    return {
      status,
      answerText: p.answer,
      citations: p.citations,
      searchExecuted: p.searchCalls - p.searchFailed > 0,
      searchQueries: p.queries,
      searchResults: p.sources.slice(0, 60),
      usage: {
        inputTokens: Math.max(0, (json.usage?.input_tokens ?? 0) - (json.usage?.input_tokens_details?.cached_tokens ?? 0)),
        cacheReadTokens: json.usage?.input_tokens_details?.cached_tokens ?? 0,
        cacheWriteTokens: 0,
        outputTokens: json.usage?.output_tokens ?? 0,
        searchRequests: p.searchCalls,
      },
      requestId: requestId ?? json.id,
      model: json.model ?? req.model,
      apiVersion: "responses v1; tool web_search",
      stopReason: json.status,
      rawResponse: raw,
      rawResponseTruncated: truncated,
      appliedLocation: tool.user_location ? { control: "web_search.user_location (approximate)", ...(tool.user_location as Record<string, string>) } : undefined,
      searchConfig: { tool: "web_search", tool_choice: "auto", include_sources: true },
      generationSettings: { max_output_tokens: req.maxOutputTokens, reasoning: "model default", reasoning_tokens: reasoning, instructions: "none", store: false },
      note,
    };
  },
};
