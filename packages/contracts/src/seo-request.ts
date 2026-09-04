import { z } from "zod";
import {
  AppId,
  ReportingPeriodV1,
  zClientId,
  zCorrelationId,
  zId,
  zIdempotencyKey,
  zIsoTimestamp,
  zTenantId,
  zUserId,
} from "./common";

/**
 * SeoIntelligenceRequestV1 — MTOS (or a scheduler) asks SEOOS for a package.
 *
 * The idempotency key is tenant + client + monthlyTouch + capability preset/
 * version + reporting period, so re-running Monthly-Touch prep does not create
 * duplicate orders.
 */

export const SeoCapabilityId = z.enum([
  "full-monthly-package",
  "executive-seo-summary",
  "keyword-ranking-summary",
  "keyword-deep-dive",
  "grid-heatmap-analysis",
  "market-share-analysis",
  "gbp-performance",
  "map-checkin-activity",
  "review-management-summary",
  "competitor-analysis",
  "work-completed",
  "deliverables-status",
  "category-service-change-explanation",
  "website-technical-audit",
  "risks-and-blockers",
  "next-30-day-recommendations",
  "custom-question",
]);
export type SeoCapabilityId = z.infer<typeof SeoCapabilityId>;

export const SeoRequestStatus = z.enum([
  "draft",
  "submitted",
  "queued",
  "processing",
  "needs_input",
  "qa_review",
  "ready",
  "delivered",
  "failed",
  "cancelled",
]);
export type SeoRequestStatus = z.infer<typeof SeoRequestStatus>;

/** Legal forward transitions. `failed`/`cancelled` are terminal sinks. */
export const SEO_REQUEST_TRANSITIONS: Record<
  z.infer<typeof SeoRequestStatus>,
  ReadonlyArray<z.infer<typeof SeoRequestStatus>>
> = {
  draft: ["submitted", "cancelled"],
  submitted: ["queued", "cancelled", "failed"],
  queued: ["processing", "cancelled", "failed"],
  processing: ["needs_input", "qa_review", "failed"],
  needs_input: ["queued", "processing", "cancelled", "failed"],
  qa_review: ["ready", "processing", "failed"],
  ready: ["delivered", "failed"],
  delivered: [],
  failed: [],
  cancelled: [],
};

export function canTransition(
  from: SeoRequestStatus,
  to: SeoRequestStatus,
): boolean {
  return SEO_REQUEST_TRANSITIONS[from].includes(to);
}

/** One requested item from the capability catalog, with optional filters. */
export const SeoRequestLineItemV1 = z.object({
  capabilityId: SeoCapabilityId,
  capabilityVersion: z.number().int().min(1).default(1),
  keywordIds: z.array(zId).optional(),
  locationIds: z.array(zId).optional(),
  gbpProfileIds: z.array(zId).optional(),
  competitorIds: z.array(zId).optional(),
  instructions: z.string().max(2000).optional(),
});
export type SeoRequestLineItemV1 = z.infer<typeof SeoRequestLineItemV1>;

export const RequestPriority = z.enum(["normal", "high", "urgent"]);
export type RequestPriority = z.infer<typeof RequestPriority>;

export const IntendedAudience = z.enum([
  "internal",
  "account_manager",
  "client_ready",
]);
export type IntendedAudience = z.infer<typeof IntendedAudience>;

export const SeoIntelligenceRequestV1 = z.object({
  schemaVersion: z.literal(1),
  id: zId,
  tenantId: zTenantId,
  clientId: zClientId,
  /** Present when the request originates from a Monthly Touch prep. */
  monthlyTouchId: zId.optional(),
  capability: SeoCapabilityId,
  /** Version of the capability preset used to shape inputs/outputs. */
  presetVersion: z.number().int().min(1),
  reportingPeriod: ReportingPeriodV1,
  /** Optional prior period to compare against. */
  comparisonPeriod: ReportingPeriodV1.optional(),
  /**
   * Selected menu items with filters. Additive: when absent the single
   * `capability` above is the request. Fulfillment reads lineItems when present.
   */
  lineItems: z.array(SeoRequestLineItemV1).default([]),
  customQuestions: z.array(z.string().min(1)).default([]),
  intendedAudience: IntendedAudience.default("internal"),
  priority: RequestPriority.default("normal"),
  dueAt: zIsoTimestamp.optional(),
  /** Capability-specific parameters (validated by the capability catalog). */
  params: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: zIdempotencyKey,
  correlationId: zCorrelationId,
  status: SeoRequestStatus.default("draft"),
  requestedByApp: AppId,
  requestedByUserId: zUserId.optional(),
  createdAt: zIsoTimestamp,
  updatedAt: zIsoTimestamp,
});
export type SeoIntelligenceRequestV1 = z.infer<typeof SeoIntelligenceRequestV1>;

/** The fields that compose the idempotency key (see makeSeoRequestIdempotencyKey). */
export const SeoRequestIdentityV1 = z.object({
  tenantId: zTenantId,
  clientId: zClientId,
  monthlyTouchId: zId.optional(),
  capability: SeoCapabilityId,
  presetVersion: z.number().int().min(1),
  reportingPeriod: ReportingPeriodV1,
});
export type SeoRequestIdentityV1 = z.infer<typeof SeoRequestIdentityV1>;
