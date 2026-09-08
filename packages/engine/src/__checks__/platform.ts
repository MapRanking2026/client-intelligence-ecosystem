import type { AppMembershipV1, TenantV1 } from "@cie/contracts";

import { InMemoryPlatformStore } from "../platform-repo";
import { PlatformService } from "../platform-service";

/** Tenant-isolation + app-registry checks. Run via run.ts (npm test -w @cie/engine). */
let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures += 1;
    console.error("✗", msg);
  } else {
    console.log("✓", msg);
  }
}

const now = "2026-09-08T00:00:00.000Z";
const tenant = (id: string): TenantV1 => ({
  schemaVersion: 1,
  id,
  slug: id,
  displayName: id,
  status: "active",
  branding: { terminology: {} },
  timezone: "America/New_York",
  locale: "en-US",
  featureFlags: {},
  createdAt: now,
  updatedAt: now,
});
const membership = (tenantId: string, userId: string, app: "mtos" | "seoos"): AppMembershipV1 => ({
  schemaVersion: 1,
  tenantId,
  userId,
  app,
  roles: ["tenant_admin"],
  clientVisibility: "all",
  extraPermissions: [],
  createdAt: now,
  updatedAt: now,
});

export async function runPlatformChecks() {
  const store = new InMemoryPlatformStore();
  const svc = new PlatformService(store);

  await svc.saveTenant(tenant("map-ranking"));
  await svc.saveTenant(tenant("brown-media"));
  // Francisco belongs to Map Ranking, in BOTH apps.
  await svc.saveMembership(membership("map-ranking", "francisco", "mtos"));
  await svc.saveMembership(membership("map-ranking", "francisco", "seoos"));
  // A Brown Media user, only in that tenant.
  await svc.saveMembership(membership("brown-media", "dana", "seoos"));

  // Acceptance: MTOS and SEOOS resolve the SAME Map Ranking tenant for the same user.
  const viaMtos = await svc.resolveTenantAccess({ userId: "francisco", sessionTenantId: "map-ranking", appKey: "mtos" });
  const viaSeoos = await svc.resolveTenantAccess({ userId: "francisco", sessionTenantId: "map-ranking", appKey: "seoos" });
  assert(!!viaMtos && !!viaSeoos, "both apps resolve access for the Map Ranking user");
  assert(viaMtos?.tenant.id === "map-ranking" && viaSeoos?.tenant.id === "map-ranking", "both apps resolve the SAME tenant id");

  // Acceptance: a Brown Media user cannot resolve Map Ranking (no membership there).
  const crossTenant = await svc.resolveTenantAccess({ userId: "dana", sessionTenantId: "map-ranking", appKey: "seoos" });
  assert(crossTenant === null, "Brown Media user is denied Map Ranking (tenant isolation)");

  // Acceptance: even a Map Ranking user can't resolve a tenant they aren't a member of.
  const francToBrown = await svc.resolveTenantAccess({ userId: "francisco", sessionTenantId: "brown-media", appKey: "seoos" });
  assert(francToBrown === null, "membership in tenant A does not grant tenant B");

  // Acceptance: app gating is per-tenant and defaults off; enabling one tenant's app
  // does not enable it for another.
  await svc.setAppEnabled("map-ranking", "seoos", true, now);
  assert((await svc.isAppEnabled("map-ranking", "seoos")) === true, "SEOOS enabled for Map Ranking");
  assert((await svc.isAppEnabled("brown-media", "seoos")) === false, "SEOOS NOT auto-enabled for Brown Media");

  // Disabling an app does not delete anything else (flag-only).
  await svc.setAppEnabled("map-ranking", "seoos", false, now);
  assert((await svc.isAppEnabled("map-ranking", "seoos")) === false, "app can be disabled without data loss");
  assert((await svc.getTenant("map-ranking")) !== null, "tenant + its records survive app disable");

  // App registry seeding is idempotent.
  await svc.ensureAppDefinitions(
    [{ key: "mtos", name: "MTOS", description: "", status: "available" }, { key: "seoos", name: "SEOOS", description: "", status: "available" }],
    now,
  );
  await svc.ensureAppDefinitions([{ key: "mtos", name: "MTOS", description: "", status: "available" }], now);
  assert((await svc.listAppDefinitions()).length === 2, "app registry seed is idempotent (no duplicates)");

  // Audit append + read back, tenant-scoped.
  await svc.recordAudit({
    schemaVersion: 1,
    id: "aud-1",
    tenantId: "map-ranking",
    sourceApp: "seoos",
    eventType: "client.updated",
    occurredAt: now,
  });
  const audit = await svc.listAudit("map-ranking");
  assert(audit.length === 1 && audit[0].id === "aud-1", "audit event recorded + readable, tenant-scoped");
  assert((await svc.listAudit("brown-media")).length === 0, "audit is isolated per tenant");

  return failures;
}
