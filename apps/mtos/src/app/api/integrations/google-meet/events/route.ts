import { NextResponse } from "next/server";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { enableMeetEvents, getMeetEventStatus } from "@/src/lib/server/services/google-meet-events-service";

export const maxDuration = 120;
export async function GET(request: Request) {
  const context = await resolveTenantContext(request);
  if (context.userId === "unknown") return new Response(null, { status: 401 });
  return NextResponse.json({ data: await getMeetEventStatus(context) });
}
export async function POST(request: Request) {
  const context = await resolveTenantContext(request);
  if (context.userId === "unknown") return new Response(null, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return new Response(null, { status: 403 });
  try { return NextResponse.json({ data: await enableMeetEvents(context) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not enable notifications." }, { status: 400 }); }
}
