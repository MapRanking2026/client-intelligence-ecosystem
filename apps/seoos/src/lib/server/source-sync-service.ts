import { nowIso } from "@/src/lib/ids";
import { getProject } from "@/src/lib/server/projects-service";
import {
  getIntegrationCredentials,
  listIntegrations,
} from "@/src/lib/server/integrations-service";
import { syncClickUp } from "@/src/lib/server/sync/clickup-adapter";
import { populateProjectFromMtos } from "@/src/lib/server/populate-service";
import {
  getClientDataRepo,
  type ClientDataRecord,
  type SourceSyncResult,
} from "@/src/lib/server/repositories/client-data-repo";

/**
 * Sync a client's complete data for a project from every available source:
 * SEOOS-native connected integrations (e.g. ClickUp) PLUS the MTOS gateway
 * SEO-performance pull (rankings/grids/check-ins). Results are aggregated per
 * source with honest success/error/not-connected states and stored.
 */
export async function syncProjectSources(
  tenantId: string,
  projectId: string,
): Promise<{ ok: boolean; sources: Record<string, SourceSyncResult>; error?: string }> {
  const project = await getProject(tenantId, projectId);
  if (!project) return { ok: false, sources: {}, error: "Project not found" };

  const sources: Record<string, SourceSyncResult> = {};
  const at = () => nowIso();

  // --- Native SEOOS integrations ---
  const integrations = await listIntegrations(tenantId);
  for (const view of integrations) {
    if (!view.syncable || view.status !== "connected") continue;
    const creds = await getIntegrationCredentials(tenantId, view.id);
    if (!creds) {
      sources[view.id] = { ok: false, syncedAt: at(), error: "No stored credentials" };
      continue;
    }
    if (view.id === "clickup") {
      const r = await syncClickUp({ credentials: creds, project });
      sources.clickup = {
        ok: r.ok,
        syncedAt: at(),
        summary: r.summary,
        error: r.error,
        data: r.data,
      };
    }
  }

  // --- MTOS gateway: SEO performance (rankings/grids/keywords/check-ins) ---
  const perf = await populateProjectFromMtos(tenantId, projectId);
  sources["mtos-seo-performance"] = {
    ok: perf.ok,
    syncedAt: at(),
    summary: perf.ok
      ? `+${perf.keywordsCreated} keywords, ${perf.gridCount} grid(s), ${perf.businessCount} business(es)`
      : undefined,
    error: perf.ok ? undefined : !perf.configured ? "gateway_not_configured" : perf.error,
  };

  const record: ClientDataRecord = { tenantId, projectId, syncedAt: at(), sources };
  await getClientDataRepo().save(record);
  return { ok: true, sources };
}

export async function getClientData(tenantId: string, projectId: string) {
  return getClientDataRepo().get(tenantId, projectId);
}
