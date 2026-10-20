/**
 * Integration tests for durable scan processing with the FIXTURE provider.
 * Runs against the memory store by default, or the Firestore emulator when
 * FIRESTORE_EMULATOR_HOST + FIREBASE_* are set (npm run test:aiv:emulator).
 * Uses an isolated tenant id; fixture observations are flagged isFixture.
 */
process.env.AIV_ENABLE_FIXTURE_PROVIDER = "true";
process.env.AIV_BACKOFF_BASE_MS = "50";

import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { computeMetrics } from "@/src/lib/ai-visibility/metrics";
import { AivProfileV1 } from "@/src/lib/ai-visibility/types";
import { resetFixtureCalls } from "../providers/fixture";
import { createPrompt, editPrompt } from "../prompt-service";
import { processQueue } from "../queue";
import { cancelScan, listJobs, planScan, retryFailed, startScan } from "../scan-service";
import { runScheduler } from "../scheduler";
import { saveAgencySettings, saveProviderSettings } from "../settings-service";
import { attempts, jobs, observations, profiles, resetMemoryStore, scans, spend, storeBackend } from "../store";

const TENANT = `aiv-test-${Date.now().toString(36)}`;
let projectSeq = 0;

async function setupClient(opts: { perScanBudgetUsd?: number; prompts?: string[]; frequency?: "manual" | "weekly" } = {}) {
  projectSeq += 1;
  const projectId = `proj_${projectSeq}`;
  const now = new Date().toISOString();
  const profile = AivProfileV1.parse({
    schemaVersion: 1,
    tenantId: TENANT,
    projectId,
    clientId: `client_${projectSeq}`,
    status: "active",
    businessName: "Sparkle Pro Cleaning LLC",
    aliases: [{ id: "a1", value: "Sparkle Pro", status: "approved", source: "user" }],
    ownedDomains: [{ id: "d1", value: "sparkleprocleaning.com", status: "approved", source: "user" }],
    services: [{ id: "s1", value: "Deep Cleaning", status: "approved", source: "user" }],
    locations: [{ id: "l1", city: "La Vergne", region: "TN", country: "US", status: "approved", source: "user" }],
    competitors: [{ id: "c1", name: "Music City Maids", status: "approved", source: "user" }],
    providerIds: ["fixture"],
    repetitions: 2,
    perScanBudgetUsd: opts.perScanBudgetUsd ?? 5,
    monthlyBudgetUsd: 50,
    scanFrequency: opts.frequency ?? "manual",
    createdAt: now,
    updatedAt: now,
  });
  await profiles().set(TENANT, projectId, profile);
  for (const text of opts.prompts ?? ["Who offers reliable deep cleaning in La Vergne, TN?", "What are the best deep cleaning companies in La Vergne, TN?"]) {
    const p = await createPrompt(profile, { text, group: "unbranded_discovery", serviceId: "s1", locationId: "l1" }, "tester");
    await editPrompt(profile, p.id, { status: "approved" }, "tester");
  }
  return profile;
}

before(async () => {
  resetMemoryStore();
  await saveProviderSettings(TENANT, "fixture", { enabled: true, model: "fixture-1", timeoutMs: 5000, requestsPerMinute: 600, maxConcurrency: 2 }, "tester");
  await saveAgencySettings(TENANT, 100, "tester");
  console.log(`[aiv tests] store backend: ${storeBackend()}`);
});
beforeEach(() => resetFixtureCalls());
after(() => undefined);

const run = (ms = 20000) => processQueue({ tenantId: TENANT, deadlineMs: ms, concurrency: 3 });
const obsFor = async (projectId: string) => (await observations().listWhere(TENANT, "projectId", projectId)).filter((o) => o.projectId === projectId);

test("plan shows matrix + estimate; scan completes with persisted evidence", async () => {
  const profile = await setupClient();
  const plan = await planScan(profile, {});
  assert.equal(plan.blockers.length, 0, plan.blockers.join(" "));
  assert.equal(plan.slots.length, 4, "2 prompts × 1 location × 1 provider × 2 reps");
  assert.ok(plan.estimatedCostUsd > 0);
  const { scan } = await startScan(profile, {}, { actor: "tester", trigger: "manual" });
  const report = await run();
  assert.equal(report.succeeded, 4);
  const s = (await scans().get(TENANT, scan.id))!;
  assert.equal(s.status, "completed");
  assert.equal(s.counts.succeeded, 4);
  const obs = await obsFor(profile.projectId);
  assert.equal(obs.length, 4);
  for (const o of obs) {
    assert.equal(o.isFixture, true);
    assert.equal(o.channel, "official_api");
    assert.equal(o.collectionStatus, "success");
    assert.equal(o.citations.length, 2, "duplicate Yelp citation (utm variant) deduplicated");
    assert.equal(o.analysis?.status, "analyzed");
    const c = o.analysis!.entities.find((e) => e.entityKey === "client")!;
    assert.equal(c.position, 2);
    assert.equal(c.ownedDomainCited, true);
    assert.ok(o.usage && o.costUsd > 0);
    assert.equal(o.appliedLocation?.city, "La Vergne");
  }
  const totalCost = obs.reduce((x, o) => x + o.costUsd, 0);
  assert.ok(Math.abs(s.actualCostUsd - totalCost) < 1e-6, "scan cost = sum of observation costs");
  // Metrics computed from stored observations (fixture data is excluded from live metrics by design).
  const live = computeMetrics(obs, { channel: "official_api", branded: false });
  assert.equal(live.sample.total, 0, "fixture observations never enter live metrics");
  const fx = computeMetrics(obs.map((o) => ({ ...o, isFixture: false })), { channel: "official_api", branded: false });
  assert.equal(fx.mentionRate.num, 4);
  assert.equal(fx.mentionRate.den, 4);
  assert.equal(fx.top3.den, 4);
  assert.equal(fx.top3.num, 4);
});

