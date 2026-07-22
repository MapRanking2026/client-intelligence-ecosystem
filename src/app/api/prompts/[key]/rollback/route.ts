import { NextResponse } from "next/server";

import { rollbackPrompt } from "@/src/lib/server/prompt-store";

interface RouteContext {
  params: Promise<{ key: string }>;
}

export async function POST(request: Request, { params }: RouteContext) {
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
