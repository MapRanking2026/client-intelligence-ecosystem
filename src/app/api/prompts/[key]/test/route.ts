import { NextResponse } from "next/server";

import { getServerEnv } from "@/src/lib/server/env";
import {
  collectPromptVariables,
  composePromptText,
  getGlobalPreambleText,
  getPromptRecord,
  validatePromptDraft,
} from "@/src/lib/server/prompt-store";

interface RouteContext {
  params: Promise<{ key: string }>;
}

interface TestRequestBody {
  /** Draft prompt text, so an operator can test before saving. */
  prompt?: string;
  runtimeContract?: string;
  title?: string;
  /** Sample input to run the prompt against. Omit to validate/preview only. */
  sampleInput?: string;
  /** Values for {{variables}} the calling module would normally supply. */
  variables?: Record<string, string>;
}

/**
 * Validate, preview, and optionally execute a prompt draft without saving it.
 * This is the "test before you ship" step of the Prompt Engine.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const { key } = await params;
  const body = (await request.json()) as TestRequestBody;

  const existing = await getPromptRecord(key);
  if (!existing) {
    return NextResponse.json({ error: `Prompt "${key}" not found` }, { status: 404 });
  }

  const draft = {
    title: body.title ?? existing.title,
    prompt: body.prompt ?? existing.prompt,
    runtimeContract: body.runtimeContract ?? existing.runtimeContract,
  };

  const variables = body.variables || {};
  const issues = validatePromptDraft(draft, Object.keys(variables));
  // Preview exactly what runtime sends: the saved Global System Preamble
  // (skipped when previewing the preamble itself) + this draft body + contract.
  const preamble = await getGlobalPreambleText();
  const preview = composePromptText({
    key,
    prompt: draft.prompt,
    runtimeContract: draft.runtimeContract,
    preamble,
    variables,
  });
  const detectedVariables = collectPromptVariables(
    `${draft.prompt}\n${draft.runtimeContract || ""}`,
  );

  const sampleInput = (body.sampleInput || "").trim();
  if (!sampleInput) {
    return NextResponse.json({ issues, preview, detectedVariables, output: null });
  }

  if (issues.some((issue) => issue.level === "error")) {
    return NextResponse.json(
      { issues, preview, detectedVariables, output: null, error: "Fix validation errors before running a test." },
      { status: 422 },
    );
  }

  const env = getServerEnv();
  if (!env.anthropicApiKey) {
    return NextResponse.json(
      { issues, preview, detectedVariables, output: null, error: "Claude is not configured (missing ANTHROPIC_API_KEY)." },
      { status: 503 },
    );
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
      max_tokens: 1400,
      temperature: 0.2,
      system: preview,
      messages: [{ role: "user", content: [{ type: "text", text: sampleInput }] }],
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    content?: Array<{ type?: string; text?: string }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    return NextResponse.json(
      {
        issues,
        preview,
        detectedVariables,
        output: null,
        error: payload.error?.message || `Claude request failed with status ${response.status}`,
      },
      { status: 502 },
    );
  }

  const output = (payload.content || [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text || "")
    .join("\n");

  return NextResponse.json({ issues, preview, detectedVariables, output });
}
