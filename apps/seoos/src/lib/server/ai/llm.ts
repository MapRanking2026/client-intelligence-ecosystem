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

/** Generate raw text from the first configured provider (Anthropic preferred). */
export async function generateText(system: string, user: string): Promise<string> {
  const env = getServerEnv();
  if (env.anthropicApiKey) return callAnthropic(system, user);
  if (env.openaiApiKey) return callOpenAI(system, user);
  throw new AiNotConfiguredError();
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
