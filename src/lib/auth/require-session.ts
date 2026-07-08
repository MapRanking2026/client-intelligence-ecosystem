import type { TenantContext } from "@/src/lib/contracts/mtos";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";

export async function requireSession(request?: Request): Promise<TenantContext> {
  return resolveTenantContext(request);
}
