import { z } from "zod";
import {
  AppId,
  PageRequest,
  SortDirection,
  zClientId,
  zId,
  zIsoTimestamp,
  zTenantId,
  zUserId,
} from "./common";

/**
 * Canonical Lead & Call Verification model — ONE record + service shared by
 * MTOS (full experience) and SEOOS (authorized read/edit of the *same* record).
 *
 * Recording playback stays behind the existing protected proxy: this contract
 * carries only an opaque `recordingRef`, never agency tokens or durable raw URLs.
 */

export const LeadChannel = z.enum([
  "call",
  "form",
  "chat",
  "email",
  "sms",
  "other",
]);
export type LeadChannel = z.infer<typeof LeadChannel>;

/** Verification/classification state. Changes are audited and cross-app visible. */
export const VerificationStatus = z.enum([
  "unverified",
  "needs_review",
  "verified_good_lead",
  "verified_bad_lead",
  "spam",
  "duplicate",
]);
export type VerificationStatus = z.infer<typeof VerificationStatus>;

/** Minimal, redacted contact surface — never full PII in transit. */
export const RedactedContactV1 = z.object({
  displayName: z.string().optional(),
  maskedPhone: z.string().optional(),
  maskedEmail: z.string().optional(),
});
export type RedactedContactV1 = z.infer<typeof RedactedContactV1>;

/** One audited change to verification/classification. */
export const LeadCallAuditEntryV1 = z.object({
  at: zIsoTimestamp,
  actorUserId: zUserId,
  app: AppId,
  field: z.enum(["verificationStatus", "classification", "notes"]),
  previous: z.string().nullable(),
  next: z.string().nullable(),
  reason: z.string().max(500).optional(),
});
export type LeadCallAuditEntryV1 = z.infer<typeof LeadCallAuditEntryV1>;

export const LeadCallRecordV1 = z.object({
  schemaVersion: z.literal(1),
  id: zId,
  tenantId: zTenantId,
  clientId: zClientId,
  channel: LeadChannel,
  /**
   * Normalized event time used for ALL sorting: call start for calls,
   * creation/receipt for other leads. `null` when unknown/invalid — rendered
   * as "Date unavailable" and always sorted after records with a valid time.
   */
  occurredAt: zIsoTimestamp.nullable(),
  /** When the record entered our system (fallback display, not the sort key). */
  receivedAt: zIsoTimestamp,
  verificationStatus: VerificationStatus.default("unverified"),
  /** Free-form classification label (agency taxonomy), if set. */
  classification: z.string().optional(),
  sourceProvider: zId,
  /** Opaque handle for authorized recording playback via the protected proxy. */
  recordingRef: zId.nullable().default(null),
  contact: RedactedContactV1.default({}),
  audit: z.array(LeadCallAuditEntryV1).default([]),
});
export type LeadCallRecordV1 = z.infer<typeof LeadCallRecordV1>;

/** Server-side filters applied before pagination. */
export const LeadCallFilterV1 = z.object({
  clientId: zClientId.optional(),
  channel: LeadChannel.optional(),
  verificationStatus: VerificationStatus.optional(),
  /** Inclusive lower bound on occurredAt. */
  since: zIsoTimestamp.optional(),
  /** Exclusive upper bound on occurredAt. */
  until: zIsoTimestamp.optional(),
});
export type LeadCallFilterV1 = z.infer<typeof LeadCallFilterV1>;

/**
 * List query for either app. Sort is applied server-side BEFORE
 * pagination/cursor so pages are stable across both apps.
 */
export const LeadCallListQueryV1 = PageRequest.extend({
  sort: SortDirection.default("newest_first"),
  filter: LeadCallFilterV1.default({}),
});
export type LeadCallListQueryV1 = z.infer<typeof LeadCallListQueryV1>;

/** Request to change verification/classification (writes an audit entry). */
export const LeadCallVerificationChangeV1 = z.object({
  recordId: zId,
  app: AppId,
  actorUserId: zUserId,
  verificationStatus: VerificationStatus.optional(),
  classification: z.string().optional(),
  reason: z.string().max(500).optional(),
});
export type LeadCallVerificationChangeV1 = z.infer<
  typeof LeadCallVerificationChangeV1
>;
