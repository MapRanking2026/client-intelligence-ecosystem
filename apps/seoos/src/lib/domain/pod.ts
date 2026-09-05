import { z } from "zod";
import { zIsoTimestamp, zTenantId, zUserId } from "@cie/contracts";

/**
 * An SEO Pod — a group of clients run by one SEO specialist. Pods are discovered
 * from ClickUp (the SEO Dashboard "⭐ Pod" field: Pod 1, Pod 2, Pod 3, Lone
 * Ranger, Custom SEO, …). An admin assigns each pod to a SEOOS user; a specialist
 * then sees every client whose pod is assigned to them.
 */
export const SeoPodV1 = z.object({
  schemaVersion: z.literal(1),
  tenantId: zTenantId,
  /** Stable, normalized key (lowercased pod name). Firestore doc id. */
  podKey: z.string().min(1),
  /** Display name exactly as it appears in ClickUp, e.g. "Pod 1". */
  name: z.string().min(1),
  /** The SEOOS user (specialist) who owns this pod, if assigned. */
  specialistUserId: zUserId.optional(),
  createdAt: zIsoTimestamp,
  updatedAt: zIsoTimestamp,
});
export type SeoPodV1 = z.infer<typeof SeoPodV1>;

/** Normalize a pod name to its stable key: lowercase, single-spaced. */
export function normalizePodKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
