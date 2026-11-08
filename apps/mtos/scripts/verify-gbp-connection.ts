/**
 * Where does the Google Business Profile connection actually live, and is it readable?
 *
 * The owner reported (8 November 2026) that GBP data was pulling and then stopped, for everybody.
 * This script answers that without guessing, because the likely cause is structural rather than a
 * broken token: `sharedIntegrationProviders` in `src/lib/server/integrations.ts` holds only
 * rank-tracker, geogrid and map-checkins, so every Google provider is stored **per user** at
 * `tenants/{t}/users/{uid}/integrations/{provider}`. A connection one person authorised is
 * invisible to everybody else, and `listStoredConnections` deliberately hides any provider found
 * in the tenant-level collection that is not in that shared set -- so a tenant-level GBP token
 * from before per-user scoping existed would still be sitting in Firestore, ignored.
 *
 * So it prints three things, for each tenant:
 *
 *  - every doc in the **tenant-level** integrations collection, flagged as surfaced or orphaned,
 *  - every **per-user** integrations doc, per user, with token expiry and last error,
 *  - the **GBP snapshot** doc: when it was last written and how many clients it covers, which is
 *    what the briefs and the scorecard actually read.
 *
 * Read-only. It writes nothing, refreshes no token, and raises no notification. It prints no
 * secret: ciphertext and token material are reported as present/absent and never echoed.
 *
 *   npx tsx scripts/verify-gbp-connection.ts
 *   npx tsx scripts/verify-gbp-connection.ts --tenant map-ranking
 */
import { loadEnvConfig } from "@next/env";

import { isSharedIntegrationProvider } from "@/src/lib/server/integrations";
import {
  integrationsCollectionPath,
  integrationSnapshotPath,
  tenantUsersCollectionPath,
  userIntegrationsCollectionPath,
} from "@/src/lib/server/firebase/collections";

function flagValue(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

/** Present/absent only. A diagnostic must never be the place a token leaks. */
function held(value: unknown): string {
  return value ? "held" : "absent";
}

function ago(iso: unknown): string {
  if (typeof iso !== "string" || !iso.trim()) return "never";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return String(iso);
  const hours = (Date.now() - then) / 3_600_000;
  if (hours < 48) return `${iso} (${Math.round(hours)}h ago)`;
  return `${iso} (${Math.round(hours / 24)}d ago)`;
}

async function main() {
  loadEnvConfig(process.cwd());
  const { getFirebaseAdminDb } = await import("@/src/lib/server/firebase/admin");
  const db = getFirebaseAdminDb();
  if (!db) {
    console.log("No Firestore admin credentials in this environment — nothing to read.");
    process.exit(1);
  }

  const only = flagValue("--tenant");
  const tenantDocs = (await db.collection("tenants").get()).docs;
  const tenantIds = (only ? tenantDocs.filter((d) => d.id === only) : tenantDocs).map((d) => d.id);
  if (!tenantIds.length) {
    console.log(only ? `No tenant "${only}".` : "No tenants.");
    process.exit(1);
  }

  for (const tenantId of tenantIds) {
    console.log(`\n==================== tenant: ${tenantId} ====================`);

    console.log(`\n-- tenant-level integrations (${integrationsCollectionPath(tenantId)})`);
    const shared = await db.collection(integrationsCollectionPath(tenantId)).get();
    if (shared.empty) {
      console.log("   (none)");
    }
    for (const doc of shared.docs) {
      const data = doc.data() as Record<string, unknown>;
      const surfaced = isSharedIntegrationProvider(doc.id as never);
      console.log(
        `   ${doc.id.padEnd(26)} ${surfaced ? "SURFACED" : "ORPHANED (hidden: not a shared provider)"}`,
      );
      console.log(
        `      status=${String(data.status ?? "?")} credential=${held(data.credentialCiphertext)}` +
          ` updated=${ago(data.updatedAt)}`,
      );
      console.log(
        `      tokenExpiresAt=${ago(data.tokenExpiresAt)} lastRefreshAt=${ago(data.lastRefreshAt)}`,
      );
      if (data.errorMessage) console.log(`      error: ${String(data.errorMessage)}`);
      if (Array.isArray(data.scopes)) console.log(`      scopes: ${data.scopes.join(" ")}`);
    }

    console.log(`\n-- per-user integrations`);
    const users = await db.collection(tenantUsersCollectionPath(tenantId)).get();
    let anyUserGbp = false;
    for (const user of users.docs) {
      const profile = user.data() as Record<string, unknown>;
      const label = `${String(profile.displayName || profile.email || "(no name)")} [${String(profile.role || "?")}]`;
      const own = await db.collection(userIntegrationsCollectionPath(tenantId, user.id)).get();
      if (own.empty) {
        console.log(`   ${label} — ${user.id}\n      (no personal connections)`);
        continue;
      }
      console.log(`   ${label} — ${user.id}`);
      for (const doc of own.docs) {
        const data = doc.data() as Record<string, unknown>;
        if (doc.id === "google-business-profile") anyUserGbp = true;
        console.log(
          `      ${doc.id.padEnd(26)} status=${String(data.status ?? "?")}` +
            ` credential=${held(data.credentialCiphertext)} expires=${ago(data.tokenExpiresAt)}`,
        );
        if (data.errorMessage) console.log(`         error: ${String(data.errorMessage)}`);
        if (Array.isArray(data.scopes)) console.log(`         scopes: ${data.scopes.join(" ")}`);
      }
    }

    console.log(`\n-- GBP snapshot (what the briefs and scorecard read)`);
    const snapshot = await db.doc(integrationSnapshotPath(tenantId, "google-business-profile")).get();
    if (!snapshot.exists) {
      console.log("   no snapshot doc — nothing has ever been written for this tenant");
    } else {
      const data = snapshot.data() as Record<string, unknown>;
      const payload = (data.payload || {}) as Record<string, unknown>;
      console.log(`   fetchedAt=${ago(data.fetchedAt ?? data.updatedAt)} status=${String(data.status ?? "?")}`);
      if (data.errorMessage) console.log(`   error: ${String(data.errorMessage)}`);
      const keys = Object.keys(payload);
      console.log(`   payload keys: ${keys.length ? keys.join(", ") : "(empty)"}`);
      for (const key of keys) {
        const value = payload[key];
        if (value && typeof value === "object") {
          const size = Array.isArray(value) ? value.length : Object.keys(value as object).length;
          console.log(`      ${key}: ${Array.isArray(value) ? "array" : "object"} of ${size}`);
        }
      }
    }

    console.log(
      `\n-- reading of this tenant: GBP is ${
        isSharedIntegrationProvider("google-business-profile" as never) ? "a SHARED provider" : "a PER-USER provider"
      }; a per-user GBP connection exists for at least one user: ${anyUserGbp ? "yes" : "NO"}`,
    );
  }

  console.log(
    `\nNot covered by these checks: whether the stored token still works against Google (that needs a live API call), whether the Google Cloud project still has the Business Profile APIs enabled and quota, and whether each client has a GBP location mapped.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
