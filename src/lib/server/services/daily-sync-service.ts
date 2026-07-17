import type { TenantContext } from "@/src/lib/contracts/mtos";
import { syncClickUpClients } from "@/src/lib/server/clickup-client-sync";
import { syncIntegrationProvider } from "@/src/lib/server/integration-sync";
import { listConnectedSyncableProviders } from "@/src/lib/server/integrations";
import { tenantUsersCollectionPath } from "@/src/lib/server/firebase/collections";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { getServerEnv } from "@/src/lib/server/env";

interface ProviderResult {
  providerId: string;
  status: "completed" | "failed";
  summary: string;
}

interface ClientSyncResult {
  userId: string;
  status: "completed" | "failed";
  detail: string;
}

export interface DailySyncReport {
  tenantId: string;
  providers: ProviderResult[];
  clientSyncs: ClientSyncResult[];
}

/**
 * Runs the full daily maintenance pass for a tenant: syncs every connected, sync-enabled provider
 * (which also refreshes each OAuth token, keeping them alive without any manual "Refresh" click),
 * then refreshes the client roster from ClickUp for every registered manager.
 */
export async function runDailyTenantSync(tenantId: string): Promise<DailySyncReport> {
  const systemContext: TenantContext = { tenantId, userId: "system-cron", role: "tenant_admin" };

  const providerIds = await listConnectedSyncableProviders(tenantId);
  const providers: ProviderResult[] = [];
  for (const providerId of providerIds) {
    try {
      const result = await syncIntegrationProvider(systemContext, providerId);
      providers.push({ providerId, status: "completed", summary: result.summary });
    } catch (error) {
      providers.push({
        providerId,
        status: "failed",
        summary: error instanceof Error ? error.message : "sync failed",
      });
    }
  }

  // The client roster is matched per manager, so run the client sync for each registered user.
  const clientSyncs: ClientSyncResult[] = [];
  const db = getFirebaseAdminDb();
  if (db) {
    const usersSnapshot = await db.collection(tenantUsersCollectionPath(tenantId)).get();
    for (const userDoc of usersSnapshot.docs) {
      const role = String((userDoc.data() as { role?: string }).role || "account_manager");
      const userContext: TenantContext = {
        tenantId,
        userId: userDoc.id,
        role: role as TenantContext["role"],
      };
      try {
        const result = await syncClickUpClients(userContext);
        clientSyncs.push({
          userId: userDoc.id,
          status: "completed",
          detail: `${result.counts?.created ?? 0} created, ${result.counts?.updated ?? 0} updated`,
        });
      } catch (error) {
        clientSyncs.push({
          userId: userDoc.id,
          status: "failed",
          detail: error instanceof Error ? error.message : "client sync failed",
        });
      }
    }
  }

  return { tenantId, providers, clientSyncs };
}

export function getDailySyncTenantId() {
  return getServerEnv().pilotTenantId;
}
