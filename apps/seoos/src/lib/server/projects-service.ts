import type { AuthzContextV1 } from "@cie/contracts";

import {
  CreateSeoProjectInput,
  SeoProjectV1,
  canTransitionProject,
  type SeoProjectStage,
} from "@/src/lib/domain/project";
import { newId, nowIso } from "@/src/lib/ids";
import { normalizePodKey } from "@/src/lib/domain/pod";
import { getProjectRepo } from "@/src/lib/server/repositories/project-repo";
import { getUserRepo } from "@/src/lib/server/repositories/user-repo";
import {
  getIntegrationCredentials,
  listIntegrations,
} from "@/src/lib/server/integrations-service";
import {
  fetchClickUpClientRoster,
  normalizeComparableValue,
} from "@/src/lib/server/sync/clickup-clients";
import { podKeysForUser, upsertDiscoveredPods } from "@/src/lib/server/pods-service";

/**
 * Project lifecycle service. Prevents duplicate projects for a canonical client
 * and enforces validated stage transitions. Persists through the ProjectRepo.
 */
export async function listProjects(tenantId: string) {
  return getProjectRepo().list(tenantId);
}

export async function getProject(tenantId: string, projectId: string) {
  return getProjectRepo().get(tenantId, projectId);
}

export class DuplicateProjectError extends Error {
  constructor(clientId: string) {
    super(`An SEO project already exists for client ${clientId}`);
    this.name = "DuplicateProjectError";
  }
}

export async function createProject(
  tenantId: string,
  input: CreateSeoProjectInput,
): Promise<SeoProjectV1> {
  const parsed = CreateSeoProjectInput.parse(input);
  const repo = getProjectRepo();

  const existing = await repo.findByClient(tenantId, parsed.clientId);
  if (existing) throw new DuplicateProjectError(parsed.clientId);

  const now = nowIso();
  const project = SeoProjectV1.parse({
    schemaVersion: 1,
    id: newId("proj"),
    tenantId,
    clientId: parsed.clientId,
    businessName: parsed.businessName,
    website: parsed.website,
    valueProposition: parsed.valueProposition,
    niche: parsed.niche,
    stage: "draft",
    health: "healthy",
    assignments: parsed.assignments,
    serviceTier: parsed.serviceTier,
    priority: parsed.priority,
    targetLocations: parsed.targetLocations,
    goals: parsed.goals,
    setupReadiness: 0,
    createdAt: now,
    updatedAt: now,
  });
  return repo.save(project);
}

export interface SyncClientsResult {
  ok: boolean;
  created: number;
  updated: number;
  /** Roster tasks that were skipped as inactive/closed. */
  skipped: number;
  /** Active clients considered. */
  total: number;
  /** Distinct pods discovered from the SEO Dashboard. */
  podsFound: number;
  /** Clients that matched a pod by business name. */
  podsMatched: number;
  /** Human note about the pod join (e.g. dashboard list not configured). */
  podNote?: string;
  error?: string;
}

/**
 * Pull the full client roster from ClickUp (each Health Tracker task = one
 * client) and upsert a matching SEO project for every active client. Dedups by
 * canonical client id (the ClickUp task id), so re-running refreshes existing
 * projects instead of duplicating them, and records the client's SEO-specialist
 * and account-manager field values on the project for per-user visibility.
 *
 * Admin-only at the API layer (any admin can pull ALL clients at once).
 */
