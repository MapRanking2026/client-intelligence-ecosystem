/**
 * Re-runs the ClickUp client roster sync for every registered manager in a tenant, so corrected
 * field mappings land on the stored client documents without waiting for the daily cron.
 *
 * This is the `clientSyncs` portion of runDailyTenantSync and nothing else: it does NOT sync other
 * providers, refresh their tokens, or re-embed the ClickUp knowledge base. Those are the expensive,
 * quota-consuming parts of the daily pass and have no bearing on the client roster.
 *
 * The sync matches tasks per manager -- a task is persisted only under the user whose name or email
 * matches its manager field -- so it has to run once per registered user to cover the whole roster.
 *
 * Safe by default: DRY RUN unless --apply is passed. The dry run reports which users have ClickUp
 * connected without reading or writing any task data.
 *
 *   Dry run:  npx tsx scripts/sync-clickup-clients.ts
 *   Apply:    npx tsx scripts/sync-clickup-clients.ts --apply
 */
import { loadEnvConfig } from "@next/env";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import { syncClickUpClients } from "@/src/lib/server/clickup-client-sync";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantUsersCollectionPath } from "@/src/lib/server/firebase/collections";
import { listActiveTenantIds } from "@/src/lib/server/services/daily-sync-service";

async function listTenantUserContexts(tenantId: string): Promise<TenantContext[]> {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firebase Admin must be configured before the client sync can run");
  }
  const snapshot = await db.collection(tenantUsersCollectionPath(tenantId)).get();
  return snapshot.docs.map((doc) => ({
    tenantId,
    userId: doc.id,
    role: String((doc.data() as { role?: string }).role || "account_manager") as TenantContext["role"],
  }));
}

async function main() {
  loadEnvConfig(process.cwd());

  const apply = process.argv.includes("--apply");
  // Reads the `tenants` collection rather than the configured pilot tenant id, which points at a
  // demo tenant that holds no real roster.
  const tenantIds = await listActiveTenantIds();

  console.log(`tenants=${tenantIds.join(", ")} mode=${apply ? "APPLY" : "DRY RUN"}`);

  let persisted = 0;
  for (const tenantId of tenantIds) {
    const contexts = await listTenantUserContexts(tenantId);
    console.log(`\ntenant=${tenantId} users=${contexts.length}`);

    for (const context of contexts) {
      if (!apply) {
        console.log(`  would sync userId=${context.userId} role=${context.role}`);
        continue;
      }
      try {
        const result = await syncClickUpClients(context);
        const counts = result.counts;
        persisted += (counts?.created ?? 0) + (counts?.updated ?? 0);
        console.log(
          `  OK   userId=${context.userId} created=${counts?.created ?? 0} updated=${counts?.updated ?? 0} failed=${counts?.failed ?? 0} skipped=${counts?.skipped ?? 0}`,
        );
      } catch (error) {
        // One manager without a usable ClickUp connection must not stop the rest of the roster.
        console.log(`  SKIP userId=${context.userId} ${error instanceof Error ? error.message : "sync failed"}`);
      }
    }
  }

  console.log(apply ? `\n${persisted} client document(s) persisted.` : "\nDry run -- nothing written. Re-run with --apply.");
}

main().catch((error) => {
  console.error("FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
