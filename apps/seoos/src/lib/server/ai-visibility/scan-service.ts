import { newId, nowIso } from "@/src/lib/ids";
import { estimateObservation, priceFor, round6 } from "@/src/lib/ai-visibility/cost";
import {
  AivJobV1,
  AivScanV1,
  currentPromptText,
  TERMINAL_SCAN_STATUSES,
  type AivProfileV1,
  type AivPromptV1,
  type LocationMode,
  type ProviderId,
  type ScanSlot,
} from "@/src/lib/ai-visibility/types";
import { canonicalJson, stableHash } from "@/src/lib/ai-visibility/util";
import { locationLabel } from "@/src/lib/ai-visibility/prompts";
import { audit } from "./audit";
import { monthSpend } from "./budget";
import { getAdapter } from "./providers/registry";
import { getAgencySettings, listProviderStatus } from "./settings-service";
import { listPrompts } from "./prompt-service";
import { jobs, observations, scans } from "./store";

/**
 * Scan planning and lifecycle. A scan is a fixed matrix
 * prompt × location × provider/model × repetition, estimated and checked
 * against caps BEFORE any job is queued. The server always re-plans; a
 * client-side estimate is never trusted.
 */

export const PILOT_DEFAULTS = { maxPrompts: 10, repetitions: 3 } as const;

export interface PlanInput {
  promptIds?: string[];
  /** Default: unbranded only. Branded prompts are measured in separate scans. */
  branded?: boolean;
  providerIds?: ProviderId[];
  repetitions?: number;
  /** Locations used for "near me" prompts (provider location control). */
  nearMeLocationIds?: string[];
  maxPrompts?: number;
}

export interface ScanPlan {
  slots: ScanSlot[];
  matrix: {
    prompts: Array<{ id: string; version: number; text: string; group: string; location: string; locationMode: LocationMode }>;
    providers: Array<{ providerId: ProviderId; model: string; perObservationUsd: number; upperBoundUsd: number; basis: string }>;
    repetitions: number;
    locations: string[];
  };
  estimatedCostUsd: number;
  upperBoundUsd: number;
  budget: { perScanCapUsd: number; clientMonthRemainingUsd: number; agencyMonthRemainingUsd: number };
  blockers: string[];
  warnings: string[];
  fingerprint: string;
  configSummary: Record<string, string>;
}

async function historicalAvg(tenantId: string, projectId: string, providerId: ProviderId, model: string) {
  const rows = (await observations().listWhere(tenantId, "projectId", projectId)).filter(
    (o) => o.providerId === providerId && o.model === model && o.costBasis === "calculated_from_reported_usage" && !o.isFixture,
  );
  if (!rows.length) return undefined;
  return { avg: rows.reduce((s, o) => s + o.costUsd, 0) / rows.length, n: rows.length };
}

