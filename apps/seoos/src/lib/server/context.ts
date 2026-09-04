import type { SeoContext } from "@/src/lib/server/seo-engine";

/**
 * STUB auth for the vertical slice. The real SEOOS resolves authn + tenant
 * membership + client visibility + app membership + permission here (see
 * mtos-seoos-boundaries.md §4). Until then we derive a demo tenant from a
 * header so the slice is exercisable.
 */
export const DEMO_TENANT = "demo-tenant";

export function resolveSeoContext(request: Request): SeoContext {
  const tenantId = request.headers.get("x-tenant-id")?.trim() || DEMO_TENANT;
  const userId = request.headers.get("x-user-id")?.trim() || undefined;
  return { tenantId, userId, app: "seoos" };
}
