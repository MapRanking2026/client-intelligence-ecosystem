import { z } from "zod";
import {
  ReportingPeriodV1,
  zClientId,
  zCorrelationId,
  zId,
  zIdempotencyKey,
  zIsoTimestamp,
  zTenantId,
} from "./common";
import { Confidence, DataGapV1, EvidenceRefV1 } from "./evidence";
import { SeoCapabilityId } from "./seo-request";

/**
 * SeoIntelligencePackageV1 — the immutable, versioned answer to a request.
 *
 * Corrections never mutate: they produce a new `version` that records the
 * `supersedesVersion` it replaces. A legacy adapter maps this into the existing
 * MTOS prep-pack so MTOS keeps working during migration.
 */

/** A rendered section of a package. Payload is redacted/aggregate only. */
export const SeoPackageSectionV1 = z.object({
  key: zId,
  title: z.string().min(1),
  kind: z.enum([
    "summary",
    "ranking",
    "grid-heatmap",
    "gbp-performance",
    "narrative",
    "custom",
  ]),
  /** Presentation-ready, non-sensitive payload for this section. */
  data: z.record(z.string(), z.unknown()).default({}),
  evidence: z.array(EvidenceRefV1).default([]),
  confidence: Confidence.default("medium"),
});
export type SeoPackageSectionV1 = z.infer<typeof SeoPackageSectionV1>;

export const SeoIntelligencePackageV1 = z.object({
  schemaVersion: z.literal(1),
  id: zId,
  requestId: zId,
  tenantId: zTenantId,
  clientId: zClientId,
  capability: SeoCapabilityId,
  /** Monotonic per (requestId); corrections increment this. */
  version: z.number().int().min(1),
  supersedesVersion: z.number().int().min(1).nullable().default(null),
  reportingPeriod: ReportingPeriodV1,
  sections: z.array(SeoPackageSectionV1).default([]),
  dataGaps: z.array(DataGapV1).default([]),
  overallConfidence: Confidence.default("medium"),
  correlationId: zCorrelationId,
  idempotencyKey: zIdempotencyKey,
  producedAt: zIsoTimestamp,
});
export type SeoIntelligencePackageV1 = z.infer<typeof SeoIntelligencePackageV1>;
