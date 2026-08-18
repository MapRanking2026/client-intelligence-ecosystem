import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import {
  addClientAttachment,
  deleteClientAttachment,
  listClientAttachments,
} from "@/src/lib/server/services/client-attachments-service";

const addSchema = z
  .object({
    kind: z.enum(["image", "file", "note"]),
    name: z.string().min(1).max(240),
    mimeType: z.string().max(160).optional(),
    size: z.number().nonnegative().optional(),
    dataUrl: z.string().max(1_400_000).optional(),
    text: z.string().max(50_000).optional(),
  })
  .refine((v) => (v.kind === "note" ? Boolean(v.text?.trim()) : Boolean(v.dataUrl)), {
    message: "Missing attachment content.",
  });

export async function GET(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const context = await resolveTenantContext(request);
  const { clientId } = await params;
  try {
    const attachments = await listClientAttachments(context, clientId);
    return NextResponse.json({ data: attachments });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load attachments" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const context = await resolveTenantContext(request);
  const { clientId } = await params;
  try {
    const payload = addSchema.parse(await request.json());
    const attachment = await addClientAttachment(context, clientId, payload);
    return NextResponse.json({ data: attachment });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save attachment" },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ clientId: string }> }) {
  const context = await resolveTenantContext(request);
  const { clientId } = await params;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing attachment id" }, { status: 400 });
  }
  try {
    await deleteClientAttachment(context, clientId, id);
    return NextResponse.json({ data: { deleted: id } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete attachment" },
      { status: 500 },
    );
  }
}
