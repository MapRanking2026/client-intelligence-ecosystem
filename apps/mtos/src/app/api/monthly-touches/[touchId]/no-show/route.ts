import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { runNoShowAction } from "@/src/lib/server/services/no-show-service";
import { readRescheduleAvailability } from "@/src/lib/server/services/google-meet-service";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";

export const maxDuration = 300;
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("select"), resolution: z.enum(["reschedule", "loom"]) }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("generate") }),
  z.object({ action: z.literal("save"), script: z.string().max(150000), url: z.string().max(2048), subject: z.string().max(998).optional(), html: z.string().max(150000).optional() }),
  z.object({ action: z.literal("email") }),
  z.object({ action: z.literal("reconcile") }),
  z.object({ action: z.literal("send"), approved: z.literal(true) }),
  z.object({ action: z.literal("reschedule"), scheduledAt: z.iso.datetime(), confirmed: z.literal(true) }),
]);
export async function GET(request: Request, { params }: { params: Promise<{ touchId: string }> }) {
  const context = await resolveTenantContext(request);
  if (context.userId === "unknown") return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try { return NextResponse.json({ data: await readRescheduleAvailability(context, (await params).touchId) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Availability could not be loaded." }, { status: 400 }); }
}
export async function POST(request: Request, { params }: { params: Promise<{ touchId: string }> }) {
  const context = await resolveTenantContext(request);
  if (context.userId === "unknown") return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const { touchId } = await params;
    const data = await runNoShowAction(context, touchId, schema.parse(await request.json()));
    return NextResponse.json({ data });
  } catch (error) {
    // Return persisted delivery state even on failure so the UI offers reconciliation rather
    // than continuing to show an editable, apparently unsent draft after a timeout.
    let data;
    try {
      const source = getMtosDataSource(context);
      const touch = await source.getMonthlyTouchById((await params).touchId);
      if (touch && await source.getClientById(touch.clientId)) data = touch.noShow;
    } catch { /* Preserve the original error if storage is also unavailable. */ }
    return NextResponse.json({ error: error instanceof Error ? error.message : "No-show action failed.", ...(data ? { data } : {}) }, { status: 400 });
  }
}
