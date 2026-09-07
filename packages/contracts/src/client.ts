import { z } from "zod";

import { zClientId, zIsoTimestamp, zTenantId, zUserId } from "./common";

/**
 * The canonical Client — the single definition of a client for the whole
 * ecosystem. It lives in ONE system-of-record store owned by the brain
 * (@cie/brain); MTOS and SEOOS read client truth through the brain's service,
 * never from ClickUp or a local copy. See docs/architecture (The Client Brain).
 *
 * Every field carries provenance so the brain knows which system is currently
 * authoritative for it. During the transition ClickUp originates most fields;
 * ownership flips to `cie` field-by-field as the brain becomes the front-door.
 */

export const ClientLifecycleStage = z.enum([
  "lead",
  "onboarding",
  "active",
  "paused",
  "offboarding",
  "churned",
  "unknown",
]);
export type ClientLifecycleStage = z.infer<typeof ClientLifecycleStage>;

/** Which system is authoritative for a field right now. */
export const ClientFieldSource = z.enum(["clickup", "cie", "mtos", "seoos"]);
export type ClientFieldSource = z.infer<typeof ClientFieldSource>;

export const FieldProvenanceV1 = z.object({
  source: ClientFieldSource,
  updatedAt: zIsoTimestamp,
  updatedBy: zUserId.optional(),
});
export type FieldProvenanceV1 = z.infer<typeof FieldProvenanceV1>;

export const ClientV1 = z.object({
  schemaVersion: z.literal(1),
  /** Canonical id (brain's own namespace). Source ids live in externalIds. */
  id: zClientId,
  tenantId: zTenantId,

  businessName: z.string().min(1),
  website: z.string().optional(),
  phone: z.string().optional(),
  niche: z.string().optional(),
  locations: z.array(z.string()).default([]),

  stage: ClientLifecycleStage.default("unknown"),
  status: z.string().optional(),
  packageName: z.string().optional(),

  accountManager: z.string().optional(),
  seoSpecialist: z.string().optional(),
  pod: z.string().optional(),
  healthScore: z.string().optional(),

  /** Ids in external systems: clickupTaskId, gbpLocationId, ghlContactId, … */
  externalIds: z.record(z.string(), z.string()).default({}),
  /** Curated display metrics (label → value). */
  metrics: z.record(z.string(), z.string()).default({}),

  /** Which source systems contributed to this record (e.g. "clickup:seo-dashboard"). */
  sources: z.array(z.string()).default([]),
  /** Per-field authority: field name → provenance. */
  provenance: z.record(z.string(), FieldProvenanceV1).default({}),

  createdAt: zIsoTimestamp,
  updatedAt: zIsoTimestamp,
});
export type ClientV1 = z.infer<typeof ClientV1>;

/**
 * What an ingestion adapter emits per source record (one ClickUp task, one CRM
 * row, …). The brain reconciles many of these into canonical ClientV1 records.
 */
export const NormalizedClientInput = z.object({
  /** Stable source label, e.g. "clickup:seo-dashboard" or "clickup:health-tracker". */
  source: z.string().min(1),
  /** The record's id in that source (e.g. the ClickUp task id). */
  sourceRecordId: z.string().min(1),

  businessName: z.string().min(1),
  website: z.string().optional(),
  phone: z.string().optional(),
  niche: z.string().optional(),
  locations: z.array(z.string()).default([]),

  stage: ClientLifecycleStage.optional(),
  status: z.string().optional(),
  packageName: z.string().optional(),

  accountManager: z.string().optional(),
  seoSpecialist: z.string().optional(),
  pod: z.string().optional(),
  healthScore: z.string().optional(),

  externalIds: z.record(z.string(), z.string()).default({}),
  metrics: z.record(z.string(), z.string()).default({}),
});
export type NormalizedClientInput = z.infer<typeof NormalizedClientInput>;

/** One field where two or more sources disagree on a non-empty value. */
export const ClientFieldConflictV1 = z.object({
  clientId: z.string(),
  businessName: z.string(),
  field: z.string(),
  values: z.array(z.object({ source: z.string(), value: z.string() })),
});
export type ClientFieldConflictV1 = z.infer<typeof ClientFieldConflictV1>;

/**
 * The output of an ingest+reconcile pass. Shows how many raw records collapsed
 * into canonical clients, which clients appear in more than one source, and
 * every field-level disagreement — surfaced, never silently overwritten.
 */
export const ClientReconciliationReportV1 = z.object({
  schemaVersion: z.literal(1),
  tenantId: zTenantId,
  generatedAt: zIsoTimestamp,
  sourcesIngested: z.array(z.object({ source: z.string(), records: z.number().int() })),
  totalInputs: z.number().int(),
  canonicalClients: z.number().int(),
  /** Raw records that merged into an existing canonical record (duplicates collapsed). */
  merged: z.number().int(),
  /** Canonical clients present in more than one source. */
  matchedAcrossSources: z.number().int(),
  /** Canonical clients present in exactly one source. */
  singleSource: z.number().int(),
  conflicts: z.array(ClientFieldConflictV1),
});
export type ClientReconciliationReportV1 = z.infer<typeof ClientReconciliationReportV1>;
