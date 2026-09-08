import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AppDefinitionV1,
  AppMembershipV1,
  AuditEventV1,
  TenantAppInstallationV1,
  TenantV1,
} from "@cie/contracts";

/**
 * The CIE platform store — the shared home for tenants, memberships, the app
 * registry, app installations, and the audit log. Owned by the Client
 * Intelligence Engine layer; apps read it through PlatformService, never by
 * poking the tables directly. Two impls: in-memory (dev/tests) and Supabase.
 */
export interface PlatformStore {
  // Tenants
  getTenant(id: string): Promise<TenantV1 | null>;
  getTenantBySlug(slug: string): Promise<TenantV1 | null>;
  listTenants(): Promise<TenantV1[]>;
  saveTenant(t: TenantV1): Promise<void>;

  // Memberships (user ↔ tenant ↔ app)
  getMembership(tenantId: string, userId: string, appKey: string): Promise<AppMembershipV1 | null>;
  listMembershipsForUser(userId: string): Promise<AppMembershipV1[]>;
  saveMembership(m: AppMembershipV1): Promise<void>;

  // App registry + installations
  listAppDefinitions(): Promise<AppDefinitionV1[]>;
  saveAppDefinition(d: AppDefinitionV1): Promise<void>;
  getInstallation(tenantId: string, appKey: string): Promise<TenantAppInstallationV1 | null>;
  listInstallations(tenantId: string): Promise<TenantAppInstallationV1[]>;
  saveInstallation(i: TenantAppInstallationV1): Promise<void>;

  // Audit
  appendAudit(e: AuditEventV1): Promise<void>;
  listAudit(tenantId: string, limit?: number): Promise<AuditEventV1[]>;
}

/* ----------------------------- In-memory ----------------------------- */

export class InMemoryPlatformStore implements PlatformStore {
  private tenants = new Map<string, TenantV1>();
  private memberships = new Map<string, AppMembershipV1>();
  private appDefs = new Map<string, AppDefinitionV1>();
  private installs = new Map<string, TenantAppInstallationV1>();
  private audit: AuditEventV1[] = [];
  private mk(t: string, u: string, a: string) {
    return `${t}::${u}::${a}`;
  }

  async getTenant(id: string) {
    return this.tenants.get(id) ?? null;
  }
  async getTenantBySlug(slug: string) {
    return [...this.tenants.values()].find((t) => t.slug === slug) ?? null;
  }
  async listTenants() {
    return [...this.tenants.values()];
  }
  async saveTenant(t: TenantV1) {
    this.tenants.set(t.id, t);
  }

  async getMembership(tenantId: string, userId: string, appKey: string) {
    return this.memberships.get(this.mk(tenantId, userId, appKey)) ?? null;
  }
  async listMembershipsForUser(userId: string) {
    return [...this.memberships.values()].filter((m) => m.userId === userId);
  }
  async saveMembership(m: AppMembershipV1) {
    this.memberships.set(this.mk(m.tenantId, m.userId, m.app), m);
  }

  async listAppDefinitions() {
    return [...this.appDefs.values()];
  }
  async saveAppDefinition(d: AppDefinitionV1) {
    this.appDefs.set(d.key, d);
  }
  async getInstallation(tenantId: string, appKey: string) {
    return this.installs.get(`${tenantId}::${appKey}`) ?? null;
  }
  async listInstallations(tenantId: string) {
    return [...this.installs.values()].filter((i) => i.tenantId === tenantId);
  }
  async saveInstallation(i: TenantAppInstallationV1) {
    this.installs.set(`${i.tenantId}::${i.appKey}`, i);
  }

  async appendAudit(e: AuditEventV1) {
    this.audit.push(e);
  }
  async listAudit(tenantId: string, limit = 100) {
    return this.audit
      .filter((e) => e.tenantId === tenantId)
      .sort((a, b) => (b.occurredAt > a.occurredAt ? 1 : -1))
      .slice(0, limit);
  }
}

/* ----------------------------- Supabase ----------------------------- */

const one = <T,>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, row: unknown): T | null => {
  if (!row) return null;
  const r = schema.safeParse((row as { data: unknown }).data);
  return r.success ? (r.data as T) : null;
};

export class SupabasePlatformStore implements PlatformStore {
  constructor(private readonly db: SupabaseClient) {}

