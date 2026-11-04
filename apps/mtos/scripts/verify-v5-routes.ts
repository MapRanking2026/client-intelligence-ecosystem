/**
 * Confirm that a real client and a real touch still load through the screens Phase 1 moved.
 *
 * The acceptance checklist asks for "open a real client and confirm its data still loads". The
 * screens themselves sit behind a session cookie (`src/proxy.ts` redirects without one), and
 * entering somebody's credentials is not on the table, so this calls the exact service functions
 * the two moved pages call and prints what they return. If a real touch resolves to a real client
 * here, the page renders it there -- the page does nothing to the data in between.
 *
 * It also prints each touch's resolved opening step, which is what Phase 1 is really about: every
 * route into a touch has to land on the stage the touch is actually in.
 *
 * Read-only. It writes nothing anywhere.
 *
 *   npx tsx scripts/verify-v5-routes.ts
 *   npx tsx scripts/verify-v5-routes.ts --tenant map-ranking
 */
import { loadEnvConfig } from "@next/env";

import { getCommandCenterV2View } from "@/src/lib/server/services/command-center-v2-service";
import { getMonthlyTouchWorkspaceView } from "@/src/lib/server/services/monthly-touch-service";
import {
  listActiveTenantIds,
  listTenantUserContexts,
} from "@/src/lib/server/services/daily-sync-service";
import { deriveRunSheetStage } from "@/src/lib/server/services/prep-readiness-service";
import { isTouchStep, resolveOpeningStep, type TouchStep } from "@/src/lib/contracts/touch-progress";
import { getAccountManagerProfile } from "@/src/lib/server/services/user-service";

/** The stage names and the stored step names are the same five steps; see the run-sheet page. */
const STEP_FOR_STAGE: Record<string, TouchStep> = {
  prep: "prep",
  review: "review",
  live: "live",
  follow_through: "follow",
  qa: "qa",
};

function flagValue(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main() {
  loadEnvConfig(process.cwd());

  const only = flagValue("--tenant");
  const tenantIds = only ? [only] : await listActiveTenantIds();

  for (const tenantId of tenantIds) {
    for (const context of await listTenantUserContexts(tenantId)) {
      const profile = await getAccountManagerProfile(context);
      const view = await getCommandCenterV2View(context);
      console.log(`\n── ${tenantId} · ${profile.name}`);
      console.log(
        `  /command-center  ${view.greeting.label} · today ${view.todaysCalls.length} · prep due ${view.prepDueWithin48h.length} · overdue follow-through ${view.overdueFollowThrough.length} · QA ${view.qaWaiting.length} · at risk ${view.atRisk.length}`,
      );

      // The touches this AM's own screens link to, which is what the moved routes have to open.
      const sample = [...view.todaysCalls, ...view.prepDueWithin48h, ...view.thisWeek].slice(0, 5);
      if (!sample.length) {
        console.log("  no scheduled touch to open for this account manager");
        continue;
      }
      for (const entry of sample) {
        const payload = await getMonthlyTouchWorkspaceView(context, entry.touch.id);
        if (!payload) {
          console.log(`  /monthly-touch/${entry.touch.id}  MISSING — the touch did not load`);
          continue;
        }
        const stage = deriveRunSheetStage(payload.touch);
        const progress = isTouchStep(payload.touch.progress)
          ? payload.touch.progress
          : STEP_FOR_STAGE[stage]!;
        console.log(
          `  /monthly-touch/${payload.touch.id}  ${payload.client.name} · ${payload.client.industry || "no industry"} · opens at ${resolveOpeningStep(progress, undefined)} (stage ${stage})`,
        );
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
