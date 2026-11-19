import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { bookNextMonthlyTouch, readNextTouchAvailability } from "@/src/lib/server/services/next-touch-booking-service";

export const maxDuration = 120;
const schema = z.object({ action: z.enum(["book", "update"]), scheduledAt: z.iso.datetime(), durationMinutes: z.number().int().min(15).max(240), title: z.string().trim().min(1).max(240), attendees: z.array(z.email()).min(1).max(20), description: z.string().max(5000), confirmed: z.literal(true) });
export async function GET(request: Request, { params }: { params: Promise<{ touchId: string }> }) {
  const context = await resolveTenantContext(request);
  if (context.userId === "unknown") return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const duration = z.coerce.number().int().min(15).max(240).parse(new URL(request.url).searchParams.get("durationMinutes") || 60);
    return NextResponse.json({ data: await readNextTouchAvailability(context, (await params).touchId, duration) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Calendar availability could not be loaded." }, { status: 400 }); }
}
export async function POST(request: Request, { params }: { params: Promise<{ touchId: string }> }) {
  const context = await resolveTenantContext(request);
  if (context.userId === "unknown") return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  try { return NextResponse.json({ data: await bookNextMonthlyTouch(context, (await params).touchId, schema.parse(await request.json())) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "The meeting could not be booked." }, { status: 400 }); }
}
