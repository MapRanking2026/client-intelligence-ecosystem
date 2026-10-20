import { randomUUID } from "node:crypto";

import { newId, nowIso } from "@/src/lib/ids";
import { costFromUsage, estimateObservation, priceFor, round6 } from "@/src/lib/ai-visibility/cost";
import {
  AivObservationV1,
  type AivAttemptV1,
  type AivJobV1,
  type AivScanV1,
  type CollectionStatus,
} from "@/src/lib/ai-visibility/types";
import { backoffMs } from "@/src/lib/ai-visibility/util";
import { analyze } from "./analysis-service";
import { ledgersFor, release, reserve } from "./budget";
import { getProfile } from "./profile-service";
import { fixtureEnabled } from "./providers/fixture";
import { getAdapter } from "./providers/registry";
import { ProviderCallError, redact, type CollectionResult } from "./providers/types";
import { cancelScan, refreshScan } from "./scan-service";
import { getAgencySettings, getProviderSettings } from "./settings-service";
import { attempts, jobs, observations, scans } from "./store";

/**
 * Durable, resumable job processing.
 *
 * - Claim: transactional lease on one job doc (status queued & due, or leased
 *   with an expired lease = interrupted processing).
 * - Idempotent: observation id == job id; a success observation is written
 *   with create-if-absent semantics (only a prior FAILURE record may be
 *   replaced), so retries and reclaims never double-count.
 * - Every provider call gets an attempt doc written BEFORE the call; if the
 *   worker dies, the reclaim marks it `interrupted` and releases its budget
 *   reservation.
 * - Bounded concurrency per provider (settings.maxConcurrency, counted across
 *   workers via live leases) and a per-process request spacing derived from
 *   requestsPerMinute. Retries use exponential backoff with full jitter.
 */

const LEASE_GRACE_MS = 30_000;
const lastRequestAt = new Map<string, number>();

