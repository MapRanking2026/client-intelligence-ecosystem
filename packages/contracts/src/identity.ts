import { z } from "zod";
import { AppId, zClientId, zIsoTimestamp, zTenantId, zUserId } from "./common";

/**
 * Identity, app-membership and permission contracts shared by MTOS and SEOOS.
 *
 * Memberships are ADDITIVE: existing MTOS users keep their access and nobody
 * gets SEOOS implicitly. Authorization is always: authn + tenant membership +
 * client visibility + app membership + specific permission. UI visibility is
 * never authorization.
 */

/** Existing MTOS roles (unchanged). */
export const MtosRole = z.enum([
  "account_manager",
  "manager",
  "qa_reviewer",
  "tenant_admin",
]);
export type MtosRole = z.infer<typeof MtosRole>;

/** SEOOS roles (new, additive). `tenant_admin` administers both apps. */
export const SeoRole = z.enum([
  "seo_specialist",
  "seo_lead",
  "seo_manager",
  "seo_qa",
  "tenant_admin",
]);
export type SeoRole = z.infer<typeof SeoRole>;

/** Fine-grained permission scopes. Granted via role→permission mapping in core. */
export const PermissionScope = z.enum([
  "seo.request.create",
  "seo.request.fulfill",
  "seo.package.qa",
  "seo.package.read",
  "seo.package.deliver",
  "seo.work.approve",
  "seo.project.manage",
  "lead_call.read",
  "lead_call.play_recording",
  "lead_call.verify",
  "integrations.manage",
  "settings.manage",
]);
export type PermissionScope = z.infer<typeof PermissionScope>;

/** "all" clients in the tenant, or an explicit allow-list of client ids. */
export const ClientVisibility = z.union([
  z.literal("all"),
  z.array(zClientId),
]);
export type ClientVisibility = z.infer<typeof ClientVisibility>;

/**
 * A user's membership in one app within a tenant. A user can hold separate
 * memberships in MTOS and SEOOS with different roles and client visibility.
 */
export const AppMembershipV1 = z.object({
  schemaVersion: z.literal(1),
  tenantId: zTenantId,
  userId: zUserId,
  app: AppId,
  /** Roles within this app; drive the effective permission set (see core). */
  roles: z.array(z.string().min(1)).min(1),
  clientVisibility: ClientVisibility.default("all"),
  /** Optional explicit extra grants beyond what roles imply. */
  extraPermissions: z.array(PermissionScope).default([]),
  createdAt: zIsoTimestamp,
  updatedAt: zIsoTimestamp,
});
export type AppMembershipV1 = z.infer<typeof AppMembershipV1>;

/** The resolved, request-time authorization view used by guards. */
export const AuthzContextV1 = z.object({
  tenantId: zTenantId,
  userId: zUserId,
  app: AppId,
  roles: z.array(z.string().min(1)),
  permissions: z.array(PermissionScope),
  clientVisibility: ClientVisibility,
});
export type AuthzContextV1 = z.infer<typeof AuthzContextV1>;
