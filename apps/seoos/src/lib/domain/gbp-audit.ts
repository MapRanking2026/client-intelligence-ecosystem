import { z } from "zod";
import { zIsoTimestamp, zTenantId, zUserId } from "@cie/contracts";

/** A GBP audit draft generated for one client — staged in SEOOS, never published. */
export const GbpAuditV1 = z.object({
  schemaVersion: z.literal(1),
  tenantId: zTenantId,
  projectId: z.string().min(1),
  clientId: z.string().min(1),
  /** The generated audit document (sectioned text; may contain NEEDS INFO lines). */
  content: z.string(),
  /** Note about which inputs were/weren't available when it was generated. */
  dataNote: z.string().optional(),
  model: z.string().optional(),
  generatedByUserId: zUserId.optional(),
  generatedAt: zIsoTimestamp,
});
export type GbpAuditV1 = z.infer<typeof GbpAuditV1>;
