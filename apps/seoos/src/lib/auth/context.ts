import {
  AuthzContextV1,
  type AppMembershipV1,
  type PermissionScope,
} from "@cie/contracts";
import { computePermissions } from "@cie/core";

import { getServerEnv } from "@/src/lib/server/env";
import { getMembershipRepo } from "@/src/lib/server/repositories/membership-repo";
import {
  tryGetSessionFromNextCookies,
  tryGetSessionFromRequest,
  type SessionPayload,
} from "@/src/lib/auth/session-cookie";

/**
 * SEOOS authorization resolution. In seed/dev mode (MTOS_USE_SEED_DATA) a
 * tenant_admin seed session is assumed so the app is fully exercisable without
 * credentials. Otherwise the shared session cookie is verified and the user's
 * SEOOS app membership is looked up — absence means no SEOOS access.
 */
const SEED_USER_ID = "seed-admin";

async function resolveSession(
  request?: Request,
): Promise<SessionPayload | null> {
  return request
    ? tryGetSessionFromRequest(request)
    : tryGetSessionFromNextCookies();
}

function seedAuthz(): AuthzContextV1 {
  const env = getServerEnv();
  return AuthzContextV1.parse({
    tenantId: env.pilotTenantId,
    userId: SEED_USER_ID,
    app: "seoos",
    roles: ["tenant_admin"],
    permissions: computePermissions(["tenant_admin"]),
    clientVisibility: "all",
  });
}

function membershipToAuthz(m: AppMembershipV1): AuthzContextV1 {
  return AuthzContextV1.parse({
    tenantId: m.tenantId,
    userId: m.userId,
    app: "seoos",
    roles: m.roles,
    permissions: computePermissions(m.roles, m.extraPermissions),
    clientVisibility: m.clientVisibility,
  });
}

/**
 * Returns the resolved SEOOS authorization context, or null when the caller is
 * authenticated to the tenant but has no SEOOS membership. Callers treat null
 * as "permission denied" (never as an error).
 */
export async function resolveSeoAuthz(
  request?: Request,
): Promise<AuthzContextV1 | null> {
  const env = getServerEnv();
  const session = await resolveSession(request);

  if (!session) {
    // No verified session: only seed/dev mode grants a fallback identity.
    return env.useSeedData ? seedAuthz() : null;
  }

  const membership = await getMembershipRepo().getForUser(
    session.tenantId,
    session.userId,
    "seoos",
  );
  if (membership) return membershipToAuthz(membership);

  // Authenticated tenant_admin without an explicit membership still administers.
  if (session.role === "tenant_admin") {
    return AuthzContextV1.parse({
      tenantId: session.tenantId,
      userId: session.userId,
      app: "seoos",
      roles: ["tenant_admin"],
      permissions: computePermissions(["tenant_admin"]),
      clientVisibility: "all",
    });
  }

  // In seed mode, still allow (dev convenience); otherwise deny.
  return env.useSeedData ? seedAuthz() : null;
}

export function authzHas(
  authz: AuthzContextV1,
  permission: PermissionScope,
): boolean {
  return authz.permissions.includes(permission);
}
