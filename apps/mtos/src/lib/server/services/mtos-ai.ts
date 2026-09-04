import type { getServerEnv } from "@/src/lib/server/env";

export function getNowIso() {
  return new Date().toISOString();
}

export function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)).filter((item) => item !== undefined) as T;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, nestedValue]) => nestedValue !== undefined)
      .map(([key, nestedValue]) => [key, stripUndefinedDeep(nestedValue)]);
    return Object.fromEntries(entries) as T;
  }

  return value;
}

export function extractJsonObject(value: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed) as Record<string, unknown>;
  }

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Claude response did not include a JSON object");
  }

  return JSON.parse(match[0]) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Multi-provider LLM layer
//
// Every AI workflow calls through here. The layer tries providers in order
// (Claude -> OpenAI -> Gemini by default) and returns the first success, so an
// outage, rate-limit, or token exhaustion on one provider fails over to the next
// instead of taking down every AI feature. All three are asked for a single JSON
// object; each caller still validates the result against its own zod schema.
// ---------------------------------------------------------------------------

export type LlmProvider = "claude" | "openai" | "gemini";

const ALL_PROVIDERS: LlmProvider[] = ["claude", "openai", "gemini"];

type ServerEnv = ReturnType<typeof getServerEnv>;

interface AdapterParams {
  system: string;
  userText: string;
  maxTokens: number;
  temperature: number;
  apiKey: string;
  model: string;
}

/** Resolve the API key + model for a provider, or null when it isn't configured. */
function providerConfig(env: ServerEnv, provider: LlmProvider): { apiKey: string; model: string } | null {
  switch (provider) {
    case "claude":
      return env.anthropicApiKey ? { apiKey: env.anthropicApiKey, model: env.anthropicModel } : null;
    case "openai":
      return env.openaiApiKey ? { apiKey: env.openaiApiKey, model: env.openaiModel } : null;
    case "gemini":
      return env.geminiApiKey ? { apiKey: env.geminiApiKey, model: env.geminiModel } : null;
  }
}

function isProvider(value: string): value is LlmProvider {
  return (ALL_PROVIDERS as string[]).includes(value);
}

/** Providers that have an API key configured, in the env-defined default order. */
export function configuredLlmProviders(env: ServerEnv): LlmProvider[] {
  const order = env.llmProviderOrder
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(isProvider);
  const ordered = order.length ? order : ALL_PROVIDERS;
  const seen = new Set<LlmProvider>();
  return ordered.filter((provider) => {
    if (seen.has(provider) || !providerConfig(env, provider)) {
      return false;
    }
    seen.add(provider);
    return true;
  });
}

export function hasAnyLlmProvider(env: ServerEnv): boolean {
  return configuredLlmProviders(env).length > 0;
}

/** Build the ordered chain to try: the preferred provider first, then the default order. */
function resolveChain(env: ServerEnv, preferred?: LlmProvider): LlmProvider[] {
  const configured = configuredLlmProviders(env);
  if (preferred && configured.includes(preferred)) {
    return [preferred, ...configured.filter((provider) => provider !== preferred)];
  }
  return configured;
}

async function callAnthropic(params: AdapterParams): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.maxTokens,
      temperature: params.temperature,
      system: params.system,
      messages: [{ role: "user", content: [{ type: "text", text: params.userText }] }],
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    content?: Array<{ type?: string; text?: string }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message || `Claude request failed with status ${response.status}`);
  }
  return (payload.content || [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text || "")
    .join("\n");
}

