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
 * Anthropic Messages API + server-side web search tool.
 * Docs (verified 2026-10-19):
 *  - https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool
 *    tool type `web_search_20250305`, params max_uses / user_location
 *    ({type:"approximate", city, region, country(ISO-2), timezone}); response
 *    blocks `server_tool_use`, `web_search_tool_result` (or
 *    `web_search_tool_result_error` with error_code), text blocks with
 *    `web_search_result_location` citations; usage.server_tool_use.web_search_requests;
 *    stop_reason `pause_turn` must be continued by resending the assistant turn.
 *
 * Observations are labelled "Anthropic API (Claude) + web search" — they are
 * NOT results from the claude.ai consumer app.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const TOOL_TYPE = "web_search_20250305";
const MAX_CONTINUATIONS = 3;

function apiKey(): string {
  return process.env.AIV_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || "";
}

interface AnthropicBlock {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  input?: { query?: string };
  citations?: Array<{ type: string; url?: string; title?: string; cited_text?: string }>;
  content?: unknown;
}

interface AnthropicResponse {
  id?: string;
  model?: string;
  stop_reason?: string;
  content?: AnthropicBlock[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    server_tool_use?: { web_search_requests?: number };
  };
}

function toolDef(req: CollectionRequest) {
  const tool: Record<string, unknown> = { type: TOOL_TYPE, name: "web_search", max_uses: req.maxSearchUses };
  if (req.location && (req.location.city || req.location.region || req.location.country || req.location.timezone)) {
    const loc: Record<string, string> = { type: "approximate" };
    if (req.location.city) loc.city = req.location.city;
    if (req.location.region) loc.region = STATE_NAMES[req.location.region.toUpperCase()] ?? req.location.region;
    if (req.location.country) loc.country = req.location.country.toUpperCase();
    if (req.location.timezone) loc.timezone = req.location.timezone;
    tool.user_location = loc;
  }
  return tool;
}

