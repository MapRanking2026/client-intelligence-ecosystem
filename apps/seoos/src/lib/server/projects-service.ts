import {
  CreateSeoProjectInput,
  SeoProjectV1,
  canTransitionProject,
  type SeoProjectStage,
} from "@/src/lib/domain/project";
import { newId, nowIso } from "@/src/lib/ids";
import { getProjectRepo } from "@/src/lib/server/repositories/project-repo";

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
