import { NextResponse } from "next/server";

import { requirePromptEngineAdmin } from "@/src/lib/server/prompt-engine-guard";
import {
  getPromptRecord,
  savePromptRecord,
  validatePromptDraft,
  type PromptPatch,
} from "@/src/lib/server/prompt-store";

interface RouteContext {
  params: Promise<{ key: string }>;
}

/** Never cached. See the note on `src/app/api/prompts/route.ts`. */
export const dynamic = "force-dynamic";

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

export async function GET(request: Request, { params }: RouteContext) {
  const gate = await requirePromptEngineAdmin(request);
  if (!gate.ok) return gate.response;

  const { key } = await params;
  const record = await getPromptRecord(key);

  if (!record) {
    return NextResponse.json({ error: `Prompt "${key}" not found` }, { status: 404 });
  }

  return NextResponse.json(record);
}

/** Save one prompt without touching the rest of the library. */
export async function PATCH(request: Request, { params }: RouteContext) {
  const gate = await requirePromptEngineAdmin(request);
  if (!gate.ok) return gate.response;

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
