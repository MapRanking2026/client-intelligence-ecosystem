import type { AuthzContextV1, ClientV1 } from "@cie/contracts";

import {
  CreateSeoProjectInput,
  SeoProjectV1,
  canTransitionProject,
  type SeoProjectStage,
} from "@/src/lib/domain/project";
import { newId, nowIso } from "@/src/lib/ids";
import { getProjectRepo } from "@/src/lib/server/repositories/project-repo";
import { listIntegrations } from "@/src/lib/server/integrations-service";
import type { RosterClient } from "@/src/lib/server/sync/clickup-clients";
import { getClientEngine, ingestClickUpIntoEngine } from "@/src/lib/server/engine/client-engine";
import { engineTenantId } from "@/src/lib/server/engine/engine-store";
import { clientKey } from "@cie/engine";

/**
 * The client-identity fields SEOOS needs to build a project, sourced from either
 * the engine's canonical record (default) or, for rollback, the ClickUp roster.
 */
interface ClientRow {
  clientId: string;
  taskId: string;
  name: string;
  website?: string;
  niche?: string;
  serviceTier?: string;
  locations: string[];
  metrics: Record<string, string>;
  seoSpecialist?: string;
  accountManager?: string;
  pod?: string;
  status?: string;
}

function rosterToRow(c: RosterClient): ClientRow {
  return {
    clientId: c.clientId,
    taskId: c.taskId,
    name: c.name,
    website: c.website,
    niche: c.niche,
    serviceTier: c.serviceTier,
    locations: c.location ? [c.location] : [],
    metrics: c.metrics ?? {},
    seoSpecialist: c.assignedTo || c.seoSpecialist,
    accountManager: c.accountManager,
    pod: c.pod,
    status: c.status,
  };
}

