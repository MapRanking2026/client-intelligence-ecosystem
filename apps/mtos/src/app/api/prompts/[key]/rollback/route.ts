import { NextResponse } from "next/server";

import { requirePromptEngineAdmin } from "@/src/lib/server/prompt-engine-guard";
import { rollbackPrompt } from "@/src/lib/server/prompt-store";

interface RouteContext {
  params: Promise<{ key: string }>;
}

/** Never cached. See the note on `src/app/api/prompts/route.ts`. */
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: RouteContext) {
  const gate = await requirePromptEngineAdmin(request);
  if (!gate.ok) return gate.response;

  const { key } = await params;
  const body = (await request.json()) as { version?: unknown };
  const version = Number(body.version);

  if (!Number.isInteger(version) || version < 1) {
    return NextResponse.json({ error: "A positive integer `version` is required" }, { status: 400 });
  }

  try {
    const restored = await rollbackPrompt(key, version);
    return NextResponse.json({ prompt: restored });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rollback failed";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
