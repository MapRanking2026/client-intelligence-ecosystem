import { NextResponse } from "next/server";

import {
  getPromptRecord,
  savePromptRecord,
  validatePromptDraft,
  type PromptPatch,
} from "@/src/lib/server/prompt-store";

interface RouteContext {
  params: Promise<{ key: string }>;
}

const EDITABLE_FIELDS = [
  "title",
  "role",
  "prompt",
  "description",
  "provider",
  "difficulty",
  "runtimeContract",
  "workflows",
] as const;

function pickPatch(body: Record<string, unknown>): PromptPatch {
  const patch: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) {
      patch[field] = body[field];
    }
  }
  return patch as PromptPatch;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { key } = await params;
  const record = await getPromptRecord(key);

  if (!record) {
    return NextResponse.json({ error: `Prompt "${key}" not found` }, { status: 404 });
  }

  return NextResponse.json(record);
}

/** Save one prompt without touching the rest of the library. */
export async function PATCH(request: Request, { params }: RouteContext) {
  const { key } = await params;
  const body = (await request.json()) as Record<string, unknown>;
  const patch = pickPatch(body);

  const existing = await getPromptRecord(key);
  if (!existing) {
    return NextResponse.json({ error: `Prompt "${key}" not found` }, { status: 404 });
  }

  const issues = validatePromptDraft({
    title: patch.title ?? existing.title,
    prompt: patch.prompt ?? existing.prompt,
    runtimeContract: patch.runtimeContract ?? existing.runtimeContract,
  });

  if (issues.some((issue) => issue.level === "error")) {
    return NextResponse.json({ error: "Prompt failed validation", issues }, { status: 422 });
  }

  const note = typeof body.note === "string" ? body.note : undefined;
  const saved = await savePromptRecord(key, patch, note);

  return NextResponse.json({ prompt: saved, issues });
}
