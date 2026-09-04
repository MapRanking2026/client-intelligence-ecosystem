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
 * Builds a context for every registered user in a tenant, so per-user integrations (each AM's own
 * ClickUp, Google, GoHighLevel, ...) can be refreshed and synced under the right user.
 */
async function listTenantUserContexts(tenantId: string): Promise<TenantContext[]> {
  const db = getFirebaseAdminDb();
  if (!db) {
    return [];
  }
  const snapshot = await db.collection(tenantUsersCollectionPath(tenantId)).get();
  return snapshot.docs.map((doc) => ({
    tenantId,
    userId: doc.id,
    role: String((doc.data() as { role?: string }).role || "account_manager") as TenantContext["role"],
  }));
}

/**
 * Refreshes every connected integration's token that can expire, for a tenant. Kept lightweight so
 * it can run on a frequent cron independent of the heavier data syncs. Shared feeds are refreshed
 * once; each user's personal connections are refreshed under their own context.
 */
export async function runTokenRefresh(tenantId: string): Promise<TokenRefreshReport[]> {
  const systemContext: TenantContext = { tenantId, userId: "system-cron", role: "tenant_admin" };
  const reports: TokenRefreshReport[] = [];
  reports.push(...(await refreshAllConnectedTokens(systemContext, "shared")));
  for (const userContext of await listTenantUserContexts(tenantId)) {
    reports.push(...(await refreshAllConnectedTokens(userContext, "user")));
  }
  return reports;
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

  // Refresh every connectable token up front -- shared feeds once, plus each user's personal
  // connections -- so all credentials are fresh before the syncs and stay exercised.
  const tokenRefresh = await runTokenRefresh(tenantId);

  const providers: ProviderResult[] = [];

  // Shared, tenant-level feeds (rank tracker, check-ins) sync once for the whole tenant.
  for (const providerId of await listConnectedSyncableProviders(systemContext, "shared")) {
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

  // Per-user work: each registered user's personal integrations sync under their own context, then
  // the client roster is matched per manager.
  const clientSyncs: ClientSyncResult[] = [];
  for (const userContext of await listTenantUserContexts(tenantId)) {
    for (const providerId of await listConnectedSyncableProviders(userContext, "user")) {
      try {
        const result = await syncIntegrationProvider(userContext, providerId);
        providers.push({
          providerId,
          status: "completed",
          summary: `[${userContext.userId}] ${result.summary}`,
        });
      } catch (error) {
        providers.push({
          providerId,
          status: "failed",
          summary: `[${userContext.userId}] ${error instanceof Error ? error.message : "sync failed"}`,
        });
      }
    }

    try {
      const result = await syncClickUpClients(userContext);
      clientSyncs.push({
        userId: userContext.userId,
        status: "completed",
        detail: `${result.counts?.created ?? 0} created, ${result.counts?.updated ?? 0} updated`,
      });
    } catch (error) {
      clientSyncs.push({
        userId: userContext.userId,
        status: "failed",
        detail: error instanceof Error ? error.message : "client sync failed",
      });
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
