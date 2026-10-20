import { after } from "next/server";

import { nowIso } from "@/src/lib/ids";
import { AivScanV1 } from "@/src/lib/ai-visibility/types";
import { isoWeekKey, monthKey, stableHash } from "@/src/lib/ai-visibility/util";
import { audit } from "./audit";
import { listProfiles } from "./profile-service";
import { processQueue } from "./queue";
import { startScan } from "./scan-service";
import { scans } from "./store";

/**
 * Scheduler + background processing triggers.
 *
 * Scheduled scans use a deterministic id per (project, period), so running the
 * scheduler any number of times in a period creates at most one scan. A period
 * whose scan could not start (e.g. over budget) gets a visible `failed` scan
 * record with the reason, instead of silently retrying every run.
 */

export function scheduledScanId(projectId: string, periodKey: string): string {
  return `scan_sched_${stableHash(`${projectId}|${periodKey}`, 20)}`;
}

export interface SchedulerResult {
  projectId: string;
  period: string;
  outcome: "started" | "already_exists" | "blocked";
  scanId: string;
  detail?: string;
}

export async function runScheduler(tenantId: string, now = new Date()): Promise<SchedulerResult[]> {
  const results: SchedulerResult[] = [];
  for (const p of await listProfiles(tenantId)) {
    if (p.status !== "active" || p.scanFrequency === "manual") continue;
    const period = p.scanFrequency === "weekly" ? isoWeekKey(now) : monthKey(now);
    const scanId = scheduledScanId(p.projectId, period);
    if (await scans().get(tenantId, scanId)) {
      results.push({ projectId: p.projectId, period, outcome: "already_exists", scanId });
      continue;
    }
    try {
      const { created } = await startScan(p, {}, { actor: "scheduler", trigger: "scheduled", scanId, scheduleKey: period });
      results.push({ projectId: p.projectId, period, outcome: created ? "started" : "already_exists", scanId });
    } catch (e) {
      const reason = e instanceof Error ? e.message : "scheduler error";
      const ts = nowIso();
      await scans().createIfAbsent(
        tenantId,
        scanId,
        AivScanV1.parse({
          schemaVersion: 1,
          id: scanId,
          tenantId,
          projectId: p.projectId,
          clientId: p.clientId,
          trigger: "scheduled",
          scheduleKey: period,
          status: "failed",
          plannedCount: 0,
          counts: { succeeded: 0, failed: 0, cancelled: 0, pending: 0 },
          estimatedCostUsd: 0,
          budgetCapUsd: p.perScanBudgetUsd,
          configFingerprint: "n/a",
          repetitions: p.repetitions,
          stopReason: reason,
          createdBy: "scheduler",
          createdAt: ts,
          finishedAt: ts,
          updatedAt: ts,
        }),
      );
      await audit(tenantId, "scheduler", "scan.schedule_blocked", { projectId: p.projectId, target: scanId, detail: { reason } });
      results.push({ projectId: p.projectId, period, outcome: "blocked", scanId, detail: reason });
    }
  }
  return results;
}

const MAX_HOPS = Number(process.env.AIV_MAX_WORKER_HOPS || 40);
export function workerBudgetMs(): number {
  return Number(process.env.AIV_WORKER_BUDGET_MS || 240_000);
}

/** Fire-and-forget call to the protected worker route (chains processing across invocations). */
export async function kickWorker(origin: string, hop: number): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (!secret || hop > MAX_HOPS || !origin) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    await fetch(`${origin.replace(/\/$/, "")}/api/seo/ai-visibility/worker`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "x-aiv-hop": String(hop) },
      signal: ctrl.signal,
    }).catch(() => undefined);
    clearTimeout(t);
    return true;
  } catch {
    return false;
  }
}

export function appOrigin(request: Request): string {
  return process.env.AIV_WORKER_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
}

/**
 * Process the queue after the HTTP response is sent (Next.js `after`). If work
 * remains when the time budget is used up, chain another worker invocation.
 */
export function processInBackground(origin: string, tenantId: string, hop = 0): void {
  after(async () => {
    try {
      const report = await processQueue({ tenantId, deadlineMs: workerBudgetMs() });
      if (report.remaining > 0 && (report.nextDueInMs ?? 0) < 10 * 60_000) await kickWorker(origin, hop + 1);
    } catch (e) {
      console.error("[aiv] background processing failed:", e instanceof Error ? e.message : e);
    }
  });
}
