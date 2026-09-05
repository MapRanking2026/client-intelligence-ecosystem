import { getSeoPerformance } from "@/src/lib/server/gateway/client";
import { getProject } from "@/src/lib/server/projects-service";
import { importKeywords } from "@/src/lib/server/keywords-service";
import { getPerformanceSnapshotRepo } from "@/src/lib/server/repositories/performance-snapshot-repo";

export interface PopulateResult {
  configured: boolean;
  ok: boolean;
  keywordsCreated: number;
  keywordsSkipped: number;
  gridCount: number;
  businessCount: number;
  checkinBusinessCount: number;
  error?: string;
}

/**
 * Pull the client's current SEO data from MTOS (via the gateway) and
 * auto-populate the project: import tracked keywords and store the latest
 * rankings/grids/check-ins snapshot for the project's pages to render.
 */
export async function populateProjectFromMtos(
  tenantId: string,
  projectId: string,
): Promise<PopulateResult> {
  const project = await getProject(tenantId, projectId);
  if (!project) {
    return { configured: true, ok: false, keywordsCreated: 0, keywordsSkipped: 0, gridCount: 0, businessCount: 0, checkinBusinessCount: 0, error: "Project not found" };
  }

  const perf = await getSeoPerformance(tenantId, project.clientId);
  if (!perf.ok || !perf.snapshot) {
    return {
      configured: perf.configured,
      ok: false,
      keywordsCreated: 0,
      keywordsSkipped: 0,
      gridCount: 0,
      businessCount: 0,
      checkinBusinessCount: 0,
      error: perf.error ?? perf.dataGaps[0]?.reason ?? "No SEO data returned",
    };
  }

  const snapshot = perf.snapshot;
  const phrases = Array.from(new Set(snapshot.keywords.map((k) => k.keyword).filter(Boolean)));
  const imported = phrases.length
    ? await importKeywords(tenantId, projectId, project.clientId, phrases)
    : { created: 0, skipped: 0, createdKeywords: [] };

  await getPerformanceSnapshotRepo().save(tenantId, projectId, snapshot);

  return {
    configured: true,
    ok: true,
    keywordsCreated: imported.created,
    keywordsSkipped: imported.skipped,
    gridCount: snapshot.grids.length,
    businessCount: snapshot.businesses.length,
    checkinBusinessCount: snapshot.checkinBusinessCount,
  };
}
