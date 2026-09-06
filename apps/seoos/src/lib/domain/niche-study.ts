import { z } from "zod";
import { zIsoTimestamp, zTenantId } from "@cie/contracts";

/**
 * A niche case study / playbook that grounds AI recommendations. Added manually
 * or imported from a Google Drive folder. Matched to a client by its niche.
 */
export const NicheStudyV1 = z.object({
  schemaVersion: z.literal(1),
  tenantId: zTenantId,
  id: z.string().min(1),
  /** Which niche this applies to (empty = general). */
  niche: z.string().optional(),
  title: z.string().min(1),
  content: z.string().min(1),
  source: z.enum(["manual", "drive"]).default("manual"),
  driveFileId: z.string().optional(),
  createdAt: zIsoTimestamp,
  updatedAt: zIsoTimestamp,
});
export type NicheStudyV1 = z.infer<typeof NicheStudyV1>;
