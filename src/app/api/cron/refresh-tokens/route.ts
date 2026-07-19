import { NextResponse } from "next/server";

import { getDailySyncTenantId, runTokenRefresh } from "@/src/lib/server/services/daily-sync-service";

// Token refresh is quick, but give it room in case several providers refresh at once.
// Scheduled daily (03:00 UTC) -- the Hobby plan caps crons at once per day; the daily-sync cron
// (09:00) also refreshes, and on-demand refresh at every sync/prep covers intra-day expiry.
export const maxDuration = 120;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    return (request.headers.get("authorization") || "") === `Bearer ${secret}`;
  }
  return request.headers.get("x-vercel-cron") === "1";
}

async function handle(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const report = await runTokenRefresh(getDailySyncTenantId());
    return NextResponse.json({ ok: true, report });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Token refresh failed" },
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
