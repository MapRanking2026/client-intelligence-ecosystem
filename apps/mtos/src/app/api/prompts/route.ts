import { NextResponse } from "next/server";
import { getPrompts, savePrompts, type PromptConfig } from "@/src/lib/server/prompt-store";

export async function GET() {
  const prompts = await getPrompts();
  return NextResponse.json(prompts);
}

export async function POST(request: Request) {
  const body = (await request.json()) as PromptConfig;
  await savePrompts(body);
  return NextResponse.json({ ok: true });
}