export interface ProcessOptions {
  tenantId: string;
  deadlineMs: number;
  owner?: string;
  concurrency?: number;
  /** Test hook: simulate a crash after the observation write. */
  crashAfterObservationWrite?: (jobId: string) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

export interface ProcessReport {
  owner: string;
  processed: number;
  succeeded: number;
  failed: number;
  retried: number;
  reclaimed: number;
  budgetStops: number;
  remaining: number;
  nextDueInMs: number | null;
}

const ACTIVE: AivScanV1["status"][] = ["queued", "running"];

async function activeScans(tenantId: string): Promise<AivScanV1[]> {
  const out: AivScanV1[] = [];
  for (const st of ACTIVE) out.push(...(await scans().listWhere(tenantId, "status", st)));
  return out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

function due(j: AivJobV1, now: number): boolean {
  if (j.status === "queued") return Date.parse(j.nextAttemptAt) <= now;
  if (j.status === "leased") return !j.leaseExpiresAt || Date.parse(j.leaseExpiresAt) < now;
  return false;
}

async function liveLeases(tenantId: string, scanList: AivScanV1[], providerId: string): Promise<number> {
  const now = Date.now();
  let n = 0;
  for (const s of scanList) {
    for (const j of await jobs().listWhere(tenantId, "scanId", s.id)) {
      if (j.status === "leased" && j.slot.providerId === providerId && j.leaseExpiresAt && Date.parse(j.leaseExpiresAt) >= now) n += 1;
    }
  }
  return n;
}

async function claim(tenantId: string, jobId: string, owner: string, leaseMs: number): Promise<{ job: AivJobV1; reclaimed: boolean } | null> {
  return jobs().transact(tenantId, jobId, (cur) => {
    const now = Date.now();
    if (!cur || !due(cur, now)) return { next: null, result: null };
    const reclaimed = cur.status === "leased";
    const next: AivJobV1 = {
      ...cur,
      status: "leased",
      leaseOwner: owner,
      leaseExpiresAt: new Date(now + leaseMs).toISOString(),
      updatedAt: nowIso(),
    };
    return { next, result: { job: next, reclaimed } };
  });
}

async function finishJob(tenantId: string, jobId: string, owner: string, patch: Partial<AivJobV1>) {
  await jobs().transact(tenantId, jobId, (cur) => {
    if (!cur || cur.leaseOwner !== owner) return { next: null, result: null };
    return { next: { ...cur, ...patch, leaseOwner: undefined, leaseExpiresAt: undefined, updatedAt: nowIso() }, result: null };
  });
}

/** Mark attempts left `in_progress` by a dead worker as interrupted and release their reservations. */
async function recoverInterrupted(tenantId: string, job: AivJobV1, scan: AivScanV1) {
  const profile = await getProfile(tenantId, job.projectId);
  const agency = await getAgencySettings(tenantId);
  for (const a of await attempts().listWhere(tenantId, "jobId", job.id)) {
    if (a.outcome !== "in_progress") continue;
    await attempts().set(tenantId, a.id, {
      ...a,
      outcome: "interrupted",
      finishedAt: nowIso(),
      errorMessage: "Worker stopped before the call completed; the provider may still have billed this call (cost unknown).",
      costBasis: "unknown",
    });
    if (a.reservedUsd > 0) {
      await release(tenantId, ledgersFor(scan, profile?.monthlyBudgetUsd ?? 0, agency.monthlyAgencyCapUsd, new Date(a.startedAt)), a.reservedUsd, 0);
    }
  }
}

function failureObservation(job: AivJobV1, scan: AivScanV1, status: CollectionStatus, message: string, attemptCount: number, surface: string): AivObservationV1 {
  const now = nowIso();
  return AivObservationV1.parse({
    schemaVersion: 1,
    id: job.id,
    tenantId: job.tenantId,
    projectId: job.projectId,
    clientId: scan.clientId,
    scanId: scan.id,
    jobId: job.id,
    channel: "official_api",
    isFixture: job.slot.providerId === "fixture",
    providerId: job.slot.providerId,
    surface,
    model: job.slot.model,
    promptId: job.slot.promptId,
    promptVersion: job.slot.promptVersion,
    promptGroup: job.slot.promptGroup,
    branded: job.slot.branded,
    submittedText: job.slot.submittedText,
    language: job.slot.language,
    serviceId: job.slot.serviceId,
    locationId: job.slot.locationId,
    locationMode: job.slot.locationMode,
    repetition: job.slot.repetition,
    collectedAt: now,
    searchExecuted: null,
    collectionStatus: status,
    collectionError: redact(message).slice(0, 1000),
    attemptCount,
    createdAt: now,
    updatedAt: now,
  });
}

/** Write an observation unless a SUCCESS record already exists for this slot. */
async function writeObservation(tenantId: string, obs: AivObservationV1): Promise<"created" | "replaced_failure" | "kept_existing"> {
  return observations().transact(tenantId, obs.id, (cur) => {
    if (!cur) return { next: obs, result: "created" as const };
    if (cur.collectionStatus === "success") return { next: null, result: "kept_existing" as const };
    // A failure record may be replaced by a later outcome (retry). Keep createdAt.
    return { next: { ...obs, createdAt: cur.createdAt }, result: "replaced_failure" as const };
  });
}

async function runJob(opts: ProcessOptions, owner: string, job: AivJobV1, reclaimed: boolean, report: ProcessReport) {
  const { tenantId } = opts;
  const scan = await scans().get(tenantId, job.scanId);
  if (!scan) {
    await finishJob(tenantId, job.id, owner, { status: "failed", lastErrorClass: "provider_error", lastError: "Scan missing" });
    return;
  }
  if (reclaimed) {
    report.reclaimed += 1;
    await recoverInterrupted(tenantId, job, scan);
  }
  if (scan.status === "cancelled" || scan.status === "budget_stopped") {
    await finishJob(tenantId, job.id, owner, { status: "cancelled", lastErrorClass: "cancelled", lastError: scan.stopReason });
    return;
  }
  // Resume idempotency: the observation was written but the job update was lost.
  const existing = await observations().get(tenantId, job.id);
  if (existing && existing.collectionStatus === "success") {
    await finishJob(tenantId, job.id, owner, { status: "succeeded", observationId: existing.id });
    report.succeeded += 1;
    return;
  }

  const profile = await getProfile(tenantId, job.projectId);
  if (!profile) {
    await finishJob(tenantId, job.id, owner, { status: "failed", lastErrorClass: "provider_error", lastError: "Client profile missing" });
    return;
  }
  const adapter = getAdapter(job.slot.providerId);
  if (job.slot.providerId === "fixture" && !fixtureEnabled()) {
    await finishJob(tenantId, job.id, owner, { status: "failed", lastErrorClass: "provider_error", lastError: "Fixture provider disabled" });
    return;
  }
  const settings = await getProviderSettings(tenantId, job.slot.providerId);
  const price = priceFor(job.slot.providerId, job.slot.model);
  const agency = await getAgencySettings(tenantId);
  const ledgers = ledgersFor(scan, profile.monthlyBudgetUsd, agency.monthlyAgencyCapUsd);

  // 1) No verified price → no call (caps could not be enforced).
  if (!price) {
    await finishJob(tenantId, job.id, owner, { status: "failed", lastErrorClass: "provider_error", lastError: `No verified price for ${job.slot.model}` });
    return;
  }
  const upper = estimateObservation(price, settings.maxSearchUses, settings.maxOutputTokens).upperBoundUsd;

  // 2) Attempt record BEFORE reserving/calling, so no reservation or call can be lost.
  const attemptNumber = job.attempts + 1;
  const attempt: AivAttemptV1 = {
    schemaVersion: 1,
    id: newId("att"),
    tenantId,
    projectId: job.projectId,
    scanId: job.scanId,
    jobId: job.id,
    attemptNumber,
    providerId: job.slot.providerId,
    model: job.slot.model,
    startedAt: nowIso(),
    latencyMs: 0,
    outcome: "in_progress",
    retryable: false,
    costUsd: 0,
    costBasis: "unknown",
    reservedUsd: upper,
    leaseOwner: owner,
  };
  await attempts().set(tenantId, attempt.id, attempt);

  // 3) Budget reservation (worst case for this call).
  const res = await reserve(tenantId, ledgers, upper);
  if (!res.ok) {
    report.budgetStops += 1;
    const msg = `Stopped: ${res.ledger.scope} cap ${res.ledger.capUsd.toFixed(2)} USD would be exceeded (used ${res.used.toFixed(4)} USD).`;
    await attempts().set(tenantId, attempt.id, { ...attempt, outcome: "budget_blocked", finishedAt: nowIso(), reservedUsd: 0, costBasis: "not_billed", errorMessage: msg });
    await finishJob(tenantId, job.id, owner, { status: "cancelled", lastErrorClass: "budget_blocked", lastError: msg });
    await cancelScan(tenantId, scan.id, "system", `Spending cap reached (${res.ledger.scope}). Remaining slots were not run.`, "budget_stopped");
    return;
  }
  await jobs().transact(tenantId, job.id, (cur) => (cur && cur.leaseOwner === owner ? { next: { ...cur, attempts: attemptNumber, updatedAt: nowIso() }, result: null } : { next: null, result: null }));

  // 4) Rate spacing within this process.
  const minGap = Math.ceil(60_000 / Math.max(1, settings.requestsPerMinute));
  const last = lastRequestAt.get(job.slot.providerId) ?? 0;
  const wait = last + minGap - Date.now();
  lastRequestAt.set(job.slot.providerId, Math.max(Date.now(), last + minGap));
  if (wait > 0) await (opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))))(wait);

  const loc = profile.locations.find((l) => l.id === job.slot.locationId);
  const t0 = Date.now();
  let result: CollectionResult | null = null;
  let err: ProviderCallError | null = null;
  try {
    result = await adapter.collect({
      prompt: job.slot.submittedText,
      model: job.slot.model,
      maxSearchUses: settings.maxSearchUses,
      maxOutputTokens: settings.maxOutputTokens,
      timeoutMs: settings.timeoutMs,
      language: job.slot.language,
      location: loc ? { city: loc.city, region: loc.region, country: loc.country, timezone: profile.timezone } : undefined,
    });
  } catch (e) {
    err = e instanceof ProviderCallError ? e : new ProviderCallError("provider_error", e instanceof Error ? e.message : "unknown error", false);
  }
  const latencyMs = Date.now() - t0;

  if (result) {
    const cost = costFromUsage(price, result.usage);
    await release(tenantId, ledgers, upper, cost);
    await attempts().set(tenantId, attempt.id, {
      ...attempt,
      finishedAt: nowIso(),
      latencyMs,
      outcome: result.status,
      requestId: result.requestId,
      costUsd: cost,
      costBasis: "calculated_from_reported_usage",
    });
    const now = nowIso();
    let obs = AivObservationV1.parse({
      schemaVersion: 1,
      id: job.id,
      tenantId,
      projectId: job.projectId,
      clientId: scan.clientId,
      scanId: scan.id,
      jobId: job.id,
      channel: "official_api",
      isFixture: job.slot.providerId === "fixture",
      providerId: job.slot.providerId,
      surface: adapter.surfaceLabel,
      model: result.model,
      apiVersion: result.apiVersion,
      promptId: job.slot.promptId,
      promptVersion: job.slot.promptVersion,
      promptGroup: job.slot.promptGroup,
      branded: job.slot.branded,
      submittedText: job.slot.submittedText,
      language: job.slot.language,
      serviceId: job.slot.serviceId,
      locationId: job.slot.locationId,
      locationMode: job.slot.locationMode,
      requestedLocation: loc ? { city: loc.city, region: loc.region, country: loc.country, timezone: profile.timezone } : undefined,
      appliedLocation: result.appliedLocation,
      repetition: job.slot.repetition,
      collectedAt: now,
      searchConfig: result.searchConfig,
      generationSettings: result.generationSettings,
      searchExecuted: result.searchExecuted,
      searchQueries: result.searchQueries,
      searchResults: result.searchResults,
      collectionStatus: result.status,
      collectionError: result.note,
      answerText: result.answerText,
      citations: result.citations,
      rawResponse: result.rawResponse,
      rawResponseTruncated: result.rawResponseTruncated,
      stopReason: result.stopReason,
      requestId: result.requestId,
      usage: result.usage,
      latencyMs,
      costUsd: cost,
      costBasis: "calculated_from_reported_usage",
      attemptCount: attemptNumber,
      createdAt: now,
      updatedAt: now,
    });
    obs = analyze(obs, profile);
    await writeObservation(tenantId, obs);
    if (opts.crashAfterObservationWrite?.(job.id)) throw new Error("simulated crash after observation write");
    await finishJob(tenantId, job.id, owner, { status: "succeeded", observationId: obs.id, lastErrorClass: undefined, lastError: undefined });
    await scans().transact(tenantId, scan.id, (cur) => (cur ? { next: { ...cur, actualCostUsd: round6(cur.actualCostUsd + cost), updatedAt: nowIso() }, result: null } : { next: null, result: null }));
    report.succeeded += 1;
    return;
  }

  // Error path. Errored calls are not billed by the provider (cost 0, "not_billed").
  await release(tenantId, ledgers, upper, 0);
  const e = err!;
  await attempts().set(tenantId, attempt.id, {
    ...attempt,
    finishedAt: nowIso(),
    latencyMs,
    outcome: e.errorClass,
    errorMessage: redact(e.message).slice(0, 1000),
    httpStatus: e.extra.httpStatus,
    requestId: e.extra.requestId,
    retryable: e.retryable,
    costUsd: 0,
    costBasis: "not_billed",
  });
  if (e.retryable && attemptNumber < job.maxAttempts) {
    const delay = backoffMs(attemptNumber, { retryAfterMs: e.extra.retryAfterMs, baseMs: Number(process.env.AIV_BACKOFF_BASE_MS) || 2000 });
    await finishJob(tenantId, job.id, owner, {
      status: "queued",
      nextAttemptAt: new Date(Date.now() + delay).toISOString(),
      lastErrorClass: e.errorClass,
      lastError: redact(e.message).slice(0, 500),
    });
    report.retried += 1;
    return;
  }
  await writeObservation(tenantId, failureObservation(job, scan, e.errorClass, e.message, attemptNumber, adapter.surfaceLabel));
  await finishJob(tenantId, job.id, owner, { status: "failed", lastErrorClass: e.errorClass, lastError: redact(e.message).slice(0, 500) });
  report.failed += 1;
}