  async getTenant(id: string) {
    const { data, error } = await this.db.from("tenants").select("data").eq("id", id).maybeSingle();
    if (error) throw new Error(`platform getTenant: ${error.message}`);
    return one<TenantV1>(TenantV1, data);
  }
  async getTenantBySlug(slug: string) {
    const { data, error } = await this.db.from("tenants").select("data").eq("slug", slug).maybeSingle();
    if (error) throw new Error(`platform getTenantBySlug: ${error.message}`);
    return one<TenantV1>(TenantV1, data);
  }
  async listTenants() {
    const { data, error } = await this.db.from("tenants").select("data");
    if (error) throw new Error(`platform listTenants: ${error.message}`);
    return (data ?? []).map((r) => TenantV1.safeParse((r as { data: unknown }).data)).filter((r) => r.success).map((r) => r.data!);
  }
  async saveTenant(t: TenantV1) {
    const { error } = await this.db
      .from("tenants")
      .upsert({ id: t.id, slug: t.slug, data: t, updated_at: t.updatedAt }, { onConflict: "id" });
    if (error) throw new Error(`platform saveTenant: ${error.message}`);
  }

  async getMembership(tenantId: string, userId: string, appKey: string) {
    const { data, error } = await this.db
      .from("tenant_memberships")
      .select("data")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .eq("app_key", appKey)
      .maybeSingle();
    if (error) throw new Error(`platform getMembership: ${error.message}`);
    return one<AppMembershipV1>(AppMembershipV1, data);
  }
  async listMembershipsForUser(userId: string) {
    const { data, error } = await this.db.from("tenant_memberships").select("data").eq("user_id", userId);
    if (error) throw new Error(`platform listMembershipsForUser: ${error.message}`);
    return (data ?? []).map((r) => AppMembershipV1.safeParse((r as { data: unknown }).data)).filter((r) => r.success).map((r) => r.data!);
  }
  async saveMembership(m: AppMembershipV1) {
    const { error } = await this.db
      .from("tenant_memberships")
      .upsert(
        { tenant_id: m.tenantId, user_id: m.userId, app_key: m.app, data: m, updated_at: m.updatedAt },
        { onConflict: "tenant_id,user_id,app_key" },
      );
    if (error) throw new Error(`platform saveMembership: ${error.message}`);
  }

  async listAppDefinitions() {
    const { data, error } = await this.db.from("app_definitions").select("data");
    if (error) throw new Error(`platform listAppDefinitions: ${error.message}`);
    return (data ?? []).map((r) => AppDefinitionV1.safeParse((r as { data: unknown }).data)).filter((r) => r.success).map((r) => r.data!);
  }
  async saveAppDefinition(d: AppDefinitionV1) {
    const { error } = await this.db
      .from("app_definitions")
      .upsert({ key: d.key, data: d, updated_at: d.updatedAt }, { onConflict: "key" });
    if (error) throw new Error(`platform saveAppDefinition: ${error.message}`);
  }
  async getInstallation(tenantId: string, appKey: string) {
    const { data, error } = await this.db
      .from("tenant_app_installations")
      .select("data")
      .eq("tenant_id", tenantId)
      .eq("app_key", appKey)
      .maybeSingle();
    if (error) throw new Error(`platform getInstallation: ${error.message}`);
    return one<TenantAppInstallationV1>(TenantAppInstallationV1, data);
  }
  async listInstallations(tenantId: string) {
    const { data, error } = await this.db.from("tenant_app_installations").select("data").eq("tenant_id", tenantId);
    if (error) throw new Error(`platform listInstallations: ${error.message}`);
    return (data ?? []).map((r) => TenantAppInstallationV1.safeParse((r as { data: unknown }).data)).filter((r) => r.success).map((r) => r.data!);
  }
  async saveInstallation(i: TenantAppInstallationV1) {
    const { error } = await this.db
      .from("tenant_app_installations")
      .upsert(
        { tenant_id: i.tenantId, app_key: i.appKey, data: i, updated_at: i.updatedAt },
        { onConflict: "tenant_id,app_key" },
      );
    if (error) throw new Error(`platform saveInstallation: ${error.message}`);
  }

  async appendAudit(e: AuditEventV1) {
    const { error } = await this.db
      .from("audit_events")
      .insert({ id: e.id, tenant_id: e.tenantId, occurred_at: e.occurredAt, data: e });
    if (error) throw new Error(`platform appendAudit: ${error.message}`);
  }
  async listAudit(tenantId: string, limit = 100) {
    const { data, error } = await this.db
      .from("audit_events")
      .select("data")
      .eq("tenant_id", tenantId)
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`platform listAudit: ${error.message}`);
    return (data ?? []).map((r) => AuditEventV1.safeParse((r as { data: unknown }).data)).filter((r) => r.success).map((r) => r.data!);
  }
}
