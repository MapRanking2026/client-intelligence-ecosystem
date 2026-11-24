import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import {
  addPresentationMedia,
  describePresentationMedia,
  listPresentationMedia,
  loadPresentationMedia,
  removePresentationMedia,
} from "@/src/lib/server/services/presentation-media-service";

/**
 * The uploads behind a deck's exhibit slides: list them, add one, describe one, remove one, and
 * serve the bytes back for the viewer and the thumbnails.
 *
 * `GET ?image=<id>` returns the image itself, private and no-store, like the rank captures.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const mediaId = z.string().regex(/^[a-f0-9]{64}$/);

const action = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    name: z.string().min(1).max(200),
    // ~8MB of base64 is the service's ceiling; rejecting a larger body here keeps it off the
    // function's memory rather than finding out after it has been parsed.
    dataUrl: z.string().min(32).max(8_200_000),
    width: z.number().int().min(1).max(20000),
    height: z.number().int().min(1).max(20000),
    note: z.string().max(1000).optional(),
    sourceName: z.string().max(200).optional(),
    page: z.number().int().min(1).max(2000).optional(),
  }),
  z.object({ action: z.literal("describe"), id: mediaId, note: z.string().max(1000) }),
  z.object({ action: z.literal("remove"), id: mediaId }),
]);

export async function GET(request: Request, { params }: { params: Promise<{ touchId: string }> }) {
  const context = await resolveTenantContext(request);
  if (context.userId === "unknown") return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { touchId } = await params;
    const query = new URL(request.url).searchParams;
    if (query.has("image")) {
      const image = await loadPresentationMedia(context, touchId, mediaId.parse(query.get("image")));
      return new NextResponse(new Uint8Array(image.bytes), {
        headers: { "content-type": image.mimeType, "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
      });
    }
    return NextResponse.json({ data: await listPresentationMedia(context, touchId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The uploads could not be read." }, { status: 400 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ touchId: string }> }) {
  const context = await resolveTenantContext(request);
  if (context.userId === "unknown") return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const { touchId } = await params;
    const input = action.parse(await request.json());
    if (input.action === "add") {
      await addPresentationMedia(context, touchId, input);
      return NextResponse.json({ data: await listPresentationMedia(context, touchId) });
    }
    const data = input.action === "describe"
      ? await describePresentationMedia(context, touchId, input.id, input.note)
      : await removePresentationMedia(context, touchId, input.id);
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The upload could not be saved." }, { status: 400 });
  }
}