export async function planScan(profile: AivProfileV1, input: PlanInput): Promise<ScanPlan> {
  const tenantId = profile.tenantId;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const branded = input.branded ?? false;
  const allPrompts = await listPrompts(tenantId, profile.projectId);
  let selected: AivPromptV1[] = allPrompts.filter(
    (p) => p.status === "approved" && (p.group === "branded") === branded && (!input.promptIds?.length || input.promptIds.includes(p.id)),
  );
  const maxPrompts = input.maxPrompts ?? PILOT_DEFAULTS.maxPrompts;
  if (selected.length > maxPrompts) {
    warnings.push(`Limited to the first ${maxPrompts} approved prompts (pilot limit).`);
    selected = selected.slice(0, maxPrompts);
  }
  if (!selected.length) blockers.push(branded ? "No approved branded prompts." : "No approved unbranded prompts. Generate and approve prompts first.");
  if (profile.status !== "active") blockers.push("Client profile is not active. Review and activate it in Setup.");

  const statuses = await listProviderStatus(tenantId);
  const providerIds = (input.providerIds?.length ? input.providerIds : profile.providerIds).filter((v, i, a) => a.indexOf(v) === i);
  if (!providerIds.length) blockers.push("No provider selected for this client.");
  const providers: ScanPlan["matrix"]["providers"] = [];
  for (const pid of providerIds) {
    const st = statuses.find((s) => s.providerId === pid);
    if (!st || !st.ready) {
      blockers.push(`${st?.displayName ?? pid}: ${st?.readyReason ?? "Unsupported"}`);
      continue;
    }
    const price = priceFor(pid, st.settings.model)!;
    const est = estimateObservation(price, st.settings.maxSearchUses, st.settings.maxOutputTokens, undefined, await historicalAvg(tenantId, profile.projectId, pid, st.settings.model));
    providers.push({ providerId: pid, model: st.settings.model, perObservationUsd: est.expectedUsd, upperBoundUsd: est.upperBoundUsd, basis: est.basis });
  }

  const repetitions = Math.max(1, Math.min(10, input.repetitions ?? profile.repetitions ?? PILOT_DEFAULTS.repetitions));
  const approvedLocs = profile.locations.filter((l) => l.status === "approved");
  const nearMeLocs = approvedLocs.filter((l) => (input.nearMeLocationIds?.length ? input.nearMeLocationIds.includes(l.id) : l.id === (profile.primaryLocationId ?? approvedLocs[0]?.id)));

  const slots: ScanSlot[] = [];
  const matrixPrompts: ScanPlan["matrix"]["prompts"] = [];
  for (const p of selected) {
    const text = currentPromptText(p);
    const targets = p.nearMe ? nearMeLocs : approvedLocs.filter((l) => l.id === p.locationId);
    if (!targets.length) {
      warnings.push(`Prompt "${text.slice(0, 60)}" has no approved location and was skipped.`);
      continue;
    }
    for (const loc of targets) {
      for (const pr of providers) {
        const adapter = getAdapter(pr.providerId);
        const mode: LocationMode = p.nearMe
          ? adapter.capabilities.locationControl === "none"
            ? "near_me_ambiguous"
            : "near_me_provider_location"
          : "explicit_in_text";
        if (mode === "near_me_ambiguous") warnings.push(`"${text.slice(0, 50)}" on ${adapter.displayName} is location-ambiguous (no documented location control).`);
        if (pr === providers[0]) matrixPrompts.push({ id: p.id, version: p.currentVersion, text, group: p.group, location: locationLabel(loc), locationMode: mode });
        for (let rep = 1; rep <= repetitions; rep += 1) {
          slots.push({
            key: `${p.id}@v${p.currentVersion}:${loc.id}:${pr.providerId}:${pr.model}:${rep}`,
            promptId: p.id,
            promptVersion: p.currentVersion,
            promptGroup: p.group,
            branded: p.group === "branded",
            submittedText: text,
            language: p.language,
            serviceId: p.serviceId,
            locationId: loc.id,
            locationMode: mode,
            providerId: pr.providerId,
            model: pr.model,
            repetition: rep,
          });
        }
      }
    }
  }

  const per = new Map(providers.map((p) => [p.providerId, p]));
  const estimated = round6(slots.reduce((s, sl) => s + (per.get(sl.providerId)?.perObservationUsd ?? 0), 0));
  const upper = round6(slots.reduce((s, sl) => s + (per.get(sl.providerId)?.upperBoundUsd ?? 0), 0));
  const agency = await getAgencySettings(tenantId);
  const clientSpent = await monthSpend(tenantId, { projectId: profile.projectId });
  const agencySpent = await monthSpend(tenantId, "agency");
  const budget = {
    perScanCapUsd: profile.perScanBudgetUsd,
    clientMonthRemainingUsd: round6(Math.max(0, profile.monthlyBudgetUsd - clientSpent.calculatedUsd - clientSpent.reservedUsd)),
    agencyMonthRemainingUsd: round6(Math.max(0, agency.monthlyAgencyCapUsd - agencySpent.calculatedUsd - agencySpent.reservedUsd)),
  };
  if (slots.length && estimated > budget.perScanCapUsd) blockers.push(`Estimated cost ${estimated.toFixed(2)} USD exceeds the per-scan cap of ${budget.perScanCapUsd.toFixed(2)} USD.`);
  if (slots.length && estimated > budget.clientMonthRemainingUsd) blockers.push(`Estimated cost exceeds this client's remaining monthly budget (${budget.clientMonthRemainingUsd.toFixed(2)} USD).`);
  if (slots.length && estimated > budget.agencyMonthRemainingUsd) blockers.push(`Estimated cost exceeds the agency's remaining monthly cap (${budget.agencyMonthRemainingUsd.toFixed(2)} USD).`);
  if (slots.length && upper > budget.perScanCapUsd) warnings.push(`Worst case (${upper.toFixed(2)} USD) is above the per-scan cap; the scan will stop safely if the cap is reached.`);

  const statusFor = (pid: ProviderId) => statuses.find((s) => s.providerId === pid)!;
  const settingsSummary = providers.map((p) => {
    const s = statusFor(p.providerId).settings;
    return { p: p.providerId, m: p.model, su: s.maxSearchUses, mo: s.maxOutputTokens };
  });
  const fingerprint = stableHash(
    canonicalJson({ prompts: selected.map((p) => `${p.id}@${p.currentVersion}`).sort(), providers: settingsSummary, reps: repetitions, nearMe: nearMeLocs.map((l) => l.id).sort() }),
    16,
  );
  return {
    slots,
    matrix: { prompts: matrixPrompts, providers, repetitions, locations: [...new Set(matrixPrompts.map((m) => m.location))] },
    estimatedCostUsd: estimated,
    upperBoundUsd: upper,
    budget,
    blockers,
    warnings: [...new Set(warnings)],
    fingerprint,
    configSummary: Object.fromEntries(settingsSummary.map((s) => [s.p, `${s.m} · max_uses ${s.su} · max_tokens ${s.mo}`])),
  };
}

