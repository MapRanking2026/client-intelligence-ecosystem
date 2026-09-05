import {
  CreateRecommendationInput,
  RecommendationV1,
  canDecideRecommendation,
  type RecommendationStatus,
  type RecommendationType,
} from "@/src/lib/domain/recommendation";
import type { WorkOrderType, WorkOrderV1 } from "@/src/lib/domain/work-order";
import { newId, nowIso } from "@/src/lib/ids";
import { getRecommendationRepo } from "@/src/lib/server/repositories/recommendation-repo";
import { createWorkOrder } from "@/src/lib/server/workorders-service";

const REC_TO_WORK_ORDER: Record<RecommendationType, WorkOrderType> = {
  keyword: "keyword_setup",
  grid_local_visibility: "grid_scan",
  gbp_category_service: "gbp_optimization",
  gbp_post: "gbp_optimization",
  review_reputation: "review_operation",
  technical_seo: "technical_fix",
  on_page_content: "content_on_page",
  schema: "schema",
  internal_linking: "content_on_page",
  image_optimization: "content_on_page",
  competitor_gap: "investigation",
  conversion_lead_quality: "investigation",
  data_quality: "investigation",
};

export async function listRecommendations(tenantId: string, projectId: string) {
  return getRecommendationRepo().listByProject(tenantId, projectId);
}

export async function getRecommendation(tenantId: string, id: string) {
  return getRecommendationRepo().get(tenantId, id);
}

export async function createRecommendation(
  tenantId: string,
  input: CreateRecommendationInput,
): Promise<RecommendationV1> {
  const parsed = CreateRecommendationInput.parse(input);
  const now = nowIso();
  const rec = RecommendationV1.parse({
    schemaVersion: 1,
    id: newId("rec"),
    tenantId,
    projectId: parsed.projectId,
    clientId: parsed.clientId,
    type: parsed.type,
    title: parsed.title,
    rationale: parsed.rationale,
    clientSafeExplanation: parsed.clientSafeExplanation,
    expectedImpact: parsed.expectedImpact,
    confidence: parsed.confidence,
    estimatedEffort: parsed.estimatedEffort,
    requiresApproval: parsed.requiresApproval,
    status: "proposed",
    source: "manual",
    createdAt: now,
    updatedAt: now,
  });
  return getRecommendationRepo().save(rec);
}

/** Approve / reject / defer / re-propose a recommendation, recording the decision. */
export async function decideRecommendation(
  tenantId: string,
  id: string,
  to: RecommendationStatus,
  actorUserId: string,
  reason: string | undefined,
): Promise<RecommendationV1> {
  const repo = getRecommendationRepo();
  const rec = await repo.get(tenantId, id);
  if (!rec) throw new Error(`Recommendation not found: ${id}`);
  if (to === "converted") throw new Error("Use convertToWorkOrder to convert");
  if (!canDecideRecommendation(rec.status, to)) {
    throw new Error(`Illegal recommendation decision ${rec.status} → ${to}`);
  }
  const now = nowIso();
  return repo.save({
    ...rec,
    status: to,
    updatedAt: now,
    decisions: [
      ...rec.decisions,
      { at: now, actorUserId, from: rec.status, to, reason },
    ],
  });
}

export interface ConvertResult {
  recommendation: RecommendationV1;
  workOrder: WorkOrderV1;
}

/** Convert an approved recommendation into a work order (human-gated action). */
export async function convertToWorkOrder(
  tenantId: string,
  id: string,
  actorUserId: string,
): Promise<ConvertResult> {
  const repo = getRecommendationRepo();
  const rec = await repo.get(tenantId, id);
  if (!rec) throw new Error(`Recommendation not found: ${id}`);
  if (rec.status !== "approved") {
    throw new Error("Only an approved recommendation can be converted");
  }
  const workOrder = await createWorkOrder(
    tenantId,
    {
      projectId: rec.projectId,
      clientId: rec.clientId,
      type: REC_TO_WORK_ORDER[rec.type],
      title: rec.title,
      scope: rec.rationale,
      sourceRecommendationId: rec.id,
      priority: rec.expectedImpact === "high" ? "high" : "normal",
      requiresApproval: rec.requiresApproval,
    },
    actorUserId,
  );
  const now = nowIso();
  const updated = await repo.save({
    ...rec,
    status: "converted",
    workOrderId: workOrder.id,
    updatedAt: now,
    decisions: [
      ...rec.decisions,
      { at: now, actorUserId, from: rec.status, to: "converted", reason: `Converted to ${workOrder.id}` },
    ],
  });
  return { recommendation: updated, workOrder };
}
