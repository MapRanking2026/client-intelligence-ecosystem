import { NextResponse } from "next/server";

import { getServerEnv } from "@/src/lib/server/env";
import { verifyCronSecret } from "@/src/lib/server/ai-visibility/access";
import { processQueue } from "@/src/lib/server/ai-visibility/queue";
import { appOrigin, kickWorker, runScheduler, workerBudgetMs } from "@/src/lib/server/ai-visibility/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled entry point (Vercel Cron → GET with `Authorization: Bearer CRON_SECRET`).
 * 1) creates due scheduled scans (idempotent per client + period),
 * 2) processes the queue (also reclaims expired leases = resumes interrupted work),
 * 3) chains the worker if work remains.
 */
export async function GET(request: Request) {
  if (!verifyCronSecret(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tenantId = getServerEnv().pilotTenantId;
  try {
    const scheduled = await runScheduler(tenantId);
    const report = await processQueue({ tenantId, deadlineMs: Math.min(workerBudgetMs(), 200_000) });
    let chained = false;
    if (report.remaining > 0) chained = await kickWorker(appOrigin(request), 1);
    return NextResponse.json({ tenantId, scheduled, report, chained });
  } catch (e) {
    console.error("[aiv] cron failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "cron_failed" }, { status: 500 });
  }
}
