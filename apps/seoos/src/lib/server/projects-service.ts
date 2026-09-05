import type { AuthzContextV1 } from "@cie/contracts";

import {
  CreateSeoProjectInput,
  SeoProjectV1,
  canTransitionProject,
  type SeoProjectStage,
} from "@/src/lib/domain/project";
import { newId, nowIso } from "@/src/lib/ids";
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
  const empty = { ok: false as const, created: 0, updated: 0, skipped: 0, total: 0 };

  const integrations = await listIntegrations(tenantId);
  const clickup = integrations.find((i) => i.id === "clickup" && i.status === "connected");
  if (!clickup) {
    return { ...empty, error: "ClickUp is not connected. Connect it under Integrations first." };
  }
  const creds = await getIntegrationCredentials(tenantId, "clickup");
  if (!creds?.apiToken) {
    return { ...empty, error: "ClickUp credentials are missing. Reconnect ClickUp under Integrations." };
  }

  const roster = await fetchClickUpClientRoster({
    token: creds.apiToken,
    listId: creds.listId || creds.healthTrackerListId,
    teamId: creds.teamId,
  });
  if (!roster.ok) return { ...empty, error: roster.error ?? "clickup_roster_failed" };

  const repo = getProjectRepo();
  let created = 0;
  let updated = 0;
  for (const client of roster.clients) {
    const now = nowIso();
    const externalIds: Record<string, string> = { clickupTaskId: client.taskId };
    if (client.seoSpecialist) externalIds.seoSpecialist = client.seoSpecialist;
    if (client.accountManager) externalIds.accountManager = client.accountManager;

    const existing = await repo.findByClient(tenantId, client.clientId);
    if (existing) {
      const mergedLocations = client.location
        ? Array.from(new Set([...(existing.targetLocations ?? []), client.location]))
        : existing.targetLocations;
      await repo.save({
        ...existing,
        businessName: client.name || existing.businessName,
        website: client.website ?? existing.website,
        targetLocations: mergedLocations,
        externalIds: { ...existing.externalIds, ...externalIds },
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
        stage: "intake",
        health: "healthy",
        assignments: { supportingUserIds: [] },
        priority: "normal",
        targetLocations: client.location ? [client.location] : [],
        goals: [],
        externalIds,
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

  return all.filter((project) => {
    if (projectAssignedToUser(project, authz.userId)) return true;
    if (allowlist.has(project.clientId)) return true;
    const specialist = project.externalIds?.seoSpecialist
      ? normalizeComparableValue(project.externalIds.seoSpecialist)
      : "";
    return specialist ? matches.includes(specialist) : false;
  });
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
