import { NextResponse } from "next/server";
import { authenticateMeetPush, receiveMeetPush } from "@/src/lib/server/services/google-meet-events-service";

export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  try { await authenticateMeetPush(request); }
  catch { return NextResponse.json({ error: "Unauthorized Google push." }, { status: 401 }); }
  if (Number(request.headers.get("content-length") || 0) > 150000) return new Response(null, { status: 413 });
  try {
    const body = await request.text();
    if (body.length > 150000) return new Response(null, { status: 413 });
    await receiveMeetPush(JSON.parse(body));
    return new Response(null, { status: 204 });
  } catch {
    // Do not acknowledge failed work: Pub/Sub retries and the durable journal deduplicates.
    return NextResponse.json({ error: "Google event processing deferred; retry delivery." }, { status: 503 });
  }
}
