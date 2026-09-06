import { NextResponse } from "next/server";

import { getServerEnv } from "@/src/lib/server/env";
import { syncClientsFromClickUp } from "@/src/lib/server/projects-service";
import { syncAllTaskPlans } from "@/src/lib/server/task-engine-service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled client sync (Vercel Cron). Pulls the full client roster + SEO data
 * from ClickUp for the pilot tenant so the app stays current. Read-only against
 * ClickUp. Protected by CRON_SECRET when set; Vercel Cron sends it as a Bearer.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const tenantId = getServerEnv().pilotTenantId;
  try {
    const result = await syncClientsFromClickUp(tenantId);
    // Nothing gets missed: bring every client's task plan up to date (new tasks,
    // new recurring periods, reassignments), continuing from each client's state.
    const tasks = await syncAllTaskPlans(tenantId);
    return NextResponse.json({ tenantId, ...result, tasks });
  } catch (e) {
    return NextResponse.json(
      { tenantId, ok: false, error: e instanceof Error ? e.message : "cron_sync_failed" },
      { status: 500 },
    );
  }
}
