import { z } from "zod";
import {
  Confidence,
  EvidenceRefV1,
  zClientId,
  zIsoTimestamp,
  zTenantId,
  zUserId,
} from "@cie/contracts";

/** Recommendation categories (see assignment §I). */
export const RecommendationType = z.enum([
  "keyword",
  "grid_local_visibility",
  "gbp_category_service",
  "gbp_post",
  "review_reputation",
  "technical_seo",
  "on_page_content",
  "schema",
  "internal_linking",
  "image_optimization",
  "competitor_gap",
  "conversion_lead_quality",
  "data_quality",
]);
export type RecommendationType = z.infer<typeof RecommendationType>;

/** Lifecycle: proposed → approved → converted, with reject/defer branches. */
export const RecommendationStatus = z.enum([
  "proposed",
  "approved",
  "rejected",
  "deferred",
  "converted",
]);
export type RecommendationStatus = z.infer<typeof RecommendationStatus>;

export const RECOMMENDATION_TRANSITIONS: Record<
  RecommendationStatus,
  ReadonlyArray<RecommendationStatus>
> = {
  proposed: ["approved", "rejected", "deferred"],
  approved: ["converted", "rejected"],
  deferred: ["proposed", "approved", "rejected"],
  rejected: ["proposed"],
  converted: [],
};

export function canDecideRecommendation(
  from: RecommendationStatus,
  to: RecommendationStatus,
): boolean {
  return RECOMMENDATION_TRANSITIONS[from].includes(to);
}

export const RecommendationDecisionEntry = z.object({
  at: zIsoTimestamp,
  actorUserId: zUserId,
  from: RecommendationStatus,
  to: RecommendationStatus,
  reason: z.string().max(1000).optional(),
});
export type RecommendationDecisionEntry = z.infer<typeof RecommendationDecisionEntry>;

export const RecommendationV1 = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  tenantId: zTenantId,
  projectId: z.string().min(1),
  clientId: zClientId,
  type: RecommendationType,
  title: z.string().min(1),
  rationale: z.string().min(1),
  /** Why it matters to the client, in plain language (required for client-facing types). */
  clientSafeExplanation: z.string().optional(),
  /**
   * Plain-language reason for a CHANGE this makes to what the client had
   * (e.g. switching a primary GBP category/service). Surfaced in reports so
   * category/service changes never confuse the client (Phase 1/2 fix).
   */
  changeExplanation: z.string().optional(),
  evidence: z.array(EvidenceRefV1).default([]),
  expectedImpact: z.enum(["low", "medium", "high"]).default("medium"),
  confidence: Confidence.default("medium"),
  estimatedEffort: z.enum(["s", "m", "l"]).default("m"),
  dependencies: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  requiresApproval: z.boolean().default(false),
  status: RecommendationStatus.default("proposed"),
  owner: zUserId.optional(),
  targetDate: zIsoTimestamp.optional(),
  /** Set when converted to a work order. */
  workOrderId: z.string().optional(),
  decisions: z.array(RecommendationDecisionEntry).default([]),
  /** How this was produced ("ai" via Prompt Engine, or "manual"). */
  source: z.enum(["ai", "manual"]).default("manual"),
  createdAt: zIsoTimestamp,
  updatedAt: zIsoTimestamp,
});
export type RecommendationV1 = z.infer<typeof RecommendationV1>;

export const CreateRecommendationInput = z.object({
  projectId: z.string().min(1),
  clientId: zClientId,
  type: RecommendationType,
  title: z.string().min(1),
  rationale: z.string().min(1),
  clientSafeExplanation: z.string().optional(),
  expectedImpact: z.enum(["low", "medium", "high"]).default("medium"),
  confidence: Confidence.default("medium"),
  estimatedEffort: z.enum(["s", "m", "l"]).default("m"),
  requiresApproval: z.boolean().default(false),
});
export type CreateRecommendationInput = z.infer<typeof CreateRecommendationInput>;