async function callOpenAI(params: AdapterParams): Promise<string> {
  // Newer OpenAI models (gpt-5 / o-series and later) renamed `max_tokens` to
  // `max_completion_tokens` and only accept the default temperature. Build the
  // body accordingly, and if the API still rejects a param, retry without the
  // optional ones so a model swap never silently breaks failover.
  const postOpenAI = async (body: Record<string, unknown>) => {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string; param?: string };
    };
    return { response, payload };
  };

  const baseBody: Record<string, unknown> = {
    model: params.model,
    max_completion_tokens: params.maxTokens,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.userText },
    ],
  };

  // Attempt 1: include temperature (most models honor it).
  let { response, payload } = await postOpenAI({ ...baseBody, temperature: params.temperature });

  // Attempt 2: if the model rejects temperature (reasoning models only allow the
  // default), retry without it rather than failing the whole provider.
  if (!response.ok && /temperature/i.test(payload.error?.message || "")) {
    ({ response, payload } = await postOpenAI(baseBody));
  }

  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenAI request failed with status ${response.status}`);
  }
  return payload.choices?.[0]?.message?.content || "";
}

async function callGemini(params: AdapterParams): Promise<string> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    params.model,
  )}:generateContent?key=${encodeURIComponent(params.apiKey)}`;

  const attempt = async () => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: params.system }] },
        contents: [{ role: "user", parts: [{ text: params.userText }] }],
        generationConfig: {
          temperature: params.temperature,
          maxOutputTokens: params.maxTokens,
          responseMimeType: "application/json",
        },
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message?: string };
    };
    return { response, payload };
  };

  let { response, payload } = await attempt();
  // Gemini frequently returns a transient 503 ("high demand"); retry once after a
  // short backoff before giving up on the provider.
  if (response.status === 503 || response.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    ({ response, payload } = await attempt());
  }
  if (!response.ok) {
    throw new Error(payload.error?.message || `Gemini request failed with status ${response.status}`);
  }
  return (payload.candidates?.[0]?.content?.parts || []).map((part) => part.text || "").join("");
}

const ADAPTERS: Record<LlmProvider, (params: AdapterParams) => Promise<string>> = {
  claude: callAnthropic,
  openai: callOpenAI,
  gemini: callGemini,
};

interface CallLlmForJsonParams {
  env: ServerEnv;
  system: string;
  userText: string;
  maxTokens?: number;
  temperature?: number;
  /** Move this provider to the front of the failover chain (e.g. a prompt's own provider). */
  preferredProvider?: LlmProvider;
}

export interface LlmJsonResult {
  data: Record<string, unknown>;
  /** Which provider actually answered. */
  provider: LlmProvider;
  /** The model that answered. */
  model: string;
}

/**
 * Shared failover loop. Tries each configured provider in order, applies
 * `transform` to the raw text, and returns the first success with which
 * provider/model answered. A transform that throws (e.g. JSON parse failure)
 * is treated like a provider error and fails over to the next provider. Throws
 * only when every provider fails or none is configured.
 */
