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
  "keyword-ranking-summary",
  "grid-heatmap-analysis",
  "gbp-performance",
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
