import { z } from "zod";
import { ClientVisibility, zIsoTimestamp, zTenantId, zUserId } from "@cie/contracts";

/** A SEOOS login user. Credentials are stored hashed (scrypt salt + hash). */
export const SeoUserV1 = z.object({
  schemaVersion: z.literal(1),
  tenantId: zTenantId,
  userId: zUserId,
  email: z.string().email(),
  displayName: z.string().optional(),
  passwordSalt: z.string().min(1),
  passwordHash: z.string().min(1),
  roles: z.array(z.string().min(1)).min(1),
  clientVisibility: ClientVisibility.default("all"),
  disabled: z.boolean().default(false),
  createdAt: zIsoTimestamp,
  updatedAt: zIsoTimestamp,
});
export type SeoUserV1 = z.infer<typeof SeoUserV1>;
