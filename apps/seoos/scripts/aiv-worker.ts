/**
 * Long-running AI-visibility worker for hosts that are not serverless (a VM,
 * container or `npm run aiv:worker` on a workstation). On Vercel the cron route
 * + after()/self-chaining does the same job and this script is not needed.
 *
 *   npm run aiv:worker -w apps/seoos            # loop forever
 *   AIV_WORKER_ONCE=true npm run aiv:worker -w apps/seoos   # one scheduler pass + drain, then exit
 *
 * Reads env from the process (and .env.local / .env when present). Safe to run
 * alongside the cron: jobs are claimed with transactional leases.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadDotEnv(): void {
  for (const rel of [".env.local", ".env"]) {
    const p = resolve(process.cwd(), rel);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v.replace(/\\n/g, "\n");
    }
  }
}

async function main() {
  loadDotEnv();
  const { getServerEnv } = await import("../src/lib/server/env");
  const { processQueue } = await import("../src/lib/server/ai-visibility/queue");
  const { runScheduler } = await import("../src/lib/server/ai-visibility/scheduler");
  const tenantId = process.env.AIV_TENANT_ID || getServerEnv().pilotTenantId;
  const once = process.env.AIV_WORKER_ONCE === "true";
  let lastSchedule = 0;
  let stopping = false;
  process.on("SIGINT", () => (stopping = true));
  process.on("SIGTERM", () => (stopping = true));
  console.log(`[aiv-worker] tenant=${tenantId} once=${once}`);
  do {
    if (Date.now() - lastSchedule > 60 * 60_000 || once) {
      const results = await runScheduler(tenantId);
      lastSchedule = Date.now();
      const started = results.filter((r) => r.outcome === "started");
      if (started.length || once) console.log(`[aiv-worker] scheduler: ${JSON.stringify(results)}`);
    }
    const report = await processQueue({ tenantId, deadlineMs: once ? 280_000 : 55_000 });
    if (report.processed || once) console.log(`[aiv-worker] ${JSON.stringify(report)}`);
    if (once && report.remaining === 0) break;
    if (!once && report.remaining === 0) await new Promise((r) => setTimeout(r, 15_000));
  } while (!stopping && !once);
  if (once) {
    const final = await processQueue({ tenantId, deadlineMs: 1000 });
    console.log(`[aiv-worker] done; remaining=${final.remaining}`);
  }
}

main().catch((e) => {
  console.error("[aiv-worker] fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
