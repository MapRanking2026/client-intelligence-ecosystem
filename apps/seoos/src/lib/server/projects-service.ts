import {
  CreateSeoProjectInput,
  SeoProjectV1,
  canTransitionProject,
  type SeoProjectStage,
} from "@/src/lib/domain/project";
import { newId, nowIso } from "@/src/lib/ids";
import { getProjectRepo } from "@/src/lib/server/repositories/project-repo";
import { getMtosClients } from "@/src/lib/server/gateway/client";

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
  configured: boolean;
  ok: boolean;
  created: number;
  skipped: number;
  total: number;
  error?: string;
}

/**
 * Pull the existing MTOS clients through the gateway and create a matching SEO
 * project for any client that doesn't have one yet (dedup by canonical client
 * id). Never duplicates a project or reaches into MTOS storage directly.
 */
export async function syncClientsFromMtos(tenantId: string): Promise<SyncClientsResult> {
  const roster = await getMtosClients(tenantId);
  if (!roster.ok) {
    return {
      configured: roster.configured,
      ok: false,
      created: 0,
      skipped: 0,
      total: 0,
      error: roster.error ?? "gateway_unavailable",
    };
  }

  const repo = getProjectRepo();
  let created = 0;
  let skipped = 0;
  for (const client of roster.clients) {
    const existing = await repo.findByClient(tenantId, client.id);
    if (existing) {
      skipped += 1;
      continue;
    }
    const now = nowIso();
    await repo.save(
      SeoProjectV1.parse({
        schemaVersion: 1,
        id: newId("proj"),
        tenantId,
        clientId: client.id,
        businessName: client.name,
        website: client.website,
        stage: "intake",
        health: "healthy",
        assignments: { supportingUserIds: [] },
        priority: "normal",
        targetLocations: client.location ? [client.location] : [],
        goals: [],
        setupReadiness: 10,
        createdAt: now,
        updatedAt: now,
      }),
    );
    created += 1;
  }
  return { configured: true, ok: true, created, skipped, total: roster.clients.length };
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
