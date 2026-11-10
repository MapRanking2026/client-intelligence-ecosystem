import { NextResponse } from "next/server";

import { requirePromptEngineAdmin } from "@/src/lib/server/prompt-engine-guard";
import { getPrompts, savePrompts, type PromptConfig } from "@/src/lib/server/prompt-store";

/**
 * Never cached, in either direction.
 *
 * Every prompt here is the live instruction a workflow runs on the next request, so a cached GET
 * would show an operator a library that is no longer the one in force -- and a `force-static` GET,
 * which Next can choose on its own once Cache Components is enabled, would serve a build-time copy
 * of another tenant's library. The admin gate reads the session cookie, which marks the route
 * dynamic anyway; this makes it explicit rather than incidental.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const gate = await requirePromptEngineAdmin(request);
  if (!gate.ok) return gate.response;

  const prompts = await getPrompts();
  return NextResponse.json(prompts);
}

export async function POST(request: Request) {
  const gate = await requirePromptEngineAdmin(request);
  if (!gate.ok) return gate.response;

  const body = (await request.json()) as PromptConfig;
  await savePrompts(body);
  return NextResponse.json({ ok: true });
}
