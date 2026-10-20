import type { AuthzContextV1 } from "@cie/contracts";

import { computeMetrics } from "@/src/lib/ai-visibility/metrics";
import type { AivObservationV1, AivProfileV1, AivPromptV1, AivScanV1 } from "@/src/lib/ai-visibility/types";
import { listProjectsForViewer } from "@/src/lib/server/projects-service";
import { listPrompts } from "./prompt-service";
import { listScans } from "./scan-service";
import { observations, profiles } from "./store";

/** Live observations only — fixture rows are never returned to dashboards. */
export async function liveObservations(tenantId: string, projectId: string): Promise<AivObservationV1[]> {
  return (await observations().listWhere(tenantId, "projectId", projectId)).filter((o) => !o.isFixture);
}

export interface ProjectData {
  profile: AivProfileV1 | null;
  prompts: AivPromptV1[];
  scans: AivScanV1[];
  observations: AivObservationV1[];
}

export async function loadProjectData(tenantId: string, projectId: string): Promise<ProjectData> {
  const [profile, prompts, scans, obs] = await Promise.all([
    profiles().get(tenantId, projectId),
    listPrompts(tenantId, projectId),
    listScans(tenantId, projectId),
    liveObservations(tenantId, projectId),
  ]);
  return { profile, prompts, scans, observations: obs };
}

export interface PortfolioRow {
  projectId: string;
  businessName: string;
  niche?: string;
  profileStatus: "not_set_up" | AivProfileV1["status"];
  lastScanAt?: string;
  lastScanStatus?: AivScanV1["status"];
  validUnbranded: number;
  mentionRate: number | null;
  recommendationRate: number | null;
  providers: string[];
  stale: boolean;
  runningScans: number;
}

const STALE_DAYS = 35;

export async function loadPortfolio(authz: AuthzContextV1): Promise<PortfolioRow[]> {
  const projects = await listProjectsForViewer(authz);
  const allProfiles = new Map((await profiles().list(authz.tenantId)).map((p) => [p.projectId, p]));
  const rows: PortfolioRow[] = [];
  for (const p of projects) {
    const prof = allProfiles.get(p.id);
    if (!prof) {
      rows.push({ projectId: p.id, businessName: p.businessName, niche: p.niche, profileStatus: "not_set_up", validUnbranded: 0, mentionRate: null, recommendationRate: null, providers: [], stale: false, runningScans: 0 });
      continue;
    }
    const [scans, obs] = await Promise.all([listScans(authz.tenantId, p.id), liveObservations(authz.tenantId, p.id)]);
    const m = computeMetrics(obs, { channel: "official_api", branded: false });
    const last = scans[0];
    rows.push({
      projectId: p.id,
      businessName: p.businessName,
      niche: p.niche,
      profileStatus: prof.status,
      lastScanAt: last?.createdAt,
      lastScanStatus: last?.status,
      validUnbranded: m.sample.valid,
      mentionRate: m.mentionRate.value,
      recommendationRate: m.recommendationRate.value,
      providers: prof.providerIds,
      stale: Boolean(last && Date.now() - Date.parse(last.createdAt) > STALE_DAYS * 86400000),
      runningScans: scans.filter((s) => s.status === "queued" || s.status === "running").length,
    });
  }
  return rows.sort((a, b) => a.businessName.localeCompare(b.businessName));
}
