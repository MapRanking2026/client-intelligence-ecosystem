import { NextResponse } from "next/server";

import { runDailyTenantSyncAllTenants } from "@/src/lib/server/services/daily-sync-service";

// Syncs every connected provider (refreshing their tokens) plus the client roster; needs the full
// Vercel budget.
export const maxDuration = 300;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  // Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" when CRON_SECRET is set.
  if (secret) {
    const header = request.headers.get("authorization") || "";
    return header === `Bearer ${secret}`;
  }
  // Vercel also marks its own cron invocations with this header; accept them if no secret is set.
  return request.headers.get("x-vercel-cron") === "1";
}

async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await runDailyTenantSyncAllTenants();
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Daily sync failed" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