/** Canonical engine client → project row. Requires a ClickUp task id to key on. */
function canonicalToRow(c: ClientV1): ClientRow | null {
  const taskId = c.externalIds?.clickupTaskId;
  if (!taskId) return null;
  return {
    clientId: taskId,
    taskId,
    name: c.businessName,
    website: c.website,
    niche: c.niche,
    serviceTier: c.packageName,
    locations: c.locations ?? [],
    metrics: c.metrics ?? {},
    seoSpecialist: c.seoSpecialist,
    accountManager: c.accountManager,
    pod: c.pod,
    status: c.status,
  };
}
import {
  listSpecialists,
  matchSpecialistId,
  resolveViewerSpecialistId,
} from "@/src/lib/server/specialists-service";

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
  /** Stale ClickUp-sourced clients removed (e.g. old subtask rows). */
  pruned: number;
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
    pruned: 0,
  };

  const integrations = await listIntegrations(tenantId);
  const clickup = integrations.find((i) => i.id === "clickup" && i.status === "connected");
  if (!clickup) {
    return { ...empty, error: "ClickUp is not connected. Connect it under Integrations first." };
  }

  // Feed the Client Intelligence Engine FIRST — it is the source of truth. The
  // engine does the ClickUp reads (SEO Dashboard + MTOS Health Tracker) and
  // reconciles; SEOOS then builds its projects from the engine's canonical clients.
  const ingest = await ingestClickUpIntoEngine(tenantId);
  if (!ingest.ok) return { ...empty, error: ingest.error ?? "clickup_roster_failed" };
  const dashboardRoster = ingest.dashboardRoster ?? [];
  const dashboardFetched = ingest.dashboardFetched ?? dashboardRoster.length;

  let engineClients: ClientV1[] = [];
  try {
    engineClients = await getClientEngine().listClients(engineTenantId());
  } catch {
    engineClients = [];
  }

  // Read client truth from the engine by default; the legacy direct-from-ClickUp
  // path stays available for rollback via SEOOS_CLIENT_SOURCE=clickup.
  const source = (process.env.SEOOS_CLIENT_SOURCE || "engine").toLowerCase();
  let rows: ClientRow[];
  if (source === "clickup") {
    rows = dashboardRoster.map(rosterToRow);
  } else {
    rows = engineClients.map(canonicalToRow).filter((r): r is ClientRow => r !== null);
    // Safety: if the engine came back empty (e.g. a transient read), fall back to
    // the roster so we never prune the entire client list to zero.
    if (rows.length === 0 && dashboardRoster.length > 0) rows = dashboardRoster.map(rosterToRow);
  }

  // Dedupe so a client is never pooled twice — by ClickUp task id, and by
  // normalized business name (the same client under two task ids, or spelled
  // slightly differently across the SEO Dashboard and the Health Tracker).
  {
    const seenId = new Set<string>();
    const seenBiz = new Set<string>();
    rows = rows.filter((r) => {
      const bizKey = clientKey(r.name || r.clientId);
      if (seenId.has(r.clientId) || (bizKey && seenBiz.has(bizKey))) return false;
      seenId.add(r.clientId);
      if (bizKey) seenBiz.add(bizKey);
      return true;
    });
  }

  // Pod values are informational; client → specialist grouping is driven by the
  // seoSpecialist field carried on each row.
  const discoveredPods = Array.from(
    new Set(rows.map((r) => r.pod).filter((p): p is string => Boolean(p))),
  );

  const repo = getProjectRepo();
  let created = 0;
  let updated = 0;
  let podsMatched = 0;
  for (const client of rows) {
    const now = nowIso();
    const externalIds: Record<string, string> = { clickupTaskId: client.taskId };
    if (client.seoSpecialist) externalIds.seoSpecialist = client.seoSpecialist;
    if (client.accountManager) externalIds.accountManager = client.accountManager;
    if (client.pod) {
      externalIds.pod = client.pod;
      podsMatched += 1;
    }
    if (client.status) externalIds.status = client.status;
    const metrics = client.metrics ?? {};
    const services = (client.serviceTier ?? "")
      .split(/[,|]/)
      .map((s) => s.trim())
      .filter(Boolean);

    const existing = await repo.findByClient(tenantId, client.clientId);
    if (existing) {
      const mergedLocations = client.locations.length
        ? Array.from(new Set([...(existing.targetLocations ?? []), ...client.locations]))
        : existing.targetLocations;
      await repo.save({
        ...existing,
        businessName: client.name || existing.businessName,
        website: existing.website ?? client.website,
        // Fill AI-context fields only when empty — never clobber manual edits.
        niche: existing.niche ?? client.niche,
        serviceTier: client.serviceTier ?? existing.serviceTier,
        services: services.length ? services : existing.services,
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
        services,
        stage: "intake",
        health: "healthy",
        assignments: { supportingUserIds: [] },
        priority: "normal",
        targetLocations: client.locations,
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

  // Prune stale ClickUp-sourced clients no longer present. Only prune when we
  // actually have rows (guarded above), and never touch manually-created
  // projects (no clickupTaskId).
  let pruned = 0;
  if (rows.length) {
    const currentIds = new Set(rows.map((r) => r.clientId));
    const staleIds = (await repo.list(tenantId))
      .filter((p) => p.externalIds?.clickupTaskId && !currentIds.has(p.clientId))
      .map((p) => p.id);
    if (staleIds.length) await repo.removeMany(tenantId, staleIds);
    pruned = staleIds.length;
  }

  // Clean up any pre-existing duplicate projects from earlier runs: keep one
  // project per business name (most recently updated wins). Only ClickUp-sourced
  // projects are considered, so manually-created projects are never removed.
  {
    const allProjects = await repo.list(tenantId);
    const byBusiness = new Map<string, SeoProjectV1[]>();
    for (const p of allProjects) {
      if (!p.externalIds?.clickupTaskId) continue;
      const k = clientKey(p.businessName || p.clientId);
      const arr = byBusiness.get(k);
      if (arr) arr.push(p);
      else byBusiness.set(k, [p]);
    }
    const dupIds: string[] = [];
    for (const group of byBusiness.values()) {
      if (group.length <= 1) continue;
      group.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
      dupIds.push(...group.slice(1).map((p) => p.id));
    }
    if (dupIds.length) await repo.removeMany(tenantId, dupIds);
    pruned += dupIds.length;
  }

  return {
    ok: true,
    created,
    updated,
    skipped: Math.max(0, dashboardFetched - dashboardRoster.length),
    total: rows.length,
    podsFound: discoveredPods.length,
    podsMatched,
    pruned,
    podNote: undefined,
  };
}

/**
 * The specialist a client belongs to: the admin's direct assignment if set,
 * otherwise the roster specialist matched from the ClickUp ⭐ Responsable field.
 */
export function effectiveSpecialistId(
  project: SeoProjectV1,
  specialists: import("@/src/lib/domain/specialist").SpecialistV1[],
): string | undefined {
  if (project.assignedSpecialistId) return project.assignedSpecialistId;
  return matchSpecialistId(project.externalIds?.seoSpecialist, specialists);
}

/**
 * List the projects a given viewer may see. Admins (clientVisibility "all") see
 * every client; everyone else sees only the clients belonging to their own
 * specialist (resolved by login email/name against the roster). This scopes each
 * specialist to their own accounts, like an MTOS account manager.
 */
/** Keep one project per business name (most recently updated wins) so a client
 * never shows twice, even if duplicate projects exist in the store. */
function dedupeByBusiness(projects: SeoProjectV1[]): SeoProjectV1[] {
  const bestByKey = new Map<string, SeoProjectV1>();
  for (const p of projects) {
    const k = clientKey(p.businessName || p.clientId);
    const cur = bestByKey.get(k);
    if (!cur || p.updatedAt > cur.updatedAt) bestByKey.set(k, p);
  }
  const keep = new Set([...bestByKey.values()].map((p) => p.id));
  return projects.filter((p) => keep.has(p.id));
}

export async function listProjectsForViewer(authz: AuthzContextV1): Promise<SeoProjectV1[]> {
  const all = await getProjectRepo().list(authz.tenantId);
  if (authz.clientVisibility === "all") return dedupeByBusiness(all);

  const specialists = await listSpecialists(authz.tenantId);
  const mySpecialistId = await resolveViewerSpecialistId(authz.tenantId, authz.userId);
  const allowlist = Array.isArray(authz.clientVisibility)
    ? new Set(authz.clientVisibility)
    : new Set<string>();

  if (!mySpecialistId) return dedupeByBusiness(all.filter((p) => allowlist.has(p.clientId)));

  return dedupeByBusiness(
    all.filter((project) => {
      if (allowlist.has(project.clientId)) return true;
      return effectiveSpecialistId(project, specialists) === mySpecialistId;
    }),
  );
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

  // Bring the client's task plan up to date from its current state.
  const { syncTaskPlan } = await import("@/src/lib/server/task-engine-service");
  await syncTaskPlan(tenantId, projectId).catch(() => {});

  return {
    ok: sync.ok,
    sources: sync.sources,
    setupReadiness: advanced.setupReadiness,
    error: sync.error,
  };
}

/**
 * Admin action: directly assign (or clear) a client's SEO specialist. A direct
 * assignment overrides the pod — the client shows up for that specialist
 * regardless of its ClickUp pod. Clearing lets the client follow its pod again.
 */
export async function assignProjectSpecialist(
  tenantId: string,
  projectId: string,
  specialistId: string | null,
): Promise<SeoProjectV1> {
  const repo = getProjectRepo();
  const project = await repo.get(tenantId, projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);
  const saved = specialistId
    ? await repo.save({ ...project, assignedSpecialistId: specialistId, updatedAt: nowIso() })
    : await (async () => {
        const { assignedSpecialistId: _drop, ...rest } = project;
        return repo.save({ ...rest, updatedAt: nowIso() });
      })();
  // Reassignment re-runs the task engine: open tasks move to the new specialist
  // and the plan continues from the client's current state.
  const { syncTaskPlan } = await import("@/src/lib/server/task-engine-service");
  await syncTaskPlan(tenantId, projectId).catch(() => {});
  return saved;
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
