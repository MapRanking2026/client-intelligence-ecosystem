import type { TenantContext } from "@/src/lib/contracts/mtos";
import { syncClickUpClients } from "@/src/lib/server/clickup-client-sync";
import { syncIntegrationProvider } from "@/src/lib/server/integration-sync";
import { listConnectedSyncableProviders, refreshAllConnectedTokens } from "@/src/lib/server/integrations";
import { resyncClickupKnowledge, type ClickupResyncReport } from "@/src/lib/server/services/knowledge-service";
import { tenantUsersCollectionPath } from "@/src/lib/server/firebase/collections";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { getServerEnv } from "@/src/lib/server/env";

interface ProviderResult {
  providerId: string;
  status: "completed" | "failed";
  summary: string;
}

export interface TokenRefreshReport {
  providerId: string;
  status: "refreshed" | "skipped" | "failed";
  detail?: string;
}

/**
 * Refreshes every connected integration's token that can expire, for a tenant. Kept lightweight so
 * it can run on a frequent cron independent of the heavier data syncs.
 */
export async function runTokenRefresh(tenantId: string): Promise<TokenRefreshReport[]> {
  const systemContext: TenantContext = { tenantId, userId: "system-cron", role: "tenant_admin" };
  return refreshAllConnectedTokens(systemContext);
}

interface ClientSyncResult {
  userId: string;
  status: "completed" | "failed";
  detail: string;
}

export interface DailySyncReport {
  tenantId: string;
  tokenRefresh: TokenRefreshReport[];
  providers: ProviderResult[];
  clientSyncs: ClientSyncResult[];
  knowledgeSync: ClickupResyncReport | { error: string };
}

/**
 * Runs the full daily maintenance pass for a tenant: syncs every connected, sync-enabled provider
 * (which also refreshes each OAuth token, keeping them alive without any manual "Refresh" click),
 * then refreshes the client roster from ClickUp for every registered manager.
 */
export async function runDailyTenantSync(tenantId: string): Promise<DailySyncReport> {
  const systemContext: TenantContext = { tenantId, userId: "system-cron", role: "tenant_admin" };

  // Refresh every connectable token up front -- including providers no sync touches -- so all
  // credentials are fresh before the syncs and stay exercised.
  const tokenRefresh = await refreshAllConnectedTokens(systemContext);

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

  // Keep the ClickUp-sourced knowledge base current: re-embed changed wiki pages,
  // prune deleted ones. Non-fatal and a no-op when nothing is imported.
  let knowledgeSync: ClickupResyncReport | { error: string };
  try {
    knowledgeSync = await resyncClickupKnowledge(systemContext);
  } catch (error) {
    knowledgeSync = { error: error instanceof Error ? error.message : "knowledge re-sync failed" };
  }

  return { tenantId, tokenRefresh, providers, clientSyncs, knowledgeSync };
}

export function getDailySyncTenantId() {
  return getServerEnv().pilotTenantId;
}

/**
 * Lists every real tenant to run scheduled work against. Reads the `tenants` collection, which only
 * returns documents that actually exist -- so stray integration subcollections left under a
 * non-existent tenant id (e.g. an old demo seed) are ignored. Falls back to the configured pilot
 * tenant if the collection can't be read, so a cron never silently does nothing.
 */
export async function listActiveTenantIds(): Promise<string[]> {
  const db = getFirebaseAdminDb();
  if (!db) return [getDailySyncTenantId()];
  try {
    const snapshot = await db.collection("tenants").get();
    const ids = snapshot.docs.map((doc) => doc.id).filter(Boolean);
    return ids.length ? ids : [getDailySyncTenantId()];
  } catch {
    return [getDailySyncTenantId()];
  }
}

/** Refreshes tokens for every active tenant. */
export async function runTokenRefreshAllTenants(): Promise<Record<string, TokenRefreshReport[]>> {
  const tenantIds = await listActiveTenantIds();
  const out: Record<string, TokenRefreshReport[]> = {};
  for (const tenantId of tenantIds) {
    out[tenantId] = await runTokenRefresh(tenantId);
  }
  return out;
}

/** Runs the full daily sync for every active tenant. */
export async function runDailyTenantSyncAllTenants(): Promise<Record<string, DailySyncReport>> {
  const tenantIds = await listActiveTenantIds();
  const out: Record<string, DailySyncReport> = {};
  for (const tenantId of tenantIds) {
    out[tenantId] = await runDailyTenantSync(tenantId);
  }
  return out;
}
