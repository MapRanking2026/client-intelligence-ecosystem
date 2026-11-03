import type { TenantContext } from "@/src/lib/contracts/mtos";
import {
  INTEGRATION_PERMISSIONS,
  permissionDetail,
  permissionState,
  permissionsNeedingAttention,
  type IntegrationPermission,
  type PermissionView,
} from "@/src/lib/contracts/integration-permissions";
import {
  getIntegrationConnection,
  getIntegrationDefinition,
} from "@/src/lib/server/integrations";

/**
 * The one read of what MTOS is actually allowed to do.
 *
 * Every caller that was reaching into a connection record and comparing a scope string by hand now
 * asks here instead, so Settings and the follow-through can never disagree about whether a
 * permission is granted -- which is the bug the handoff describes: a permission that looked granted
 * on one screen and reset on another.
 *
 * It reads. It never writes. The stored scopes are whatever the AM authorized, and the only thing
 * that changes them is the AM going through the provider's own consent screen.
 */

/** One permission's real state, read from the stored connection. */
export async function readPermission(
  context: TenantContext,
  permission: IntegrationPermission,
): Promise<PermissionView> {
  const record = await getIntegrationConnection(context, permission.provider).catch(() => undefined);
  const requested = getIntegrationDefinition(permission.provider).oauth?.scopes || [];
  const status = permissionState(permission, record, requested);
  return { ...permission, status, detail: permissionDetail(permission, status) };
}

/**
 * Every permission, for the Settings screen and the "N need attention" chip.
 *
 * The connections are read once each rather than once per permission: three of these six live on
 * the same Google Meet connection, and this runs on a page render.
 */
export async function listPermissions(context: TenantContext): Promise<PermissionView[]> {
  const providers = Array.from(new Set(INTEGRATION_PERMISSIONS.map((permission) => permission.provider)));
  const records = new Map(
    await Promise.all(
      providers.map(
        async (provider) =>
          [provider, await getIntegrationConnection(context, provider).catch(() => undefined)] as const,
      ),
    ),
  );

  return INTEGRATION_PERMISSIONS.map((permission) => {
    const requested = getIntegrationDefinition(permission.provider).oauth?.scopes || [];
    const status = permissionState(permission, records.get(permission.provider), requested);
    return { ...permission, status, detail: permissionDetail(permission, status) };
  });
}

/** Whether one named capability is allowed right now. What a processing step asks. */
export async function hasPermission(context: TenantContext, permissionId: string): Promise<boolean> {
  const permission = INTEGRATION_PERMISSIONS.find((entry) => entry.id === permissionId);
  if (!permission) return false;
  return (await readPermission(context, permission)).status === "granted";
}

/** The number behind the Settings chip. Never throws: a failed read is "nothing to report". */
export async function permissionAttentionCount(context: TenantContext): Promise<number> {
  try {
    return permissionsNeedingAttention(await listPermissions(context)).length;
  } catch {
    return 0;
  }
}