/**
 * Process due jobs until the deadline. Safe to run concurrently from several
 * invocations (leases are transactional). Returns what remains so callers can
 * decide whether to chain another invocation.
 */
export async function processQueue(opts: ProcessOptions): Promise<ProcessReport> {
  const owner = opts.owner ?? `w_${randomUUID().slice(0, 8)}`;
  const deadline = Date.now() + opts.deadlineMs;
  const concurrency = Math.max(1, Math.min(8, opts.concurrency ?? 3));
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const report: ProcessReport = { owner, processed: 0, succeeded: 0, failed: 0, retried: 0, reclaimed: 0, budgetStops: 0, remaining: 0, nextDueInMs: null };
  const touched = new Set<string>();

  const pickBatch = async (): Promise<{ batch: Array<{ job: AivJobV1; reclaimed: boolean }>; remaining: number; nextDue: number | null }> => {
    const scanList = await activeScans(opts.tenantId);
    const now = Date.now();
    let remaining = 0;
    let nextDue: number | null = null;
    const candidates: AivJobV1[] = [];
    for (const s of scanList) {
      for (const j of await jobs().listWhere(opts.tenantId, "scanId", s.id)) {
        if (j.status !== "queued" && j.status !== "leased") continue;
        remaining += 1;
        if (due(j, now)) candidates.push(j);
        else {
          const at = j.status === "queued" ? Date.parse(j.nextAttemptAt) : Date.parse(j.leaseExpiresAt ?? j.updatedAt);
          nextDue = nextDue === null ? at - now : Math.min(nextDue, at - now);
        }
      }
    }
    const batch: Array<{ job: AivJobV1; reclaimed: boolean }> = [];
    const perProvider = new Map<string, number>();
    for (const j of candidates) {
      if (batch.length >= concurrency) break;
      const pid = j.slot.providerId;
      const settings = await getProviderSettings(opts.tenantId, pid);
      const inFlight = (perProvider.get(pid) ?? 0) + (await liveLeases(opts.tenantId, scanList, pid));
      if (inFlight >= settings.maxConcurrency) continue;
      const claimed = await claim(opts.tenantId, j.id, owner, settings.timeoutMs * 2 + LEASE_GRACE_MS);
      if (!claimed) continue;
      perProvider.set(pid, (perProvider.get(pid) ?? 0) + 1);
      batch.push(claimed);
    }
    return { batch, remaining, nextDue };
  };

  while (Date.now() < deadline) {
    const { batch, remaining, nextDue } = await pickBatch();
    report.remaining = remaining;
    report.nextDueInMs = nextDue;
    if (!batch.length) {
      if (remaining === 0) break;
      // Nothing due now: wait for the next due job if it fits in the deadline.
      const waitMs = nextDue === null ? 1000 : Math.max(200, nextDue);
      if (Date.now() + waitMs >= deadline - 1000) break;
      await sleep(Math.min(waitMs, 15_000));
      continue;
    }
    await Promise.all(
      batch.map(async ({ job, reclaimed }) => {
        touched.add(job.scanId);
        report.processed += 1;
        try {
          await runJob(opts, owner, job, reclaimed, report);
        } catch (e) {
          // Unexpected failure: leave the lease to expire so the job is reclaimed and resumed.
          console.error("[aiv] job crashed:", job.id, e instanceof Error ? e.message : e);
        }
      }),
    );
    for (const sid of touched) await refreshScan(opts.tenantId, sid);
  }
  for (const sid of touched) await refreshScan(opts.tenantId, sid);
  const final = await pickBatchCount(opts.tenantId);
  report.remaining = final.remaining;
  report.nextDueInMs = final.nextDue;
  return report;
}

async function pickBatchCount(tenantId: string): Promise<{ remaining: number; nextDue: number | null }> {
  const now = Date.now();
  let remaining = 0;
  let nextDue: number | null = null;
  for (const s of await activeScans(tenantId)) {
    for (const j of await jobs().listWhere(tenantId, "scanId", s.id)) {
      if (j.status !== "queued" && j.status !== "leased") continue;
      remaining += 1;
      const at = j.status === "queued" ? Date.parse(j.nextAttemptAt) : Date.parse(j.leaseExpiresAt ?? j.updatedAt);
      nextDue = nextDue === null ? Math.max(0, at - now) : Math.min(nextDue, Math.max(0, at - now));
    }
  }
  return { remaining, nextDue };
}