async function callLlmCore<T>(
  params: CallLlmForJsonParams,
  transform: (text: string) => T,
): Promise<{ data: T; provider: LlmProvider; model: string }> {
  const { env, system, userText, maxTokens = 1400, temperature = 0.2, preferredProvider } = params;

  const chain = resolveChain(env, preferredProvider);
  if (!chain.length) {
    throw new Error(
      "No LLM provider is configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY.",
    );
  }

  const errors: string[] = [];
  for (const provider of chain) {
    const config = providerConfig(env, provider);
    if (!config) {
      continue;
    }
    try {
      const text = await ADAPTERS[provider]({
        system,
        userText,
        maxTokens,
        temperature,
        apiKey: config.apiKey,
        model: config.model,
      });
      return { data: transform(text), provider, model: config.model };
    } catch (error) {
      errors.push(`${provider}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  throw new Error(`All configured LLM providers failed — ${errors.join("; ")}`);
}

/**
 * Provider-agnostic JSON completion with automatic failover. Returns the parsed
 * object plus which provider/model answered. Callers validate `data` against
 * their own zod schema.
 */
export async function callLlmForJson(params: CallLlmForJsonParams): Promise<LlmJsonResult> {
  return callLlmCore(params, extractJsonObject);
}

/** Provider-agnostic raw-text completion with the same failover behavior. */
export async function callLlmForText(
  params: CallLlmForJsonParams,
): Promise<{ text: string; provider: LlmProvider; model: string }> {
  const { data, provider, model } = await callLlmCore(params, (text) => text);
  return { text: data, provider, model };
}

interface CallClaudeForJsonParams {
  env: ServerEnv;
  system: string;
  userText: string;
  maxTokens?: number;
  temperature?: number;
  preferredProvider?: LlmProvider;
}

/**
 * Backward-compatible wrapper: returns just the JSON object. New code should
 * prefer callLlmForJson so it can record which provider answered. Despite the
 * name, this now fails over across all configured providers, not only Claude.
 */
export async function callClaudeForJson(params: CallClaudeForJsonParams): Promise<Record<string, unknown>> {
  const { data } = await callLlmForJson(params);
  return data;
}

// ---------------------------------------------------------------------------
// Embeddings (for the knowledge base / RAG)
//
// Claude has no embeddings API, so only OpenAI and Gemini are eligible. Every
// stored chunk records which provider+model produced its vector, because vectors
// are only comparable within the same model — retrieval must embed the query
// with the same provider the chunks used.
// ---------------------------------------------------------------------------

export type EmbeddingProvider = "openai" | "gemini";

const EMBEDDING_PROVIDERS: EmbeddingProvider[] = ["openai", "gemini"];

function embeddingProviderConfig(
  env: ServerEnv,
  provider: EmbeddingProvider,
): { apiKey: string; model: string } | null {
  switch (provider) {
    case "openai":
      return env.openaiApiKey ? { apiKey: env.openaiApiKey, model: env.openaiEmbeddingModel } : null;
    case "gemini":
      return env.geminiApiKey ? { apiKey: env.geminiApiKey, model: env.geminiEmbeddingModel } : null;
  }
}

/** Embedding providers with a key, in the env-defined order. */
export function configuredEmbeddingProviders(env: ServerEnv): EmbeddingProvider[] {
  const order = env.embeddingProviderOrder
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is EmbeddingProvider => (EMBEDDING_PROVIDERS as string[]).includes(entry));
  const ordered = order.length ? order : EMBEDDING_PROVIDERS;
  const seen = new Set<EmbeddingProvider>();
  return ordered.filter((provider) => {
    if (seen.has(provider) || !embeddingProviderConfig(env, provider)) {
      return false;
    }
    seen.add(provider);
    return true;
  });
}

export function hasEmbeddingProvider(env: ServerEnv): boolean {
  return configuredEmbeddingProviders(env).length > 0;
}

async function embedOpenAI(apiKey: string, model: string, text: string): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input: text }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    data?: Array<{ embedding?: number[] }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenAI embeddings failed with status ${response.status}`);
  }
  const vector = payload.data?.[0]?.embedding;
  if (!Array.isArray(vector)) {
    throw new Error("OpenAI embeddings returned no vector");
  }
  return vector;
}

async function embedGemini(apiKey: string, model: string, text: string): Promise<number[]> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:embedContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: { parts: [{ text }] } }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    embedding?: { values?: number[] };
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message || `Gemini embeddings failed with status ${response.status}`);
  }
  const vector = payload.embedding?.values;
  if (!Array.isArray(vector)) {
    throw new Error("Gemini embeddings returned no vector");
  }
  return vector;
}

export interface EmbeddingResult {
  embedding: number[];
  provider: EmbeddingProvider;
  model: string;
}

/**
 * Embed a single text with failover across configured embedding providers.
 * `preferredProvider` (e.g. the provider a stored chunk set was built with) is
 * tried first so a query is embedded by the same model as the chunks.
 */
export async function embedText(
  env: ServerEnv,
  text: string,
  options: { preferredProvider?: EmbeddingProvider } = {},
): Promise<EmbeddingResult> {
  const configured = configuredEmbeddingProviders(env);
  const chain =
    options.preferredProvider && configured.includes(options.preferredProvider)
      ? [options.preferredProvider, ...configured.filter((provider) => provider !== options.preferredProvider)]
      : configured;

  if (!chain.length) {
    throw new Error("No embedding provider is configured. Set OPENAI_API_KEY or GEMINI_API_KEY.");
  }

  const errors: string[] = [];
  for (const provider of chain) {
    const config = embeddingProviderConfig(env, provider);
    if (!config) {
      continue;
    }
    try {
      const embedding =
        provider === "openai"
          ? await embedOpenAI(config.apiKey, config.model, text)
          : await embedGemini(config.apiKey, config.model, text);
      return { embedding, provider, model: config.model };
    } catch (error) {
      errors.push(`${provider}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  throw new Error(`All configured embedding providers failed — ${errors.join("; ")}`);
}

/** Cosine similarity between two equal-length vectors; 0 when incomparable. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
