import { z } from "zod";
import { zClientId, zIsoTimestamp, zTenantId, zUserId } from "@cie/contracts";

/**
 * SeoProject — a SEOOS-owned engagement layered on top of a canonical MTOS
 * client. SEOOS owns the SEO lifecycle; MTOS still owns the client relationship.
 */
export const SeoProjectStage = z.enum([
  "draft",
  "intake",
  "connecting_data",
  "baseline_scan",
  "strategy",
  "implementation",
  "qa",
  "active",
  "paused",
  "completed",
  "archived",
]);
export type SeoProjectStage = z.infer<typeof SeoProjectStage>;

/** Legal forward transitions (pause/archive reachable from most active stages). */
export const SEO_PROJECT_TRANSITIONS: Record<
  SeoProjectStage,
  ReadonlyArray<SeoProjectStage>
> = {
  draft: ["intake", "archived"],
  intake: ["connecting_data", "paused", "archived"],
  connecting_data: ["baseline_scan", "intake", "paused", "archived"],
  baseline_scan: ["strategy", "connecting_data", "paused", "archived"],
  strategy: ["implementation", "paused", "archived"],
  implementation: ["qa", "active", "paused", "archived"],
  qa: ["active", "implementation", "paused", "archived"],
  active: ["implementation", "qa", "paused", "completed", "archived"],
  paused: ["active", "implementation", "archived"],
  completed: ["active", "archived"],
  archived: [],
};

export function canTransitionProject(
  from: SeoProjectStage,
  to: SeoProjectStage,
): boolean {
  return SEO_PROJECT_TRANSITIONS[from].includes(to);
}

export const SeoProjectHealth = z.enum([
  "healthy",
  "watch",
  "at_risk",
  "blocked",
]);
export type SeoProjectHealth = z.infer<typeof SeoProjectHealth>;

export const SeoProjectAssignments = z.object({
  seoSpecialistUserId: zUserId.optional(),
  seoLeadUserId: zUserId.optional(),
  qaReviewerUserId: zUserId.optional(),
  accountManagerUserId: zUserId.optional(),
  supportingUserIds: z.array(zUserId).default([]),
});
export type SeoProjectAssignments = z.infer<typeof SeoProjectAssignments>;

export const SeoProjectV1 = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  tenantId: zTenantId,
  /** The canonical MTOS client this project serves (never duplicated). */
  clientId: zClientId,
  businessName: z.string().min(1),
  website: z.string().optional(),
  /** Intake context that grounds AI recommendations (meeting: "max initial info"). */
  valueProposition: z.string().optional(),
  niche: z.string().optional(),
  stage: SeoProjectStage.default("draft"),
  health: SeoProjectHealth.default("healthy"),
  assignments: SeoProjectAssignments.default({ supportingUserIds: [] }),
  serviceTier: z.string().optional(),
  /** Individual services (from ClickUp ⭐ Services) = the projects run for this client. */
  services: z.array(z.string()).default([]),
  priority: z.enum(["normal", "high", "urgent"]).default("normal"),
  targetLocations: z.array(z.string()).default([]),
  goals: z.array(z.string()).default([]),
  startDate: zIsoTimestamp.optional(),
  renewalDate: zIsoTimestamp.optional(),
  notes: z.string().optional(),
  /** Provider-specific external ids (e.g. { clickupListId, rankTrackerBusinessId }). */
  externalIds: z.record(z.string(), z.string()).default({}),
  /** Curated SEO metrics pulled from the ClickUp SEO Dashboard (label -> value). */
  dashboardMetrics: z.record(z.string(), z.string()).default({}),
  /** Setup readiness 0-100, derived from mapped sources during intake. */
  setupReadiness: z.number().int().min(0).max(100).default(0),
  nextDeadlineAt: zIsoTimestamp.optional(),
  createdAt: zIsoTimestamp,
  updatedAt: zIsoTimestamp,
});
export type SeoProjectV1 = z.infer<typeof SeoProjectV1>;

/** Fields accepted when creating a project (server fills the rest). */
export const CreateSeoProjectInput = z.object({
  clientId: zClientId,
  businessName: z.string().min(1),
  website: z.string().optional(),
  valueProposition: z.string().optional(),
  niche: z.string().optional(),
  serviceTier: z.string().optional(),
  priority: z.enum(["normal", "high", "urgent"]).default("normal"),
  targetLocations: z.array(z.string()).default([]),
  goals: z.array(z.string()).default([]),
  assignments: SeoProjectAssignments.default({ supportingUserIds: [] }),
});
export type CreateSeoProjectInput = z.infer<typeof CreateSeoProjectInput>;
