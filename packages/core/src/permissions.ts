import type {
  ClientVisibility,
  PermissionScope,
} from "@cie/contracts";

/**
 * Role → permission mapping and authorization helpers shared by both apps.
 * Pure functions only; the caller supplies the resolved roles/visibility.
 *
 * Authorization is always the full chain: authn + tenant + client visibility +
 * app membership + specific permission. These helpers cover the last two links;
 * tenant/authn are enforced upstream.
 */

const ALL: PermissionScope[] = [
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
];

/** Effective permissions per role (MTOS + SEOOS roles in one table). */
export const ROLE_PERMISSIONS: Record<string, PermissionScope[]> = {
  // --- MTOS roles ---
  account_manager: [
    "seo.request.create",
    "seo.package.read",
    "lead_call.read",
    "lead_call.play_recording",
    "lead_call.verify",
  ],
  manager: [
    "seo.request.create",
    "seo.package.read",
    "seo.work.approve",
    "lead_call.read",
    "lead_call.play_recording",
    "lead_call.verify",
  ],
  qa_reviewer: ["seo.package.read", "seo.package.qa", "lead_call.read"],
  // --- SEOOS roles ---
  seo_specialist: [
    "seo.request.create",
    "seo.request.fulfill",
    "seo.package.read",
    "seo.project.manage",
    "lead_call.read",
    "lead_call.play_recording",
    "lead_call.verify",
  ],
  seo_lead: [
    "seo.request.create",
    "seo.request.fulfill",
    "seo.package.read",
    "seo.package.qa",
    "seo.package.deliver",
    "seo.work.approve",
    "seo.project.manage",
    "integrations.manage",
    "lead_call.read",
    "lead_call.play_recording",
    "lead_call.verify",
  ],
  seo_manager: [
    "seo.request.create",
    "seo.request.fulfill",
    "seo.package.read",
    "seo.package.qa",
    "seo.package.deliver",
    "seo.work.approve",
    "seo.project.manage",
    "integrations.manage",
    "lead_call.read",
    "lead_call.play_recording",
    "lead_call.verify",
  ],
  seo_qa: [
    "seo.package.read",
    "seo.package.qa",
    "lead_call.read",
  ],
  // tenant_admin administers both apps.
  tenant_admin: ALL,
};

/** Resolve the effective permission set for a set of roles + explicit grants. */
export function computePermissions(
  roles: readonly string[],
  extraPermissions: readonly PermissionScope[] = [],
): PermissionScope[] {
  const set = new Set<PermissionScope>(extraPermissions);
  for (const role of roles) {
    for (const p of ROLE_PERMISSIONS[role] ?? []) set.add(p);
  }
  return [...set];
}

export function hasPermission(
  permissions: readonly PermissionScope[],
  required: PermissionScope,
): boolean {
  return permissions.includes(required);
}

/** Client-visibility check. "all" sees every client in the tenant. */
export function canAccessClient(
  visibility: ClientVisibility,
  clientId: string,
): boolean {
  return visibility === "all" || visibility.includes(clientId);
}

/** Thrown by requirePermission; carries a stable code for API layers. */
export class AuthzError extends Error {
  readonly code:
    | "forbidden_permission"
    | "forbidden_client"
    | "forbidden_app";
  constructor(
    code: AuthzError["code"],
    message: string,
  ) {
    super(message);
    this.name = "AuthzError";
    this.code = code;
  }
}

export function requirePermission(
  permissions: readonly PermissionScope[],
  required: PermissionScope,
): void {
  if (!hasPermission(permissions, required)) {
    throw new AuthzError(
      "forbidden_permission",
      `Missing required permission: ${required}`,
    );
  }
}

export function requireClientAccess(
  visibility: ClientVisibility,
  clientId: string,
): void {
  if (!canAccessClient(visibility, clientId)) {
    throw new AuthzError(
      "forbidden_client",
      `No visibility for client: ${clientId}`,
    );
  }
}