test("rate limits retry with backoff; attempts recorded, one observation", async () => {
  const profile = await setupClient({ prompts: ["Who offers reliable deep cleaning in La Vergne, TN? [rate_limit:2]"] });
  await startScan(profile, { repetitions: 1 }, { actor: "tester", trigger: "manual" });
  await run();
  const obs = await obsFor(profile.projectId);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].collectionStatus, "success");
  assert.equal(obs[0].attemptCount, 3);
  const atts = await attempts().listWhere(TENANT, "jobId", obs[0].id);
  assert.equal(atts.length, 3);
  assert.deepEqual(atts.map((a) => a.outcome).sort(), ["rate_limited", "rate_limited", "success"]);
});

test("failed job → retry in place without duplicate measurements", async () => {
  const profile = await setupClient({ prompts: ["Who offers reliable deep cleaning in La Vergne, TN? [rate_limit:5]"] });
  const { scan } = await startScan(profile, { repetitions: 1 }, { actor: "tester", trigger: "manual" });
  await run();
  let s = (await scans().get(TENANT, scan.id))!;
  assert.equal(s.status, "failed");
  let obs = await obsFor(profile.projectId);
  assert.equal(obs.length, 1);
  assert.equal(obs[0].collectionStatus, "rate_limited", "failure is recorded, not zero visibility");
  const m = computeMetrics(obs.map((o) => ({ ...o, isFixture: false })), { channel: "official_api", branded: false });
  assert.equal(m.mentionRate.den, 0);
  assert.equal(m.mentionRate.value, null, "no valid answers → no rate (not 0%)");
  assert.equal(m.sample.not_collected, 1);

  const { requeued } = await retryFailed(TENANT, scan.id, "tester");
  assert.equal(requeued, 1);
  await run();
  s = (await scans().get(TENANT, scan.id))!;
  assert.equal(s.status, "completed");
  obs = await obsFor(profile.projectId);
  assert.equal(obs.length, 1, "still exactly one observation for the slot");
  assert.equal(obs[0].collectionStatus, "success");
  const atts = await attempts().listWhere(TENANT, "jobId", obs[0].id);
  assert.equal(atts.length, 6, "all attempts preserved (4 + 2)");
});

test("resume: crash after write and crash mid-call are recovered without double counting", async () => {
  const profile = await setupClient({ prompts: ["Who offers reliable deep cleaning in La Vergne, TN?"] });
  const { scan } = await startScan(profile, { repetitions: 2 }, { actor: "tester", trigger: "manual" });
  const js = await listJobs(TENANT, scan.id);
  // Crash after the first observation write.
  await processQueue({ tenantId: TENANT, deadlineMs: 3000, concurrency: 1, crashAfterObservationWrite: (id) => id === js[0].id });
  let j0 = (await jobs().get(TENANT, js[0].id))!;
  assert.equal(j0.status, "leased", "lease left behind by the crashed worker");
  // Simulate a crash in the middle of the provider call for job 2.
  const j1 = (await jobs().get(TENANT, js[1].id))!;
  if (j1.status !== "succeeded") {
    await jobs().set(TENANT, j1.id, { ...j1, status: "leased", leaseOwner: "dead", leaseExpiresAt: new Date(Date.now() - 1000).toISOString() });
    await attempts().set(TENANT, "att_dead", {
      schemaVersion: 1, id: "att_dead", tenantId: TENANT, projectId: profile.projectId, scanId: scan.id, jobId: j1.id,
      attemptNumber: 1, providerId: "fixture", model: "fixture-1", startedAt: new Date().toISOString(), latencyMs: 0,
      outcome: "in_progress", retryable: false, costUsd: 0, costBasis: "unknown", reservedUsd: 0.5,
    });
  }
  // Time passes: expire the crashed lease.
  await jobs().set(TENANT, j0.id, { ...j0, leaseExpiresAt: new Date(Date.now() - 1000).toISOString() });
  const report = await run();
  assert.ok(report.reclaimed >= 1);
  j0 = (await jobs().get(TENANT, js[0].id))!;
  assert.equal(j0.status, "succeeded");
  const obs = await obsFor(profile.projectId);
  assert.equal(obs.length, 2, "two slots → two observations, no duplicates");
  const s = (await scans().get(TENANT, scan.id))!;
  assert.equal(s.status, "completed");
  const dead = await attempts().get(TENANT, "att_dead");
  if (dead) assert.equal(dead.outcome, "interrupted");
  const ledger = await spend().get(TENANT, `scan__${scan.id}`);
  assert.ok(ledger && ledger.reservedUsd < 1e-6, "no reservation leaked after recovery");
});

