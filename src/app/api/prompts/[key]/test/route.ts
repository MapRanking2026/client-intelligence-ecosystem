import { NextResponse } from "next/server";

import { getServerEnv } from "@/src/lib/server/env";
import {
  collectPromptVariables,
  composePromptText,
  getGlobalPreambleText,
  getPromptRecord,
  validatePromptDraft,
} from "@/src/lib/server/prompt-store";
import { callLlmForText, hasAnyLlmProvider } from "@/src/lib/server/services/mtos-ai";

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
  if (!hasAnyLlmProvider(env)) {
    return NextResponse.json(
      {
        issues,
        preview,
        detectedVariables,
        output: null,
        error: "No AI provider is configured (set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY).",
      },
      { status: 503 },
    );
  }

  try {
    // Runs through the same failover chain as production, so the test reflects
    // real runtime behavior. `preview` is the composed system prompt.
    const { text, provider, model } = await callLlmForText({
      env,
      system: preview,
      userText: sampleInput,
      maxTokens: 1400,
      temperature: 0.2,
    });
    return NextResponse.json({ issues, preview, detectedVariables, output: text, provider, model });
  } catch (error) {
    return NextResponse.json(
      {
        issues,
        preview,
        detectedVariables,
        output: null,
        error: error instanceof Error ? error.message : "LLM request failed",
      },
      { status: 502 },
    );
  }
}
