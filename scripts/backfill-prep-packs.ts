/**
 * One-time backfill: re-prepares Monthly Touches whose stored prepPack predates
 * the current schema, so the newer SEO / participation panels render with real
 * data instead of empty defaults.
 *
 * A prepPack is considered STALE when its seoPerformance is missing any of the
 * fields the current SeoPerformancePanel reads (keywordScanHistory, heatmapGrids,
 * checkinBusinesses) or the prepPack is missing clientParticipation / dataGaps.
 * Re-running prepareMonthlyTouch rewrites the prepPack via the current
 * buildPrepPack (deterministic, snapshot-driven — no live external APIs), which
 * emits the current shape and repopulates from the latest integration snapshots.
 *
 * Safe by default: DRY RUN unless --apply is passed. Idempotent: touches that are
 * already current are skipped, and re-running after --apply reports 0 stale.
 *
 *   Dry run (writes nothing):   npx tsx scripts/backfill-prep-packs.ts
 *   Apply (deterministic brief): npx tsx scripts/backfill-prep-packs.ts --apply
 *   Apply + regenerate AI brief: npx tsx scripts/backfill-prep-packs.ts --apply --with-claude
 */
import { loadEnvConfig } from "@next/env";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { MonthlyTouchPrepPack } from "@/src/lib/mtos-data";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { monthlyTouchesCollectionPath } from "@/src/lib/server/firebase/collections";
import { prepareMonthlyTouch } from "@/src/lib/server/services/monthly-touch-prep-service";

// Fields the current panels rely on. A prepPack missing any of these is stale.
const REQUIRED_SEO_FIELDS = ["keywordScanHistory", "heatmapGrids", "checkinBusinesses"] as const;
const REQUIRED_PREP_FIELDS = ["clientParticipation", "dataGaps"] as const;

interface StaleTouch {
  touchId: string;
  clientId: string;
  missing: string[];
}

function findMissingFields(prepPack: Partial<MonthlyTouchPrepPack> | undefined): string[] {
  if (!prepPack) return [];
  const seo = (prepPack.seoPerformance ?? {}) as Record<string, unknown>;
  const missing: string[] = [];
  for (const field of REQUIRED_SEO_FIELDS) {
    if (!(field in seo)) missing.push(`seoPerformance.${field}`);
  }
  for (const field of REQUIRED_PREP_FIELDS) {
    if (!(field in (prepPack as Record<string, unknown>))) missing.push(field);
  }
  return missing;
}

async function main() {
  loadEnvConfig(process.cwd());

  const apply = process.argv.includes("--apply");
  const withClaude = process.argv.includes("--with-claude");
  const tenantId = process.env.MTOS_TENANT_ID || "map-ranking";

  // userId "unknown" bypasses the per-user synced-client visibility filter, so
  // every touch in the tenant is reachable for the backfill.
  const context: TenantContext = { tenantId, userId: "unknown", role: "tenant_admin" };

  const db = getFirebaseAdminDb();
  if (!db) {
    console.error("Firebase Admin is not configured (check FIREBASE_* env vars). Aborting.");
    process.exit(1);
  }

  const snapshot = await db.collection(monthlyTouchesCollectionPath(tenantId)).get();

  let noPrep = 0;
  let current = 0;
  const stale: StaleTouch[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data() as { clientId?: string; prepPack?: Partial<MonthlyTouchPrepPack> };
    if (!data.prepPack) {
      noPrep += 1;
      continue;
    }
    const missing = findMissingFields(data.prepPack);
    if (missing.length) {
      stale.push({ touchId: doc.id, clientId: data.clientId ?? "?", missing });
    } else {
      current += 1;
    }
  }

  console.log(`\n=== Prep-pack backfill (tenant: ${tenantId}) ===`);
  console.log(`mode:            ${apply ? (withClaude ? "APPLY + Claude" : "APPLY (deterministic)") : "DRY RUN"}`);
  console.log(`total touches:   ${snapshot.size}`);
  console.log(`no prepPack:     ${noPrep}  (skipped — they show the fallback, never crash)`);
  console.log(`current schema:  ${current}  (skipped — already up to date)`);
  console.log(`stale schema:    ${stale.length}\n`);

  if (!stale.length) {
    console.log("Nothing to backfill. ✅");
    return;
  }

  for (const item of stale) {
    console.log(`  • ${item.touchId}  (client ${item.clientId})  missing: ${item.missing.join(", ")}`);
  }

  if (!apply) {
    console.log("\nDry run only — nothing was written.");
    console.log("Re-run with --apply to backfill (add --with-claude to also regenerate the AI brief).");
    return;
  }

  console.log(`\nRe-preparing ${stale.length} touch(es)...\n`);
  let ok = 0;
  const failures: { touchId: string; error: string }[] = [];

  for (const item of stale) {
    try {
      await prepareMonthlyTouch(context, item.touchId, { includeClaude: withClaude });
      ok += 1;
      console.log(`  ✓ ${item.touchId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      failures.push({ touchId: item.touchId, error: message });
      console.log(`  ✗ ${item.touchId} — ${message}`);
    }
  }

  console.log(`\nDone. re-prepared: ${ok}, failed: ${failures.length}`);
  if (failures.length) {
    for (const f of failures) console.log(`  ✗ ${f.touchId}: ${f.error}`);
    process.exit(1);
  }
}

void main();
