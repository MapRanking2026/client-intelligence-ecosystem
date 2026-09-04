import { NextResponse } from "next/server";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { addSectionNote, deleteSectionNote, listSectionNotes } from "@/src/lib/server/services/section-notes-service";

export async function GET(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const context = await resolveTenantContext(request);
  const { clientId } = await params;
  const section = new URL(request.url).searchParams.get("section") || undefined;
  try {
    const notes = await listSectionNotes(context, clientId, section);
    return NextResponse.json({ data: notes });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Couldn't load notes" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const context = await resolveTenantContext(request);
  const { clientId } = await params;
  const body = (await request.json().catch(() => ({}))) as { sectionKey?: string; text?: string };
  try {
    const note = await addSectionNote(context, clientId, { sectionKey: body.sectionKey || "general", text: body.text || "" });
    return NextResponse.json({ data: note });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Couldn't save note" }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const context = await resolveTenantContext(request);
  const { clientId } = await params;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing note id" }, { status: 400 });
  await deleteSectionNote(context, clientId, id);
  return NextResponse.json({ ok: true });
}
