import { getServerEnv } from "@/src/lib/server/env";

/** Thrown when no LLM provider key is configured — never fabricate output. */
export class AiNotConfiguredError extends Error {
  constructor() {
    super("AI is not configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY on SEOOS.");
    this.name = "AiNotConfiguredError";
  }
}

async function callAnthropic(system: string, user: string): Promise<string> {
  const env = getServerEnv();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.anthropicApiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.anthropicModel,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`anthropic_http_${res.status}: ${detail.slice(0, 300)}`);
  }
  const body = (await res.json()) as { content?: Array<{ text?: string }> };
  return body.content?.map((c) => c.text ?? "").join("") ?? "";
}

async function callOpenAI(system: string, user: string): Promise<string> {
  const env = getServerEnv();
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.openaiApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.openaiModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`openai_http_${res.status}: ${detail.slice(0, 300)}`);
  }
  const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return body.choices?.[0]?.message?.content ?? "";
}

async function callGemini(system: string, user: string): Promise<string> {
  const env = getServerEnv();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`gemini_http_${res.status}: ${detail.slice(0, 300)}`);
  }
  const body = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
}

/**
 * Generate raw text, trying providers in order: Claude → ChatGPT → Gemini.
 * Falls through to the next when a provider is unconfigured OR its call fails
 * (e.g. out of credits, rate limited). Throws only when every configured
 * provider fails, or none is configured.
 */
export async function generateText(system: string, user: string): Promise<string> {
  const env = getServerEnv();
  const chain: Array<{ name: string; key: string; call: () => Promise<string> }> = [
    { name: "claude", key: env.anthropicApiKey, call: () => callAnthropic(system, user) },
    { name: "openai", key: env.openaiApiKey, call: () => callOpenAI(system, user) },
    { name: "gemini", key: env.geminiApiKey, call: () => callGemini(system, user) },
  ];
  const configured = chain.filter((p) => p.key);
  if (!configured.length) throw new AiNotConfiguredError();

  const errors: string[] = [];
  for (const provider of configured) {
    try {
      const text = await provider.call();
      if (text.trim()) return text;
      errors.push(`${provider.name}: empty response`);
    } catch (e) {
      errors.push(`${provider.name}: ${e instanceof Error ? e.message : "error"}`);
    }
  }
  throw new Error(`All AI providers failed — ${errors.join(" | ")}`);
}

/** Extract a JSON value from an LLM response, tolerating ```json fences and prose. */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate) as T;
  } catch {
    // Fall back to the first {...} or [...] block.
    const block = candidate.match(/[[{][\s\S]*[\]}]/);
    if (block) return JSON.parse(block[0]) as T;
    throw new Error("ai_response_not_json");
  }
}
