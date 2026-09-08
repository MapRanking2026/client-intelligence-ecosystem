import { z } from "zod";

import { zClientId, zIsoTimestamp, zTenantId, zUserId } from "./common";

/**
 * Platform-owned records for the Client Intelligence Ecosystem (CIE).
 *
 * CIE is a multi-tenant, white-label platform. A TENANT is an agency (e.g. Map
 * Ranking). MTOS and SEOOS are APPLICATIONS activated inside a tenant — they do
 * NOT own tenants. The Client Intelligence Engine is the shared data layer that
 * powers all applications within a tenant. These records live in the shared
 * platform store (Supabase), not inside any one app.
 */

/** Platform-level roles are distinct from tenant roles (see identity.ts). */
export const PlatformRole = z.enum(["platform_super_admin"]);
export type PlatformRole = z.infer<typeof PlatformRole>;

export const TenantStatus = z.enum(["active", "suspended", "archived"]);
export type TenantStatus = z.infer<typeof TenantStatus>;

/** White-label surface — tenant data, never hard-coded in platform code. */
export const TenantBrandingV1 = z.object({
  logoUrl: z.string().optional(),
  primaryColor: z.string().optional(),
  accentColor: z.string().optional(),
  /** Tenant-specific terminology overrides (label key → display text). */
  terminology: z.record(z.string(), z.string()).default({}),
});
export type TenantBrandingV1 = z.infer<typeof TenantBrandingV1>;

export const TenantV1 = z.object({
  schemaVersion: z.literal(1),
  /** Canonical tenant id — stable, shared by every app for this agency. */
  id: zTenantId,
  /** URL-safe unique slug (e.g. "map-ranking"); used for domain/subdomain routing. */
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and hyphens only"),
  displayName: z.string().min(1),
  status: TenantStatus.default("active"),
  branding: TenantBrandingV1.default({ terminology: {} }),
  timezone: z.string().default("America/New_York"),
  locale: z.string().default("en-US"),
  /** Optional custom domain for white-label routing. */
  customDomain: z.string().optional(),
  /** Plan/entitlement label; billing detail lives elsewhere. */
  plan: z.string().optional(),
  /** Coarse feature flags at the tenant level (flag key → enabled). */
  featureFlags: z.record(z.string(), z.boolean()).default({}),
  createdAt: zIsoTimestamp,
  updatedAt: zIsoTimestamp,
});
export type TenantV1 = z.infer<typeof TenantV1>;

/**
 * An application DEFINITION — the catalog entry for a department OS. Distinct
 * from a tenant's installation of it. `key` is an open string (not a fixed enum)
 * so future/custom operating systems can be registered without a code change.
 */
export const AppDefinitionStatus = z.enum(["available", "beta", "deprecated"]);
export type AppDefinitionStatus = z.infer<typeof AppDefinitionStatus>;

export const AppDefinitionV1 = z.object({
  schemaVersion: z.literal(1),
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  status: AppDefinitionStatus.default("available"),
  version: z.number().int().min(1).default(1),
  createdAt: zIsoTimestamp,
  updatedAt: zIsoTimestamp,
});
export type AppDefinitionV1 = z.infer<typeof AppDefinitionV1>;

/** A tenant's activation of an app. Disabling never deletes canonical data. */
export const TenantAppInstallationV1 = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  tenantId: zTenantId,
  appKey: z.string().min(1),
  enabled: z.boolean().default(true),
  config: z.record(z.string(), z.unknown()).default({}),
  plan: z.string().optional(),
  enabledAt: zIsoTimestamp.optional(),
  disabledAt: zIsoTimestamp.optional(),
  createdAt: zIsoTimestamp,
  updatedAt: zIsoTimestamp,
});
export type TenantAppInstallationV1 = z.infer<typeof TenantAppInstallationV1>;

/**
 * Audit of a shared-data change routed through the Client Intelligence Engine.
 * Every canonical write records who, which app, what changed, and when.
 */
export const AuditEventV1 = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  tenantId: zTenantId,
  actorUserId: zUserId.optional(),
  /** Which application authored the change (app key). */
  sourceApp: z.string().min(1),
  eventType: z.string().min(1),
  clientId: zClientId.optional(),
  entity: z.string().optional(),
  entityId: z.string().optional(),
  previousValue: z.unknown().optional(),
  newValue: z.unknown().optional(),
  correlationId: z.string().optional(),
  occurredAt: zIsoTimestamp,
});
export type AuditEventV1 = z.infer<typeof AuditEventV1>;

/**
 * Seed catalog of application definitions. Only mtos + seoos are active now;
 * the rest are future placeholders so the registry + UI can list them without
 * any unfinished application logic.
 */
export const KNOWN_APP_DEFINITIONS: Array<Pick<AppDefinitionV1, "key" | "name" | "description" | "status">> = [
  { key: "mtos", name: "MTOS", description: "Account management & client communication.", status: "available" },
  { key: "seoos", name: "SEOOS", description: "SEO operations & delivery.", status: "available" },
  { key: "google-ads-os", name: "Google Ads OS", description: "Google Ads operations.", status: "beta" },
  { key: "meta-ads-os", name: "Meta Ads OS", description: "Meta Ads operations.", status: "beta" },
  { key: "webos", name: "WebOS", description: "Website build & maintenance operations.", status: "beta" },
  { key: "custom-os", name: "Custom OS", description: "Tenant-defined department operating system.", status: "beta" },
];
