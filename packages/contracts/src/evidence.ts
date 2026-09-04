import { z } from "zod";
import { zId, zIsoTimestamp } from "./common";

/**
 * Evidence, freshness, lineage, confidence and data-gap contracts.
 *
 * Packages never carry raw call audio or full PII — only redacted/aggregate
 * evidence references with enough lineage to explain where a number came from
 * and how fresh it is.
 */

export const Freshness = z.enum(["live", "cached", "stale", "unknown"]);
export type Freshness = z.infer<typeof Freshness>;

export const Confidence = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof Confidence>;

/** How aggressively a reference has been redacted before leaving the server. */
export const RedactionLevel = z.enum(["none", "redacted", "aggregate"]);
export type RedactionLevel = z.infer<typeof RedactionLevel>;

/** One hop in the derivation chain of a value (provider → transform → value). */
export const LineageStepV1 = z.object({
  source: zId,
  detail: z.string().max(280).optional(),
  at: zIsoTimestamp.optional(),
});
export type LineageStepV1 = z.infer<typeof LineageStepV1>;

export const EvidenceRefV1 = z.object({
  schemaVersion: z.literal(1),
  id: zId,
  /** Provider or internal system the evidence was drawn from. */
  sourceProvider: zId,
  /** Capability/section this evidence supports. */
  capability: zId.optional(),
  freshness: Freshness,
  collectedAt: zIsoTimestamp.optional(),
  confidence: Confidence.default("medium"),
  redactionLevel: RedactionLevel.default("redacted"),
  lineage: z.array(LineageStepV1).default([]),
});
export type EvidenceRefV1 = z.infer<typeof EvidenceRefV1>;

export const DataGapSeverity = z.enum(["info", "warning", "blocking"]);
export type DataGapSeverity = z.infer<typeof DataGapSeverity>;

export const DataGapV1 = z.object({
  schemaVersion: z.literal(1),
  /** What is missing (field, metric, or area). */
  area: z.string().min(1),
  reason: z.string().min(1),
  severity: DataGapSeverity.default("warning"),
});
export type DataGapV1 = z.infer<typeof DataGapV1>;
