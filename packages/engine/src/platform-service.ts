import {
  AppDefinitionV1,
  AppMembershipV1,
  AuditEventV1,
  TenantAppInstallationV1,
  TenantV1,
} from "@cie/contracts";

import type { PlatformStore } from "./platform-repo";

/** Result of resolving a user's access to a tenant+app. Null fields = denied. */
export interface TenantAccess {
  tenant: TenantV1;
  membership: AppMembershipV1;
}

/**
 * PlatformService — the shared tenant/app/audit layer every application goes
 * through. It enforces the core multi-tenant invariant: a tenant id is only
 * ever trusted after it is proven to belong to the authenticated user via a
 * membership row. A browser-supplied tenant id must NEVER be honored directly.
 */
export class PlatformService {
  constructor(private readonly store: PlatformStore) {}

  /**
   * Resolve a user's access to a tenant for a specific app. The caller passes
   * the tenant id from the AUTHENTICATED SESSION (never from a URL/param/body)
   * plus the userId and the app key. Returns the tenant + membership only when:
   *   - the tenant exists and is active, AND
   *   - the user holds a membership in THAT tenant for THAT app.
   * Otherwise returns null (access denied). This is the tenant-isolation gate:
   * a user with membership in tenant A can never resolve tenant B.
   */
  async resolveTenantAccess(input: {
    userId: string;
    sessionTenantId: string;
    appKey: string;
  }): Promise<TenantAccess | null> {
    const tenant = await this.store.getTenant(input.sessionTenantId);
    if (!tenant || tenant.status !== "active") return null;
    const membership = await this.store.getMembership(tenant.id, input.userId, input.appKey);
    if (!membership) return null;
    if (membership.tenantId !== tenant.id) return null; // defense-in-depth
    return { tenant, membership };
  }

  getTenant(id: string): Promise<TenantV1 | null> {
    return this.store.getTenant(id);
  }
  getTenantBySlug(slug: string): Promise<TenantV1 | null> {
    return this.store.getTenantBySlug(slug);
  }
  listTenants(): Promise<TenantV1[]> {
    return this.store.listTenants();
  }
  saveTenant(tenant: TenantV1): Promise<void> {
    return this.store.saveTenant(TenantV1.parse(tenant));
  }

  saveMembership(m: AppMembershipV1): Promise<void> {
    return this.store.saveMembership(AppMembershipV1.parse(m));
  }
  getMembership(tenantId: string, userId: string, appKey: string): Promise<AppMembershipV1 | null> {
    return this.store.getMembership(tenantId, userId, appKey);
  }

  /** Idempotently register the app catalog (safe to call repeatedly). */
  async ensureAppDefinitions(
    defs: Array<Pick<AppDefinitionV1, "key" | "name" | "description" | "status">>,
    now: string,
  ): Promise<void> {
    const existing = new Set((await this.store.listAppDefinitions()).map((d) => d.key));
    for (const d of defs) {
      if (existing.has(d.key)) continue;
      await this.store.saveAppDefinition(
        AppDefinitionV1.parse({ schemaVersion: 1, version: 1, createdAt: now, updatedAt: now, ...d }),
      );
    }
  }
  listAppDefinitions(): Promise<AppDefinitionV1[]> {
    return this.store.listAppDefinitions();
  }

  /** Whether an app is installed AND enabled for a tenant (default: not). */
  async isAppEnabled(tenantId: string, appKey: string): Promise<boolean> {
    const inst = await this.store.getInstallation(tenantId, appKey);
    return Boolean(inst?.enabled);
  }
  listInstallations(tenantId: string): Promise<TenantAppInstallationV1[]> {
    return this.store.listInstallations(tenantId);
  }

  async setAppEnabled(tenantId: string, appKey: string, enabled: boolean, now: string): Promise<void> {
    const prev = await this.store.getInstallation(tenantId, appKey);
    const base: TenantAppInstallationV1 = prev ?? {
      schemaVersion: 1,
      id: `${tenantId}:${appKey}`,
      tenantId,
      appKey,
      enabled,
      config: {},
      createdAt: now,
      updatedAt: now,
    };
    await this.store.saveInstallation(
      TenantAppInstallationV1.parse({
        ...base,
        enabled,
        enabledAt: enabled ? now : base.enabledAt,
        disabledAt: enabled ? base.disabledAt : now,
        updatedAt: now,
      }),
    );
    // Disabling an app never touches canonical client data — only this flag.
  }

  recordAudit(event: AuditEventV1): Promise<void> {
    return this.store.appendAudit(AuditEventV1.parse(event));
  }
  listAudit(tenantId: string, limit?: number): Promise<AuditEventV1[]> {
    return this.store.listAudit(tenantId, limit);
  }
}