export function jobIdFor(scanId: string, slotKey: string): string {
  return `job_${stableHash(`${scanId}|${slotKey}`, 28)}`;
}

export async function startScan(
  profile: AivProfileV1,
  input: PlanInput,
  opts: { actor: string; trigger: "manual" | "scheduled"; scanId?: string; scheduleKey?: string },
): Promise<{ scan: AivScanV1; plan: ScanPlan; created: boolean }> {
  const plan = await planScan(profile, input);
  if (plan.blockers.length) throw new Error(`Scan not started: ${plan.blockers.join(" ")}`);
  const now = nowIso();
  const scanId = opts.scanId ?? newId("scan");
  const scan = AivScanV1.parse({
    schemaVersion: 1,
    id: scanId,
    tenantId: profile.tenantId,
    projectId: profile.projectId,
    clientId: profile.clientId,
    trigger: opts.trigger,
    scheduleKey: opts.scheduleKey,
    status: "queued",
    channel: "official_api",
    plannedCount: plan.slots.length,
    counts: { succeeded: 0, failed: 0, cancelled: 0, pending: plan.slots.length },
    estimatedCostUsd: plan.estimatedCostUsd,
    actualCostUsd: 0,
    budgetCapUsd: profile.perScanBudgetUsd,
    configFingerprint: plan.fingerprint,
    configSummary: plan.configSummary,
    promptIds: [...new Set(plan.slots.map((s) => s.promptId))],
    providerModels: plan.matrix.providers.map((p) => `${p.providerId}:${p.model}`),
    locationIds: [...new Set(plan.slots.map((s) => s.locationId ?? ""))].filter(Boolean),
    repetitions: plan.matrix.repetitions,
    createdBy: opts.actor,
    createdAt: now,
    updatedAt: now,
  });
  // Deterministic scan ids (scheduled) make creation idempotent.
  const created = await scans().createIfAbsent(profile.tenantId, scanId, scan);
  if (!created) return { scan: (await scans().get(profile.tenantId, scanId))!, plan, created: false };
  for (const slot of plan.slots) {
    const id = jobIdFor(scanId, slot.key);
    await jobs().createIfAbsent(
      profile.tenantId,
      id,
      AivJobV1.parse({
        schemaVersion: 1,
        id,
        tenantId: profile.tenantId,
        projectId: profile.projectId,
        scanId,
        slot,
        status: "queued",
        attempts: 0,
        maxAttempts: 4,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }
  await audit(profile.tenantId, opts.actor, "scan.start", {
    projectId: profile.projectId,
    target: scanId,
    detail: { trigger: opts.trigger, planned: plan.slots.length, estimatedUsd: plan.estimatedCostUsd, cap: profile.perScanBudgetUsd },
  });
  return { scan, plan, created: true };
}

export async function listScans(tenantId: string, projectId: string): Promise<AivScanV1[]> {
  return (await scans().listWhere(tenantId, "projectId", projectId)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function listJobs(tenantId: string, scanId: string): Promise<AivJobV1[]> {
  return (await jobs().listWhere(tenantId, "scanId", scanId)).sort((a, b) => a.slot.key.localeCompare(b.slot.key));
}

/** Recompute counts/status from job docs (source of truth). */
export async function refreshScan(tenantId: string, scanId: string, patch: Partial<AivScanV1> = {}): Promise<AivScanV1 | null> {
  const js = await listJobs(tenantId, scanId);
  return scans().transact(tenantId, scanId, (cur) => {
    if (!cur) return { next: null, result: null };
    const counts = {
      succeeded: js.filter((j) => j.status === "succeeded").length,
      failed: js.filter((j) => j.status === "failed").length,
      cancelled: js.filter((j) => j.status === "cancelled").length,
      pending: js.filter((j) => j.status === "queued" || j.status === "leased").length,
    };
    let status = patch.status ?? cur.status;
    const sticky = status === "cancelled" || status === "budget_stopped";
    if (counts.pending === 0 && !sticky) {
      status = counts.failed === 0 && counts.cancelled === 0 ? "completed" : counts.succeeded > 0 ? "partial" : "failed";
    } else if (counts.pending > 0 && !sticky && (status === "queued" || TERMINAL_SCAN_STATUSES.includes(status))) {
      status = js.some((j) => j.attempts > 0) ? "running" : "queued";
    }
    const finished = counts.pending === 0 || sticky;
    const next: AivScanV1 = {
      ...cur,
      ...patch,
      counts,
      status,
      startedAt: cur.startedAt ?? (js.some((j) => j.attempts > 0) ? nowIso() : undefined),
      finishedAt: finished ? (cur.finishedAt ?? nowIso()) : undefined,
      updatedAt: nowIso(),
    };
    return { next, result: next };
  });
}

export async function cancelScan(tenantId: string, scanId: string, actor: string, reason = "Cancelled by user", status: "cancelled" | "budget_stopped" = "cancelled") {
  const scan = await scans().get(tenantId, scanId);
  if (!scan) throw new Error("Scan not found");
  if (TERMINAL_SCAN_STATUSES.includes(scan.status) && status === "cancelled") return scan;
  for (const j of await listJobs(tenantId, scanId)) {
    if (j.status !== "queued") continue;
    await jobs().transact(tenantId, j.id, (cur) =>
      cur && cur.status === "queued"
        ? { next: { ...cur, status: "cancelled", lastErrorClass: status === "budget_stopped" ? "budget_blocked" : "cancelled", lastError: reason, updatedAt: nowIso() }, result: null }
        : { next: null, result: null },
    );
  }
  const next = await refreshScan(tenantId, scanId, { status, stopReason: reason });
  await audit(tenantId, actor, status === "cancelled" ? "scan.cancel" : "scan.budget_stop", { projectId: scan.projectId, target: scanId, detail: { reason } });
  return next;
}

/**
 * Re-queue failed jobs of a scan IN PLACE. The job id (and so the observation
 * id) is unchanged, so a retry can replace a failure record but can never add
 * a second measurement for the same slot. Previous attempts and their costs
 * are kept.
 */
export async function retryFailed(tenantId: string, scanId: string, actor: string) {
  const scan = await scans().get(tenantId, scanId);
  if (!scan) throw new Error("Scan not found");
  let requeued = 0;
  for (const j of await listJobs(tenantId, scanId)) {
    if (j.status !== "failed" && !(j.status === "cancelled" && j.lastErrorClass === "budget_blocked")) continue;
    await jobs().transact(tenantId, j.id, (cur) => {
      if (!cur || (cur.status !== "failed" && cur.status !== "cancelled")) return { next: null, result: null };
      requeued += 1;
      return { next: { ...cur, status: "queued", maxAttempts: cur.attempts + 3, nextAttemptAt: nowIso(), updatedAt: nowIso() }, result: null };
    });
  }
  const next = await refreshScan(tenantId, scanId, { status: "running", stopReason: undefined, finishedAt: undefined });
  await audit(tenantId, actor, "scan.retry_failed", { projectId: scan.projectId, target: scanId, detail: { requeued } });
  return { scan: next, requeued };
}
