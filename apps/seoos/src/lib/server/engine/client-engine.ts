import { ClientEngine } from "@cie/engine";
import type { ClientReconciliationReportV1, NormalizedClientInput } from "@cie/contracts";

import { engineTenantId, getEngineStore } from "@/src/lib/server/engine/engine-store";
import { getIntegrationCredentials } from "@/src/lib/server/integrations-service";
import { fetchClickUpClientRoster, type RosterClient } from "@/src/lib/server/sync/clickup-clients";
import { nowIso } from "@/src/lib/ids";

/** Map Ranking ClickUp lists (fallbacks; creds/env override). */
const DEFAULT_SEO_DASHBOARD_LIST_ID = "901112026952"; // SEO Dashboard (SEOOS)
const DEFAULT_HEALTH_TRACKER_LIST_ID = "901105243881"; // Client Health Tracker (MTOS)

/**
 * SEOOS's handle on the shared Client Intelligence Engine. The engine is a shared
 * in-monorepo module (@cie/engine); the store backend (Supabase, a dedicated
 * Firebase project, else in-memory) is selected by getEngineStore().
 */
let engine: ClientEngine | null = null;
export function getClientEngine(): ClientEngine {
  if (engine) return engine;
  engine = new ClientEngine(getEngineStore());
  return engine;
}

/** Map a ClickUp roster into canonical engine inputs, tagged with their source. */
export function rosterToInputs(
  clients: RosterClient[],
  source = "clickup:seo-dashboard",
): NormalizedClientInput[] {
  return clients.map((c) => ({
    source,
    sourceRecordId: c.taskId,
    businessName: c.name,
    website: c.website,
    niche: c.niche,
    locations: c.location ? [c.location] : [],
    status: c.status,
    packageName: c.serviceTier,
    accountManager: c.accountManager,
    // Native ClickUp assignee is the authoritative specialist, else ⭐ Responsable.
    seoSpecialist: c.assignedTo || c.seoSpecialist,
    pod: c.pod,
    healthScore: c.health,
    externalIds: { clickupTaskId: c.taskId },
    metrics: c.metrics ?? {},
  }));
}

export interface EngineIngestResult {
  ok: boolean;
  error?: string;
  report?: ClientReconciliationReportV1;
  /** The SEO Dashboard roster, returned so callers can reuse it (fallback/counts). */
  dashboardRoster?: RosterClient[];
  dashboardFetched?: number;
}

/**
 * Read the ClickUp client lists (READ-ONLY) and reconcile them into the engine.
 * Two sources: the SEO Dashboard (SEOOS's list) and MTOS's Client Health Tracker
 * — so the reconciliation report reflects both departments' view of each client.
 * The Health Tracker is best-effort: a failure there never fails the whole pass.
 *
 * `tenantId` scopes the ClickUp credentials (SEOOS's own tenant); the canonical
 * records are written under the SHARED engine tenant so MTOS reads the same data.
 */
export async function ingestClickUpIntoEngine(tenantId: string): Promise<EngineIngestResult> {
  const creds = await getIntegrationCredentials(tenantId, "clickup");
  if (!creds?.apiToken) {
    return { ok: false, error: "ClickUp credentials are missing. Reconnect ClickUp under Integrations." };
  }

  const dashListId =
    creds.dashboardListId ||
    process.env.CLICKUP_SEO_DASHBOARD_LIST_ID ||
    creds.listId ||
    DEFAULT_SEO_DASHBOARD_LIST_ID;
  const healthListId =
    creds.healthTrackerListId ||
    process.env.CLICKUP_HEALTH_TRACKER_LIST_ID ||
    DEFAULT_HEALTH_TRACKER_LIST_ID;

  const dash = await fetchClickUpClientRoster({
    token: creds.apiToken,
    listId: dashListId,
    teamId: creds.teamId,
  });
  if (!dash.ok) return { ok: false, error: dash.error ?? "clickup_roster_failed" };

  const inputs = rosterToInputs(dash.clients, "clickup:seo-dashboard");

  // Second source: MTOS's Client Health Tracker (best-effort).
  if (healthListId && healthListId !== dashListId) {
    try {
      const health = await fetchClickUpClientRoster({
        token: creds.apiToken,
        listId: healthListId,
        teamId: creds.teamId,
      });
      if (health.ok) inputs.push(...rosterToInputs(health.clients, "clickup:health-tracker"));
    } catch {
      /* Health Tracker unavailable — proceed with the SEO Dashboard alone. */
    }
  }

  const report = await getClientEngine().ingestAndReconcile(engineTenantId(), inputs, { now: nowIso() });
  return { ok: true, report, dashboardRoster: dash.clients, dashboardFetched: dash.fetched };
}
