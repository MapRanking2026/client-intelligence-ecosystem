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

interface CallClaudeForJsonParams {
  env: ReturnType<typeof getServerEnv>;
  system: string;
  userText: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Shared Claude JSON-completion helper for the Growth Pilot AI service layer.
 * Every caller is responsible for validating the returned object against its
 * own zod schema -- this only handles the transport and text extraction.
 */
export async function callClaudeForJson(params: CallClaudeForJsonParams): Promise<Record<string, unknown>> {
  const { env, system, userText, maxTokens = 1400, temperature = 0.2 } = params;

  if (!env.anthropicApiKey) {
    throw new Error("Claude is not configured (missing ANTHROPIC_API_KEY)");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: env.anthropicModel,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: userText }],
        },
      ],
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    content?: Array<{ type?: string; text?: string }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.message || `Claude request failed with status ${response.status}`);
  }

  const text = (payload.content || [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text || "")
    .join("\n");

  return extractJsonObject(text);
}
