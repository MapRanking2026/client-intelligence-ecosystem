import { ClientBrain, FirestoreClientStore, InMemoryClientStore } from "@cie/brain";
import type { ClientReconciliationReportV1, NormalizedClientInput } from "@cie/contracts";

import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { getIntegrationCredentials } from "@/src/lib/server/integrations-service";
import { fetchClickUpClientRoster, type RosterClient } from "@/src/lib/server/sync/clickup-clients";
import { nowIso } from "@/src/lib/ids";

/** Map Ranking ClickUp lists (fallbacks; creds/env override). */
const DEFAULT_SEO_DASHBOARD_LIST_ID = "901112026952"; // SEO Dashboard (SEOOS)
const DEFAULT_HEALTH_TRACKER_LIST_ID = "901105243881"; // Client Health Tracker (MTOS)

/**
 * SEOOS's handle on the shared Client Brain. The brain is a shared in-monorepo
 * module (@cie/brain); we inject SEOOS's Firestore so the brain never owns
 * Firebase init. Falls back to in-memory when Firestore isn't configured.
 */
let brain: ClientBrain | null = null;
export function getClientBrain(): ClientBrain {
  if (brain) return brain;
  const db = getFirebaseAdminDb();
  brain = new ClientBrain(db ? new FirestoreClientStore(db) : new InMemoryClientStore());
  return brain;
}

/** Map a ClickUp roster into canonical brain inputs, tagged with their source. */
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

export interface BrainIngestResult {
  ok: boolean;
  error?: string;
  report?: ClientReconciliationReportV1;
  /** The SEO Dashboard roster, returned so callers can reuse it (fallback/counts). */
  dashboardRoster?: RosterClient[];
  dashboardFetched?: number;
}

/**
 * Read the ClickUp client lists (READ-ONLY) and reconcile them into the brain.
 * Two sources: the SEO Dashboard (SEOOS's list) and MTOS's Client Health Tracker
 * — so the reconciliation report reflects both departments' view of each client.
 * The Health Tracker is best-effort: a failure there never fails the whole pass.
 */
export async function ingestClickUpIntoBrain(tenantId: string): Promise<BrainIngestResult> {
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

  const report = await getClientBrain().ingestAndReconcile(tenantId, inputs, { now: nowIso() });
  return { ok: true, report, dashboardRoster: dash.clients, dashboardFetched: dash.fetched };
}
