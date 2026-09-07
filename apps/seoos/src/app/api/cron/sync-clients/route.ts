import { NextResponse } from "next/server";

import { getServerEnv } from "@/src/lib/server/env";
import { syncClientsFromClickUp } from "@/src/lib/server/projects-service";
import { syncAllTaskPlans } from "@/src/lib/server/task-engine-service";
import { syncTickets } from "@/src/lib/server/tickets-service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Scheduled sync (Vercel Cron, every 2 hours). Keeps the app current on its own
 * so no one has to click a refresh/sync button: pulls the client roster + SEO
 * data, brings every client's task plan up to date, and ingests new ClickUp
 * tickets (auto-drafting the new ones). All READ-ONLY against ClickUp — nothing
 * is written back or published. Protected by CRON_SECRET when set (Bearer).
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
    // Pull in any new/updated tickets and auto-draft the new ones (staged only).
    // Don't let a ticket hiccup fail the whole sync — report it instead.
    let tickets: unknown;
    try {
      tickets = await syncTickets(tenantId, { autoDraft: true });
    } catch (e) {
      tickets = { ok: false, error: e instanceof Error ? e.message : "ticket_sync_failed" };
    }
    return NextResponse.json({ tenantId, ...result, tasks, tickets });
  } catch (e) {
    return NextResponse.json(
      { tenantId, ok: false, error: e instanceof Error ? e.message : "cron_sync_failed" },
      { status: 500 },
    );
  }
}