export async function syncClientsFromClickUp(tenantId: string): Promise<SyncClientsResult> {
  const empty = {
    ok: false as const,
    created: 0,
    updated: 0,
    skipped: 0,
    total: 0,
    podsFound: 0,
    podsMatched: 0,
  };

  const integrations = await listIntegrations(tenantId);
  const clickup = integrations.find((i) => i.id === "clickup" && i.status === "connected");
  if (!clickup) {
    return { ...empty, error: "ClickUp is not connected. Connect it under Integrations first." };
  }
  const creds = await getIntegrationCredentials(tenantId, "clickup");
  if (!creds?.apiToken) {
    return { ...empty, error: "ClickUp credentials are missing. Reconnect ClickUp under Integrations." };
  }

  // The SEO Dashboard is the roster source of truth: one row per client with the
  // full SEO field set (pod, niche, account manager, services, metrics). Prefer
  // it; fall back to a plain roster list only if no dashboard list is set.
  const rosterListId =
    creds.dashboardListId ||
    process.env.CLICKUP_SEO_DASHBOARD_LIST_ID ||
    creds.listId ||
    creds.healthTrackerListId;
  const roster = await fetchClickUpClientRoster({
    token: creds.apiToken,
    listId: rosterListId,
    teamId: creds.teamId,
  });
  if (!roster.ok) return { ...empty, error: roster.error ?? "clickup_roster_failed" };

  // Pods come straight off the roster rows now (no separate join).
  const discoveredPods = Array.from(
    new Set(roster.clients.map((c) => c.pod).filter((p): p is string => Boolean(p))),
  );
  if (discoveredPods.length) await upsertDiscoveredPods(tenantId, discoveredPods);

  const repo = getProjectRepo();
  let created = 0;
  let updated = 0;
  let podsMatched = 0;
  for (const client of roster.clients) {
    const now = nowIso();
    const externalIds: Record<string, string> = { clickupTaskId: client.taskId };
    if (client.seoSpecialist) externalIds.seoSpecialist = client.seoSpecialist;
    if (client.accountManager) externalIds.accountManager = client.accountManager;
    if (client.pod) {
      externalIds.pod = client.pod;
      podsMatched += 1;
    }
    const metrics = client.metrics ?? {};

    const existing = await repo.findByClient(tenantId, client.clientId);
    if (existing) {
      const mergedLocations = client.location
        ? Array.from(new Set([...(existing.targetLocations ?? []), client.location]))
        : existing.targetLocations;
      await repo.save({
        ...existing,
        businessName: client.name || existing.businessName,
        website: existing.website ?? client.website,
        // Fill AI-context fields only when empty — never clobber manual edits.
        niche: existing.niche ?? client.niche,
        serviceTier: existing.serviceTier ?? client.serviceTier,
        targetLocations: mergedLocations,
        externalIds: { ...existing.externalIds, ...externalIds },
        dashboardMetrics: { ...existing.dashboardMetrics, ...metrics },
        updatedAt: now,
      });
      updated += 1;
      continue;
    }

    await repo.save(
      SeoProjectV1.parse({
        schemaVersion: 1,
        id: newId("proj"),
        tenantId,
        clientId: client.clientId,
        businessName: client.name,
        website: client.website,
        niche: client.niche,
        serviceTier: client.serviceTier,
        stage: "intake",
        health: "healthy",
        assignments: { supportingUserIds: [] },
        priority: "normal",
        targetLocations: client.location ? [client.location] : [],
        goals: [],
        externalIds,
        dashboardMetrics: metrics,
        setupReadiness: 10,
        createdAt: now,
        updatedAt: now,
      }),
    );
    created += 1;
  }

  return {
    ok: true,
    created,
    updated,
    skipped: Math.max(0, roster.fetched - roster.clients.length),
    total: roster.clients.length,
    podsFound: discoveredPods.length,
    podsMatched,
    podNote: undefined,
  };
}

/** True when the project is explicitly assigned to this user id. */
function projectAssignedToUser(project: SeoProjectV1, userId: string): boolean {
  const a = project.assignments;
  if (
    a.seoSpecialistUserId === userId ||
    a.seoLeadUserId === userId ||
    a.qaReviewerUserId === userId ||
    a.accountManagerUserId === userId
  ) {
    return true;
  }
  return a.supportingUserIds.includes(userId);
}

/** The viewer's normalized identity tokens (email, local-part, display name). */
async function viewerMatchValues(authz: AuthzContextV1): Promise<string[]> {
  const user = await getUserRepo().getById(authz.tenantId, authz.userId);
  const tokens: string[] = [];
  if (user?.email) {
    tokens.push(user.email);
    tokens.push(user.email.split("@")[0] ?? "");
  }
  if (user?.displayName) tokens.push(user.displayName);
  return Array.from(new Set(tokens.map(normalizeComparableValue).filter(Boolean)));
}

/**
 * List the projects a given viewer may see. Admins (clientVisibility "all") see
 * every project; everyone else sees only projects assigned to them — by explicit
 * assignment userId, by an explicit client-visibility allowlist, or by matching
 * their identity to the ClickUp "SEO Specialist" field captured on the project.
 * The field match means a specialist who signs up after a sync still sees their
 * accounts without a re-sync.
 */