async function post(body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<{ json: AnthropicResponse; requestId?: string }> {
  const key = apiKey();
  if (!key) throw new ProviderCallError("auth_error", "ANTHROPIC_API_KEY is not configured", false);
  const res = await timedFetch(
    API_URL,
    {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": API_VERSION, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    timeoutMs,
    signal,
  );
  const requestId = res.headers.get("request-id") ?? undefined;
  const text = await res.text();
  if (!res.ok) throw httpError("Anthropic", res.status, text, res.headers, requestId);
  try {
    return { json: JSON.parse(text) as AnthropicResponse, requestId };
  } catch {
    throw new ProviderCallError("parse_failure", `Anthropic returned non-JSON body: ${redact(text).slice(0, 200)}`, true, { requestId });
  }
}

/** Parse a (possibly continued) message into a normalized result. Exported for fixture tests. */
export function parseAnthropicContent(content: AnthropicBlock[]) {
  const queries: string[] = [];
  const results: Array<{ url: string; title?: string; pageAge?: string }> = [];
  const searchErrors: string[] = [];
  let lastToolIdx = -1;
  let searchOk = 0;
  content.forEach((b, i) => {
    if (b.type === "server_tool_use" && b.name === "web_search") {
      if (b.input?.query) queries.push(b.input.query);
      lastToolIdx = i;
    }
    if (b.type === "web_search_tool_result") {
      lastToolIdx = i;
      if (Array.isArray(b.content)) {
        searchOk += 1;
        for (const r of b.content as Array<{ type?: string; url?: string; title?: string; page_age?: string }>) {
          if (r?.type === "web_search_result" && r.url) results.push({ url: r.url, title: r.title, pageAge: r.page_age ?? undefined });
        }
      } else if (b.content && typeof b.content === "object") {
        searchErrors.push(String((b.content as { error_code?: string }).error_code ?? "unknown_error"));
      }
    }
  });
  // Final answer = text after the last search step (pre-search narration excluded).
  let answer = "";
  const citationItems: Array<{ url: string; title?: string; citedText?: string; span?: { start: number; end: number } }> = [];
  content.forEach((b, i) => {
    if (b.type !== "text" || typeof b.text !== "string") return;
    if (lastToolIdx >= 0 && i < lastToolIdx) return;
    const start = answer.length;
    answer += b.text;
    for (const c of b.citations ?? []) {
      if (c.type === "web_search_result_location" && c.url) {
        citationItems.push({ url: c.url, title: c.title, citedText: c.cited_text, span: { start, end: answer.length } });
      }
    }
  });
  return { answer: answer.trim() ? answer : "", citations: mergeCitations(citationItems), queries, results, searchErrors, searchOk, searchAttempted: queries.length > 0 || searchOk > 0 || searchErrors.length > 0 };
}

export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
  displayName: "Anthropic (Claude API)",
  surfaceLabel: "Anthropic API (Claude) + web search tool",
  docsUrl: "https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool",
  defaultModel: "claude-sonnet-5-5",
  capabilities: { webSearch: true, locationControl: "approximate_user_location", reportsSearchExecuted: true, citationSpans: true },

  credentialStatus() {
    return apiKey()
      ? { state: "configured", detail: "ANTHROPIC_API_KEY is set on the server" }
      : { state: "not_configured", detail: "Set ANTHROPIC_API_KEY (server environment) to enable" };
  },

  async testConnection(model: string) {
    const t0 = Date.now();
    try {
      const key = apiKey();
      if (!key) return { ok: false, message: "Not configured: ANTHROPIC_API_KEY is missing", latencyMs: 0 };
      const res = await timedFetch(
        `https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`,
        { headers: { "x-api-key": key, "anthropic-version": API_VERSION } },
        15000,
      );
      const text = await res.text();
      if (!res.ok) return { ok: false, message: redact(`HTTP ${res.status}: ${text.slice(0, 300)}`), latencyMs: Date.now() - t0 };
      const info = JSON.parse(text) as { id?: string; capabilities?: { server_tools?: { web_search?: { supported?: boolean } } } };
      const ws = info.capabilities?.server_tools?.web_search?.supported;
      if (ws === false) return { ok: false, message: `Model ${info.id} does not support the web search tool`, latencyMs: Date.now() - t0 };
      // Minimal billable check (1 output token, no tools) so billing/credit problems surface here, not mid-scan.
      try {
        await post({ model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }, 20000);
      } catch (e) {
        return { ok: false, message: redact(e instanceof Error ? e.message : "test call failed"), latencyMs: Date.now() - t0 };
      }
      return {
        ok: true,
        message: `Connected. Model ${info.id ?? model} available${ws ? " with web search" : ""}. A 1-token test call succeeded (cost well under $0.001).`,
        latencyMs: Date.now() - t0,
      };
    } catch (e) {
      return { ok: false, message: redact(e instanceof Error ? e.message : "connection failed"), latencyMs: Date.now() - t0 };
    }
  },

  async collect(req: CollectionRequest, signal?: AbortSignal): Promise<CollectionResult> {
    const tool = toolDef(req);
    // Fresh, isolated request: a single user turn, no system prompt, no history.
    const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [{ role: "user", content: req.prompt }];
    const body = { model: req.model, max_tokens: req.maxOutputTokens, messages, tools: [tool] };
    const deadline = Date.now() + req.timeoutMs;

    let { json, requestId } = await post(body, req.timeoutMs, signal);
    const allContent: AnthropicBlock[] = [...(json.content ?? [])];
    const usage = { inputTokens: 0, outputTokens: 0, searchRequests: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const addUsage = (r: AnthropicResponse) => {
      usage.inputTokens += r.usage?.input_tokens ?? 0;
      usage.outputTokens += r.usage?.output_tokens ?? 0;
      usage.cacheReadTokens += r.usage?.cache_read_input_tokens ?? 0;
      usage.cacheWriteTokens += r.usage?.cache_creation_input_tokens ?? 0;
      usage.searchRequests += r.usage?.server_tool_use?.web_search_requests ?? 0;
    };
    addUsage(json);
    const raws: unknown[] = [json];
    let continuations = 0;
    while (json.stop_reason === "pause_turn" && continuations < MAX_CONTINUATIONS) {
      continuations += 1;
      const remaining = deadline - Date.now();
      if (remaining < 3000) break;
      const cont = { ...body, messages: [{ role: "user", content: req.prompt }, { role: "assistant", content: allContent }] };
      ({ json, requestId } = await post(cont, remaining, signal));
      addUsage(json);
      raws.push(json);
      allContent.push(...(json.content ?? []));
    }

    if (!Array.isArray(json.content)) {
      throw new ProviderCallError("parse_failure", "Anthropic response had no content array", true, { requestId });
    }
    const parsed = parseAnthropicContent(allContent);
    const { raw, truncated } = serializeRaw(raws.length === 1 ? raws[0] : raws, ["encrypted_content", "encrypted_index"]);

    let status: CollectionResult["status"] = "success";
    let note: string | undefined;
    if (json.stop_reason === "refusal") status = "refusal";
    else if (!parsed.answer.trim()) status = "no_ai_answer";
    else if (parsed.searchAttempted && parsed.searchOk === 0 && parsed.searchErrors.length) {
      status = "grounding_unavailable";
      note = `All web searches failed (${parsed.searchErrors.join(", ")}); answer was not grounded.`;
    }
    if (json.stop_reason === "pause_turn") note = "Stopped after maximum pause_turn continuations; answer may be incomplete.";
    if (json.stop_reason === "max_tokens") note = "Answer truncated at max_tokens.";

    return {
      status,
      answerText: parsed.answer,
      citations: parsed.citations,
      searchExecuted: parsed.searchOk > 0,
      searchQueries: parsed.queries,
      searchResults: parsed.results.slice(0, 60),
      usage,
      requestId,
      model: json.model ?? req.model,
      apiVersion: `${API_VERSION}; tool ${TOOL_TYPE}`,
      stopReason: json.stop_reason,
      rawResponse: raw,
      rawResponseTruncated: truncated,
      appliedLocation: tool.user_location
        ? { control: "web_search.user_location (approximate)", ...(tool.user_location as Record<string, string>) }
        : undefined,
      searchConfig: { tool: TOOL_TYPE, max_uses: req.maxSearchUses, search_errors: parsed.searchErrors.join(",") },
      generationSettings: { max_tokens: req.maxOutputTokens, temperature: "provider default", system_prompt: "none", continuations },
      note,
    };
  },
};
