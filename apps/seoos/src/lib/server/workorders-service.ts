import {
  CreateWorkOrderInput,
  WorkOrderV1,
  canTransitionWorkOrder,
  type QaResult,
  type WorkOrderStatus,
} from "@/src/lib/domain/work-order";
import { newId, nowIso } from "@/src/lib/ids";
import { getWorkOrderRepo } from "@/src/lib/server/repositories/workorder-repo";

export async function listWorkOrders(tenantId: string, projectId?: string) {
  const repo = getWorkOrderRepo();
  return projectId ? repo.listByProject(tenantId, projectId) : repo.listByTenant(tenantId);
}

export async function getWorkOrder(tenantId: string, id: string) {
  return getWorkOrderRepo().get(tenantId, id);
}

export async function createWorkOrder(
  tenantId: string,
  input: CreateWorkOrderInput,
  actorUserId: string,
): Promise<WorkOrderV1> {
  const parsed = CreateWorkOrderInput.parse(input);
  const now = nowIso();
  const wo = WorkOrderV1.parse({
    schemaVersion: 1,
    id: newId("wo"),
    tenantId,
    projectId: parsed.projectId,
    clientId: parsed.clientId,
    type: parsed.type,
    title: parsed.title,
    scope: parsed.scope,
    sourceRecommendationId: parsed.sourceRecommendationId,
    priority: parsed.priority,
    status: "backlog",
    requiresApproval: parsed.requiresApproval,
    activity: [{ at: now, actorUserId, kind: "created", detail: "Work order created" }],
    createdAt: now,
    updatedAt: now,
  });
  return getWorkOrderRepo().save(wo);
}

export async function transitionWorkOrder(
  tenantId: string,
  id: string,
  to: WorkOrderStatus,
  actorUserId: string,
): Promise<WorkOrderV1> {
  const repo = getWorkOrderRepo();
  const wo = await repo.get(tenantId, id);
  if (!wo) throw new Error(`Work order not found: ${id}`);
  if (!canTransitionWorkOrder(wo.status, to)) {
    throw new Error(`Illegal work-order transition ${wo.status} → ${to}`);
  }
  const now = nowIso();
  return repo.save({
    ...wo,
    status: to,
    updatedAt: now,
    activity: [
      ...wo.activity,
      { at: now, actorUserId, kind: "status", detail: `${wo.status} → ${to}` },
    ],
  });
}

/** QA review of a work order that is ready_for_qa. Pass → completed; revision → revision_requested. */
export async function qaReviewWorkOrder(
  tenantId: string,
  id: string,
  result: QaResult,
  reviewerUserId: string,
  notes: string | undefined,
): Promise<WorkOrderV1> {
  const repo = getWorkOrderRepo();
  const wo = await repo.get(tenantId, id);
  if (!wo) throw new Error(`Work order not found: ${id}`);
  if (wo.status !== "ready_for_qa") {
    throw new Error("Work order is not ready for QA");
  }
  const now = nowIso();
  const nextStatus: WorkOrderStatus = result === "pass" ? "completed" : "revision_requested";
  return repo.save({
    ...wo,
    status: nextStatus,
    qa: { result, reviewerUserId, notes, at: now },
    updatedAt: now,
    activity: [
      ...wo.activity,
      { at: now, actorUserId: reviewerUserId, kind: "qa", detail: `QA ${result} → ${nextStatus}` },
    ],
  });
}
