import { z } from "zod";
import { zIsoTimestamp, zTenantId } from "@cie/contracts";

/**
 * An SEO specialist in the roster — the unit clients are grouped under. Managed
 * by admins (add / edit / remove), independent of login. When a person signs up
 * with a matching email, their session is scoped to this specialist's clients.
 */
export const SpecialistV1 = z.object({
  schemaVersion: z.literal(1),
  tenantId: zTenantId,
  /** Stable id (slug). Firestore doc id; referenced by project.assignedSpecialistId. */
  id: z.string().min(1),
  name: z.string().min(1),
  /** Login email used to link a signed-up user to this specialist. */
  email: z.string().email().optional(),
  active: z.boolean().default(true),
  createdAt: zIsoTimestamp,
  updatedAt: zIsoTimestamp,
});
export type SpecialistV1 = z.infer<typeof SpecialistV1>;

export function specialistSlug(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "spec"
  );
}