export async function listProjectsForViewer(authz: AuthzContextV1): Promise<SeoProjectV1[]> {
  const all = await getProjectRepo().list(authz.tenantId);
  if (authz.clientVisibility === "all") return all;

  const allowlist = Array.isArray(authz.clientVisibility)
    ? new Set(authz.clientVisibility)
    : new Set<string>();
  const matches = await viewerMatchValues(authz);
  const myPods = await podKeysForUser(authz.tenantId, authz.userId);

  return all.filter((project) => {
    if (projectAssignedToUser(project, authz.userId)) return true;
    if (allowlist.has(project.clientId)) return true;
    // Pod ownership: the primary MapRanking model — a specialist owns whole pods.
    const pod = project.externalIds?.pod ? normalizePodKey(project.externalIds.pod) : "";
    if (pod && myPods.has(pod)) return true;
    // Fallback: a per-client SEO-specialist field matched to the viewer.
    const specialist = project.externalIds?.seoSpecialist
      ? normalizeComparableValue(project.externalIds.seoSpecialist)
      : "";
    return specialist ? matches.includes(specialist) : false;
  });
}

/**
 * Recompute a project's setup readiness from what's actually in place, so the
 * setup wizard reflects real progress (not a hand-set number).
 */
export async function recomputeSetupReadiness(
  tenantId: string,
  projectId: string,
): Promise<SeoProjectV1> {
  const repo = getProjectRepo();
  const project = await repo.get(tenantId, projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const { getPerformanceSnapshotRepo } = await import(
    "@/src/lib/server/repositories/performance-snapshot-repo"
  );
  const { getKeywordRepo } = await import("@/src/lib/server/repositories/keyword-repo");
  const { getRecommendationRepo } = await import(
    "@/src/lib/server/repositories/recommendation-repo"
  );

  const [snapshot, keywords, recs] = await Promise.all([
    getPerformanceSnapshotRepo().get(tenantId, projectId),
    getKeywordRepo().listByProject(tenantId, projectId),
    getRecommendationRepo().listByProject(tenantId, projectId),
  ]);

  let score = 20; // intake exists
  if (project.niche || project.valueProposition) score += 10;
  if (project.externalIds?.pod) score += 10;
  if (snapshot && (snapshot.grids.length || snapshot.keywords.length)) score += 30;
  if (keywords.length) score += 20;
  if (recs.length) score += 10;
  const setupReadiness = Math.min(100, score);

  return repo.save({ ...project, setupReadiness, updatedAt: nowIso() });
}

export interface FullScanResult {
  ok: boolean;
  sources: Record<string, unknown>;
  setupReadiness: number;
  error?: string;
}

/**
 * "Generate full scan": pull every connected source for a client, then advance
 * the project (baseline stage + recomputed readiness). All reads; no external
 * side effects beyond the same syncs the Clients page already runs.
 */
export async function runFullScan(tenantId: string, projectId: string): Promise<FullScanResult> {
  const repo = getProjectRepo();
  const project = await repo.get(tenantId, projectId);
  if (!project) return { ok: false, sources: {}, setupReadiness: 0, error: "Project not found" };

  const { syncProjectSources } = await import("@/src/lib/server/source-sync-service");
  const sync = await syncProjectSources(tenantId, projectId);

  // Advance draft/intake to baseline_scan once data has been pulled.
  if (project.stage === "draft" || project.stage === "intake") {
    await repo.save({ ...project, stage: "baseline_scan", updatedAt: nowIso() });
  }
  const advanced = await recomputeSetupReadiness(tenantId, projectId);

  return {
    ok: sync.ok,
    sources: sync.sources,
    setupReadiness: advanced.setupReadiness,
    error: sync.error,
  };
}

/** Merge provider external-id mappings (e.g. clickupListId) into a project. */
export async function updateProjectExternalIds(
  tenantId: string,
  projectId: string,
  patch: Record<string, string>,
): Promise<SeoProjectV1> {
  const repo = getProjectRepo();
  const project = await repo.get(tenantId, projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const externalIds = { ...project.externalIds };
  for (const [k, v] of Object.entries(patch)) {
    const trimmed = v.trim();
    if (trimmed) externalIds[k] = trimmed;
    else delete externalIds[k];
  }
  return repo.save({ ...project, externalIds, updatedAt: nowIso() });
}

export async function transitionProject(
  tenantId: string,
  projectId: string,
  to: SeoProjectStage,
): Promise<SeoProjectV1> {
  const repo = getProjectRepo();
  const project = await repo.get(tenantId, projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  if (!canTransitionProject(project.stage, to)) {
    throw new Error(`Illegal project transition ${project.stage} → ${to}`);
  }
  return repo.save({ ...project, stage: to, updatedAt: nowIso() });
}