test("spending cap reached mid-scan stops the scan safely", async () => {
  const profile = await setupClient({ perScanBudgetUsd: 1 });
  const { scan } = await startScan(profile, {}, { actor: "tester", trigger: "manual" });
  // The client's monthly budget is lowered after the scan was queued.
  await profiles().set(TENANT, profile.projectId, { ...profile, monthlyBudgetUsd: 0.1 });
  await run();
  const s = (await scans().get(TENANT, scan.id))!;
  assert.equal(s.status, "budget_stopped");
  assert.ok(s.counts.cancelled > 0, "remaining slots cancelled");
  assert.ok(s.counts.succeeded >= 1);
  const month = new Date().toISOString().slice(0, 7);
  const ledger = (await spend().get(TENANT, `client__${profile.projectId}__${month}`))!;
  assert.ok(ledger.calculatedUsd <= 0.1 + 1e-9, "never exceeds the cap");
  assert.equal(ledger.reservedUsd, 0, "no reservation left behind");
  const blocked = (await attempts().listWhere(TENANT, "scanId", scan.id)).filter((a) => a.outcome === "budget_blocked");
  assert.ok(blocked.length >= 1);
  assert.equal((await obsFor(profile.projectId)).length, s.counts.succeeded, "no observation for slots that never ran");
});

test("estimate over cap blocks start", async () => {
  const profile = await setupClient({ perScanBudgetUsd: 0.001 });
  const plan = await planScan(profile, {});
  assert.ok(plan.blockers.some((b) => /per-scan cap/.test(b)));
  await assert.rejects(() => startScan(profile, {}, { actor: "tester", trigger: "manual" }), /Scan not started/);
});

test("cancellation stops queued work", async () => {
  const profile = await setupClient();
  const { scan } = await startScan(profile, {}, { actor: "tester", trigger: "manual" });
  await cancelScan(TENANT, scan.id, "tester");
  await run(3000);
  const s = (await scans().get(TENANT, scan.id))!;
  assert.equal(s.status, "cancelled");
  assert.equal(s.counts.cancelled, 4);
  assert.equal((await obsFor(profile.projectId)).length, 0);
});

test("non-retryable credential error is recorded once", async () => {
  const profile = await setupClient({ prompts: ["Who offers reliable deep cleaning in La Vergne, TN? [auth]"] });
  await startScan(profile, { repetitions: 1 }, { actor: "tester", trigger: "manual" });
  await run();
  const obs = await obsFor(profile.projectId);
  assert.equal(obs[0].collectionStatus, "auth_error");
  assert.equal((await attempts().listWhere(TENANT, "jobId", obs[0].id)).length, 1);
});

test("partial failure: mixed outcomes yield a partial scan", async () => {
  const profile = await setupClient({ prompts: ["Who offers reliable deep cleaning in La Vergne, TN?", "What are the best deep cleaning companies in La Vergne, TN? [malformed]"] });
  const { scan } = await startScan(profile, { repetitions: 1 }, { actor: "tester", trigger: "manual" });
  await run();
  const s = (await scans().get(TENANT, scan.id))!;
  assert.equal(s.status, "partial");
  const obs = await obsFor(profile.projectId);
  assert.deepEqual(obs.map((o) => o.collectionStatus).sort(), ["parse_failure", "success"]);
});

test("scheduler creates one scan per period (idempotent) and the worker runs it", async () => {
  const profile = await setupClient({ frequency: "weekly" });
  const t = new Date("2026-10-19T15:00:00Z");
  const r1 = (await runScheduler(TENANT, t)).filter((r) => r.projectId === profile.projectId);
  const r2 = (await runScheduler(TENANT, t)).filter((r) => r.projectId === profile.projectId);
  assert.equal(r1[0].outcome, "started");
  assert.equal(r2[0].outcome, "already_exists");
  assert.equal(r1[0].scanId, r2[0].scanId);
  await run();
  const s = (await scans().get(TENANT, r1[0].scanId))!;
  assert.equal(s.trigger, "scheduled");
  assert.equal(s.status, "completed");
});
