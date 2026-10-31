import { NextResponse } from "next/server";
import { runGoogleMeetingSweep } from "@/src/lib/server/services/google-meet-service";

export const maxDuration = 300;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  // Fail closed: a spoofable scheduler header is not authentication.
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try { return NextResponse.json({ data: await runGoogleMeetingSweep() }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Meeting processing failed." }, { status: 500 }); }
}
