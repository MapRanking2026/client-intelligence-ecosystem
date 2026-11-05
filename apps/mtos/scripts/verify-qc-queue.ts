/**
 * Confirm the QC queue loads against real data, and say plainly when there is none.
 *
 * The acceptance checklist asks that a real client still loads through every screen a phase adds.
 * The QC screens sit behind a session cookie (`src/proxy.ts` redirects without one) and entering
 * somebody's credentials is not on the table, so this calls the exact service the page calls and
 * prints what it returns. If the queue resolves real rows here, the page renders them there -- the
 * page does nothing to the data in between.
 *
 * It also prints the two things most likely to be wrong in a way a screenshot would hide:
 *
 *  - **Whether the Firestore queries behind the four tabs actually run.** They use only automatic
 *    single-field indexes, deliberately (see `qc-queue-service.ts`), and this is where a missing
 *    composite index would surface as FAILED_PRECONDITION rather than in front of a reviewer.
 *  - **Whether the index rows carry what the rows and cards need.** Rows written before a field
 *    existed are the normal case during a rollout, and a missing one shows here as a dash.
 *
 * Read-only. It writes nothing anywhere.
 *
 *   npx tsx scripts/verify-qc-queue.ts
 *   npx tsx scripts/verify-qc-queue.ts --tenant map-ranking
 */
import { loadEnvConfig } from "@next/env";

import { callLengthLabel, evidenceSummary, waitLabel } from "@/src/lib/contracts/qc-queue";
import { goalsLabel, lowestLabel } from "@/src/lib/contracts/qc-team";
import { canOpenQcQueue, canScoreQc } from "@/src/lib/contracts/qc-access";
import {
  listActiveTenantIds,
  listTenantUserContexts,
} from "@/src/lib/server/services/daily-sync-service";
import { getQcQueueView } from "@/src/lib/server/services/qc-queue-service";
import { getAccountManagerProfile } from "@/src/lib/server/services/user-service";
import { getQcReviewers } from "@/src/lib/server/services/qc-reviewers-service";

function flagValue(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main() {
  loadEnvConfig(process.cwd());

  const only = flagValue("--tenant");
  const tenantIds = only ? [only] : await listActiveTenantIds();
  if (!tenantIds.length) {
    console.log("No active tenants. Nothing to verify.");
    return;
  }

  for (const tenantId of tenantIds) {
    const reviewers = await getQcReviewers(tenantId).catch(() => ({ userIds: [] as string[] }));
    console.log(`\n══ ${tenantId}`);
    console.log(
      `  configured QC reviewers: ${reviewers.userIds.length ? reviewers.userIds.join(", ") : "none — a handoff notifies every qa_reviewer instead"}`,
    );

    const contexts = await listTenantUserContexts(tenantId);
    // One read of the queue per tenant is enough: the view is tenant-wide, not per-user. The
    // contexts are only used to report who would be allowed to open it.
    const first = contexts[0];
    if (!first) {
      console.log("  no users in this tenant");
      continue;
    }

    console.log("  who may open /qa as the QC queue:");
    for (const context of contexts) {
      const profile = await getAccountManagerProfile(context);
      console.log(
        `    ${profile.name || context.userId} · ${context.role} · queue ${canOpenQcQueue(context.role) ? "yes" : "no"} · may score ${canScoreQc(context.role) ? "yes" : "no"}`,
      );
    }

    let view: Awaited<ReturnType<typeof getQcQueueView>>;
    try {
      view = await getQcQueueView(first);
    } catch (error) {
      // The failure this script exists to catch. A missing index is not a quota problem and is
      // deliberately not swallowed by `withQuotaFallback`.
      console.log(
        `  QUEUE FAILED TO LOAD: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    console.log(
      `  counts: queue ${view.counts.queue} · appeals ${view.counts.appeals} · scored ${view.counts.scored} · team ${view.counts.team}`,
    );

    if (!view.counts.queue && !view.counts.scored && !view.counts.appeals) {
      console.log(
        "  the QC collection is empty — correct until an AM finishes a follow-through, which is what creates the first record",
      );
    }

    for (const row of view.queue) {
      const wait = waitLabel(row.readyAt);
      const evidence =
        typeof row.evidenceTotal === "number"
          ? evidenceSummary(
              Array.from({ length: row.evidenceTotal }, (_, index) => ({
                ok: index < (row.evidenceOk || 0),
              })),
            ).text
          : "no evidence snapshot on the index row";
      console.log(
        `  queue /qa?qc=${row.touchId}  ${row.client} · ${row.am || "NO AM NAME"} · ${row.status} · ${callLengthLabel(row.callLengthMin)} · ${row.tickets ?? "—"} tickets · ${evidence} · ${row.ai ? "AI pre-read ready" : "manual"} · ${wait.text || "no wait recorded"}${wait.late ? " (LATE)" : ""}`,
      );
    }

    for (const row of view.appeals) {
      console.log(
        `  appeal /qa?appeal=${row.touchId}  ${row.client} · ${row.am || "NO AM NAME"} · score ${row.score ?? "—"}`,
      );
    }

    for (const row of view.scored.slice(0, 10)) {
      console.log(
        `  scored /qa?qc=${row.touchId}  ${row.client} · ${row.am || "NO AM NAME"} · ${row.status} · ${row.score ?? "—"}${row.rating ? ` (${row.rating})` : ""} · crit ${row.crit ? `${row.crit.length} stored` : "NOT on the index row"}`,
      );
    }
    if (view.scored.length > 10) {
      console.log(`  …and ${view.scored.length - 10} more scored touches`);
    }

    for (const card of view.team) {
      console.log(
        `  team ${card.am} · avg ${card.averageScore ?? "—"} · ${card.scored} QCs · ${card.inQueue} in queue · prep ${card.prepAverage ?? "—"} · post-touch ${card.postTouchAverage ?? "—"} · ${goalsLabel(card)} · ${lowestLabel(card)}`,
      );
    }
  }

  console.log("\nNot covered by this script:");
  console.log("  - how any of it looks on the screen, which needs a signed-in browser");
  console.log("  - submitting a score or deciding an appeal, which write real records");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
