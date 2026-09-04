import type { TenantContext, Role } from "@/src/lib/contracts/mtos";
import { tryGetSessionFromNextCookies, tryGetSessionFromRequest } from "@/src/lib/auth/session-cookie";
import { getServerEnv } from "@/src/lib/server/env";

const defaultContext: TenantContext = {
  tenantId: "map-ranking",
  userId: "unknown",
  role: "account_manager",
};

const allowedRoles = new Set<Role>([
  "account_manager",
  "manager",
  "qa_reviewer",
  "tenant_admin",
]);

export async function resolveTenantContext(request?: Request): Promise<TenantContext> {
  const env = getServerEnv();

  if (!request) {
    const session = await tryGetSessionFromNextCookies();
    if (session && allowedRoles.has(session.role)) {
      return session;
    }

    return {
      tenantId: env.pilotTenantId || defaultContext.tenantId,
      userId: defaultContext.userId,
      role: defaultContext.role,
    };
  }

  const session = await tryGetSessionFromRequest(request);
  if (session && allowedRoles.has(session.role)) {
    return session;
  }

  if (env.useSeedData) {
    return {
      tenantId: env.pilotTenantId || defaultContext.tenantId,
      userId: defaultContext.userId,
      role: defaultContext.role,
    };
  }

  return defaultContext;
}
