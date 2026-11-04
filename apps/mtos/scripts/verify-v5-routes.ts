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
 * route into a touch has to land on the stage the touch is actually in -- and, since Phase 2, every
 * chart the review brief would draw for that touch, with the figures it would put on screen. That
 * last part is the only way to tell a chart built from a real preparation apart from one built from
 * a fixture, which is the difference that matters here.
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
import { deriveBriefCharts } from "@/src/lib/contracts/brief-charts";
import { followThroughChecklist, checklistProgress } from "@/src/lib/contracts/follow-through-checklist";

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

        // What the review brief would draw for this touch, from this touch's own stored figures.
        const charts = deriveBriefCharts(payload.touch.prepPack);
        if (!charts.length) {
          console.log(
            "      charts: none — nothing readable in the stored preparation to draw, which is the correct answer for an unprepared touch",
          );
        }
        for (const chart of charts) {
          const figures =
            chart.cards?.map((card) => `${card.label} ${card.value}${card.detail ? ` (${card.detail})` : ""}`) ||
            chart.funnel?.map((entry) => `${entry.label} ${entry.value}`) ||
            chart.rank?.map((entry) => `${entry.label} ${entry.from}->${entry.to}`) ||
            chart.stack?.map((entry) => `${entry.label} ${entry.value}`) ||
            (chart.line ? [`${chart.line.a.join("/")} then ${chart.line.b.join("/")}`] : []);
          console.log(`      chart §${chart.section} ${chart.kind} "${chart.title}" at block ${chart.at}`);
          console.log(`          ${figures.join(" · ") || "(no figures)"}`);
        }

        const checklist = followThroughChecklist(payload.touch);
        const progressed = checklistProgress(checklist);
        console.log(
          `      post-touch checklist: ${progressed.ok} of ${progressed.total} settled — ${checklist
            .filter((entry) => !entry.ok)
            .map((entry) => entry.label)
            .join(", ") || "nothing outstanding"}`,
        );
      }
    }
  }
}

/** Whether a thrown error is Firestore saying the day's reads are gone. */
function isQuotaExhausted(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  const message = error instanceof Error ? error.message : String(error);
  return code === 8 || /RESOURCE_EXHAUSTED|Quota exceeded/i.test(message);
}

main().catch((error) => {
  /*
    The daily read quota is a wall this project has hit three times now, and a stack trace is the
    wrong way to say so: it reads as a broken script rather than as a limit that resets. Exits 2 so
    "could not check" is distinguishable from "checked and something was wrong".
  */
  if (isQuotaExhausted(error)) {
    console.error(
      "Firestore's daily read quota is exhausted, so nothing could be loaded. This is a limit, not a failure: it resets at midnight Pacific. Nothing was written.",
    );
    process.exit(2);
  }
  console.error(error);
  process.exit(1);
});
