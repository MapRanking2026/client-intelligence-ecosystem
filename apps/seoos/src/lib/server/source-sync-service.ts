import { nowIso } from "@/src/lib/ids";
import { getProject } from "@/src/lib/server/projects-service";
import {
  getIntegrationCredentials,
  listIntegrations,
} from "@/src/lib/server/integrations-service";
import { syncClickUp } from "@/src/lib/server/sync/clickup-adapter";
import { syncMapRanking } from "@/src/lib/server/sync/mapranking-client";
import { populateProjectFromMtos } from "@/src/lib/server/populate-service";
import { importKeywords } from "@/src/lib/server/keywords-service";
import { getPerformanceSnapshotRepo } from "@/src/lib/server/repositories/performance-snapshot-repo";
import {
  getClientDataRepo,
  type ClientDataRecord,
  type SourceSyncResult,
} from "@/src/lib/server/repositories/client-data-repo";

/**
 * Sync a client's complete data for a project from every connected source:
 *  - ClickUp (native adapter)
 *  - Rank Tracker + Map Check-Ins (native MapRanking dashboard login)
 *  - falls back to the MTOS gateway SEO-performance pull when Rank Tracker is
 *    not connected natively.
 * Results are aggregated per source with honest states and stored.
 */
export async function syncProjectSources(
  tenantId: string,
  projectId: string,
): Promise<{ ok: boolean; sources: Record<string, SourceSyncResult>; error?: string }> {
  const project = await getProject(tenantId, projectId);
  if (!project) return { ok: false, sources: {}, error: "Project not found" };

  const sources: Record<string, SourceSyncResult> = {};
  const at = () => nowIso();
  const integrations = await listIntegrations(tenantId);
  const connected = new Set(integrations.filter((i) => i.status === "connected").map((i) => i.id));

  // --- ClickUp (native) ---
  if (connected.has("clickup")) {
    const creds = await getIntegrationCredentials(tenantId, "clickup");
    if (!creds) sources.clickup = { ok: false, syncedAt: at(), error: "No stored credentials" };
    else {
      const r = await syncClickUp({ credentials: creds, project });
      sources.clickup = { ok: r.ok, syncedAt: at(), summary: r.summary, error: r.error, data: r.data };
    }
  }

  // --- Rank Tracker + Map Check-Ins (native MapRanking) ---
  if (connected.has("rank-tracker")) {
    const creds = await getIntegrationCredentials(tenantId, "rank-tracker");
    if (!creds) {
      sources["rank-tracker"] = { ok: false, syncedAt: at(), error: "No stored credentials" };
    } else {
      const r = await syncMapRanking({ credentials: creds, project });
      if (r.ok && r.snapshot) {
        await getPerformanceSnapshotRepo().save(tenantId, projectId, r.snapshot);
        const phrases = Array.from(new Set(r.snapshot.keywords.map((k) => k.keyword).filter(Boolean)));
        if (phrases.length) await importKeywords(tenantId, projectId, project.clientId, phrases);
        sources["rank-tracker"] = { ok: true, syncedAt: at(), summary: r.summary, data: r.snapshot };
        sources["map-checkins"] = {
          ok: true,
          syncedAt: at(),
          summary: `${r.snapshot.checkinBusinessCount} business(es), ${r.snapshot.checkinTotalPosts} post(s)`,
        };
      } else {
        sources["rank-tracker"] = { ok: false, syncedAt: at(), error: r.error };
      }
    }
  } else {
    // Fallback: relay SEO performance from MTOS via the gateway.
    const perf = await populateProjectFromMtos(tenantId, projectId);
    sources["mtos-seo-performance"] = {
      ok: perf.ok,
      syncedAt: at(),
      summary: perf.ok
        ? `+${perf.keywordsCreated} keywords, ${perf.gridCount} grid(s), ${perf.businessCount} business(es)`
        : undefined,
      error: perf.ok ? undefined : !perf.configured ? "gateway_not_configured" : perf.error,
    };
  }

  const record: ClientDataRecord = { tenantId, projectId, syncedAt: at(), sources };
  await getClientDataRepo().save(record);
  return { ok: true, sources };
}

export async function getClientData(tenantId: string, projectId: string) {
  return getClientDataRepo().get(tenantId, projectId);
}
