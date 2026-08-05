import { nanoid } from "nanoid";
import { z } from "zod";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { IntegrationSnapshotRecord } from "@/src/lib/contracts/integration-sync";
import type {
  LeadCategory,
  LeadChannel,
  LeadChannelCount,
  LeadReconciliation,
  LeadStatus,
  LeadType,
  LeadVerificationReview,
  LeadWindowInput,
  VerifiedLead,
} from "@/src/lib/mtos-data";
import { LEAD_CHANNEL_LABEL } from "@/src/lib/mtos-data";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { integrationSnapshotPath, leadVerificationPath } from "@/src/lib/server/firebase/collections";
import { getServerEnv } from "@/src/lib/server/env";
import { fetchGhlClientLeadsAndCalls } from "@/src/lib/server/integration-sync";
import { callLlmForJson, getNowIso, hasAnyLlmProvider, stripUndefinedDeep } from "@/src/lib/server/services/mtos-ai";
import { getPromptText } from "@/src/lib/server/prompt-store";

type JsonRecord = Record<string, unknown>;

const STATUSES: LeadStatus[] = ["valid", "flagged", "needs_review", "missed_call"];
const CATEGORIES: LeadCategory[] = [
  "valid_new_lead",
  "spam",
  "duplicate",
  "existing_customer",
  "wrong_number",
  "sales_solicitation",
  "out_of_area",
  "incomplete",
  "irrelevant",
];
const CHANNELS: LeadChannel[] = [
  "google_ads",
  "organic_website",
  "meta_ads",
  "gbp_call",
  "direct",
  "referral",
  "unknown",
];
const TYPES: LeadType[] = ["call", "form", "chat", "manual"];

/** Reconcile only against channels whose platform reports its own number. */
const RECONCILED_CHANNELS: LeadChannel[] = ["google_ads", "gbp_call", "meta_ads"];

/**
 * Cap how many leads are AI-vetted in one run, to bound token cost + runtime.
 * `classifyWithClaude` splits this into small batched requests, so the cap can
 * comfortably cover a busy client's full month. Override with LEAD_VET_CAP.
 */
const AI_BATCH_CAP = Number(process.env.LEAD_VET_CAP) || 400;

// ---------------------------------------------------------------------------
// Firestore helpers
// ---------------------------------------------------------------------------

type Db = NonNullable<ReturnType<typeof getFirebaseAdminDb>>;

async function loadSnapshotPayload(db: Db, tenantId: string, providerId: string): Promise<JsonRecord | null> {
  const doc = await db.doc(integrationSnapshotPath(tenantId, providerId)).get();
  if (!doc.exists) {
    return null;
  }
  const data = doc.data() as IntegrationSnapshotRecord;
  return (data.payload || {}) as JsonRecord;
}

async function persistReview(db: Db, tenantId: string, review: LeadVerificationReview): Promise<void> {
  await db.doc(leadVerificationPath(tenantId, review.clientId)).set(stripUndefinedDeep(review), { merge: false });
}

export async function getStoredLeadVerification(
  context: TenantContext,
  clientId: string,
): Promise<LeadVerificationReview | null> {
  const db = getFirebaseAdminDb();
  if (!db) {
    return null;
  }
  const doc = await db.doc(leadVerificationPath(context.tenantId, clientId)).get();
  return doc.exists ? (doc.data() as LeadVerificationReview) : null;
}

// ---------------------------------------------------------------------------
// Normalization + heuristics (deterministic fallback when Claude is unavailable)
// ---------------------------------------------------------------------------

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const candidate = str(value).toLowerCase() as T;
  return allowed.includes(candidate) ? candidate : fallback;
}

/** All the source/attribution text of a lead, lowercased, for heuristic matching. */
function leadSignal(lead: JsonRecord): string {
  const attribution = (lead.attribution || {}) as JsonRecord;
  return [
    lead.source,
    attribution.source,
    attribution.medium,
    attribution.campaign,
    attribution.referrer,
    ...(Array.isArray(lead.tags) ? (lead.tags as unknown[]) : []),
  ]
    .map((part) => str(part))
    .join(" ")
    .toLowerCase();
}

function resolveChannelHeuristic(lead: JsonRecord): LeadChannel {
  const signal = leadSignal(lead);
  const medium = str((lead.attribution as JsonRecord | undefined)?.medium).toLowerCase();
  if (/fb|facebook|instagram|\big\b|meta|fbclid/.test(signal)) {
    return "meta_ads";
  }
  if (/gclid|adwords/.test(signal) || (/google/.test(signal) && /(cpc|ppc|paid|ads)/.test(`${signal} ${medium}`))) {
    return "google_ads";
  }
  if (/google business|gbp|gmb|maps/.test(signal)) {
    return "gbp_call";
  }
  if (/organic|seo|website|web form|form|landing/.test(signal)) {
    return "organic_website";
  }
  if (/referr/.test(signal)) {
    return "referral";
  }
  if (/direct|walk|manual/.test(signal)) {
    return "direct";
  }
  return "unknown";
}

function resolveTypeHeuristic(lead: JsonRecord): LeadType {
  const signal = leadSignal(lead);
  if (/call|phone|inbound|dial/.test(signal)) {
    return "call";
  }
  if (/chat|sms|message|widget|whatsapp/.test(signal)) {
    return "chat";
  }
  return "form";
}

/** Deterministic first-pass verdict. Conservative: unknowns default to needs_review. */
function classifyHeuristic(lead: JsonRecord, seen: Set<string>): { status: LeadStatus; category: LeadCategory } {
  const phone = str(lead.phone);
  const email = str(lead.email).toLowerCase();
  if (!phone && !email) {
    return { status: "flagged", category: "incomplete" };
  }
  const key = phone || email;
  if (key && seen.has(key)) {
    return { status: "flagged", category: "duplicate" };
  }
  return { status: "needs_review", category: "valid_new_lead" };
}

function contactUrl(locationId: string, leadId: string): string | undefined {
  if (!locationId || !leadId) {
    return undefined;
  }
  return `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/${leadId}`;
}

/** First-pass verdict for a phone call from its metadata (duration + status). */
function classifyCallHeuristic(call: JsonRecord): { status: LeadStatus; category: LeadCategory } {
  const status = str(call.status).toLowerCase();
  const duration = Number(call.durationSec) || 0;
  const missed = /missed|no-?answer|no_answer|voicemail|busy|failed|cancel|unanswered|declin/.test(status);
  // Not answered / went to voicemail -> its own status so missed calls can be
  // counted. Keep it a valid_new_lead category (a missed call is still a real
  // potential customer the client didn't reach), not spam.
  if (missed) {
    return { status: "missed_call", category: "valid_new_lead" };
  }
  // A very short connected call is almost always a misdial or hangup.
  if (duration > 0 && duration < 10) {
    return { status: "flagged", category: "wrong_number" };
  }
  if (duration >= 60) {
    return { status: "valid", category: "valid_new_lead" };
  }
  // Short / unknown -> let a human (or the AI) decide.
  return { status: "needs_review", category: "valid_new_lead" };
}

/**
 * Resolve a pull window (since/until ISO) from the operator's choice. Defaults
 * to a rolling last-30-days from "now" when nothing is specified — so both the
 * button and every automatic re-run pull the last 30 days unless overridden.
 */
function resolveLeadWindow(input?: LeadWindowInput): { since: string; until?: string } {
  const now = new Date();
  const nowMs = now.getTime();
  const daysAgo = (n: number) => new Date(nowMs - n * 86_400_000).toISOString();
  const monthStart = (year: number, monthIndex: number) => new Date(Date.UTC(year, monthIndex, 1)).toISOString();

  switch (input?.preset) {
    case "last_7_days":
      return { since: daysAgo(7) };
    case "last_90_days":
      return { since: daysAgo(90) };
    case "this_month":
      return { since: monthStart(now.getUTCFullYear(), now.getUTCMonth()) };
    case "last_month": {
      const since = monthStart(now.getUTCFullYear(), now.getUTCMonth() - 1);
      // End = the last millisecond of the previous month.
      const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1).toISOString();
      return { since, until };
    }
    case "custom": {
      const since = input.since
        ? new Date(`${input.since}T00:00:00.000Z`).toISOString()
        : daysAgo(30);
      const until = input.until ? new Date(`${input.until}T23:59:59.999Z`).toISOString() : undefined;
      return { since, until };
    }
    case "last_30_days":
    default:
      return { since: daysAgo(30) };
  }
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function computeTotals(leads: VerifiedLead[]): LeadVerificationReview["totals"] {
  return {
    total: leads.length,
    valid: leads.filter((lead) => lead.status === "valid").length,
    flagged: leads.filter((lead) => lead.status === "flagged").length,
    needsReview: leads.filter((lead) => lead.status === "needs_review").length,
    missedCalls: leads.filter((lead) => lead.status === "missed_call").length,
  };
}

function computeByChannel(leads: VerifiedLead[]): LeadChannelCount[] {
  return CHANNELS.map((channel) => {
    const inChannel = leads.filter((lead) => lead.channel === channel);
    return {
      channel,
      total: inChannel.length,
      valid: inChannel.filter((lead) => lead.status === "valid").length,
      flagged: inChannel.filter((lead) => lead.status === "flagged").length,
    };
  }).filter((row) => row.total > 0);
}

function buildReconciliation(
  leads: VerifiedLead[],
  platformCounts: Partial<Record<LeadChannel, { count: number | null; label: string }>>,
): { rows: LeadReconciliation[]; warnings: string[] } {
  const rows: LeadReconciliation[] = [];
  const warnings: string[] = [];

  for (const channel of RECONCILED_CHANNELS) {
    const ghlCount = leads.filter((lead) => lead.channel === channel).length;
    const platform = platformCounts[channel];
    const platformCount = platform?.count ?? null;
    if (ghlCount === 0 && platformCount === null) {
      continue;
    }
    const delta = platformCount === null ? null : ghlCount - platformCount;
    let note: string | undefined;
    if (platformCount === null) {
      note =
        channel === "meta_ads"
          ? "Meta Ads is not connected directly — this count comes only from what GoHighLevel captured."
          : "No platform-reported number to compare against.";
    } else if (delta !== null && Math.abs(delta) >= Math.max(3, Math.round(platformCount * 0.25))) {
      note = "Counts diverge — worth checking attribution or tracking before presenting.";
      warnings.push(
        `${LEAD_CHANNEL_LABEL[channel]}: GoHighLevel shows ${ghlCount} lead(s) vs. ${platform?.label} of ${platformCount}.`,
      );
    }
    rows.push({
      channel,
      ghlCount,
      platformCount,
      platformLabel: platform?.label || LEAD_CHANNEL_LABEL[channel],
      delta,
      note,
    });
  }

  return { rows, warnings };
}

function assembleReview(
  clientId: string,
  leads: VerifiedLead[],
  platformCounts: Partial<Record<LeadChannel, { count: number | null; label: string }>>,
  extras: {
    source: LeadVerificationReview["source"];
    warnings?: string[];
    window?: LeadVerificationReview["window"];
    model?: string;
    provider?: string;
  },
): LeadVerificationReview {
  const { rows, warnings: reconciliationWarnings } = buildReconciliation(leads, platformCounts);
  return {
    status: "ready",
    clientId,
    leads,
    totals: computeTotals(leads),
    byChannel: computeByChannel(leads),
    reconciliation: rows,
    warnings: [...(extras.warnings || []), ...reconciliationWarnings],
    window: extras.window,
    source: extras.source,
    generatedAt: getNowIso(),
    model: extras.model,
    provider: extras.provider,
  };
}

// ---------------------------------------------------------------------------
// Claude classification
// ---------------------------------------------------------------------------

const verdictSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  category: z.string().optional(),
  channel: z.string().optional(),
  type: z.string().optional(),
  confidence: z.number().optional(),
  reason: z.string().optional(),
});
const verdictsResponseSchema = z.object({ verdicts: z.array(verdictSchema) });

type AiVerdict = {
  status: LeadStatus;
  category: LeadCategory;
  channel: LeadChannel;
  type: LeadType;
  confidence?: number;
  reason?: string;
};

/**
 * Ask Claude to classify a batch of leads. Returns a map keyed by lead id, or
 * null when Claude is not configured / the prompt is missing / the call fails —
 * the caller then falls back to the deterministic heuristic. Never throws.
 */
async function classifyWithClaude(
  env: ReturnType<typeof getServerEnv>,
  leads: JsonRecord[],
): Promise<{ verdicts: Map<string, AiVerdict>; provider?: string; model?: string; error?: string } | null> {
  if (!hasAnyLlmProvider(env)) {
    return null;
  }

  let system: string;
  try {
    system = await getPromptText("lead_verification_prompt");
  } catch (error) {
    return { verdicts: new Map(), error: error instanceof Error ? error.message : "Prompt not available" };
  }

  // Classify in small batches so a busy client's full month of leads never
  // overflows the model's output cap — a single all-leads request was returning
  // truncated JSON (parse error mid-array) and taking down the whole AI pass.
  // Each batch fails independently: a failed batch just falls back to the
  // deterministic heuristic for those leads (they're absent from the map).
  const BATCH_SIZE = 25;
  const batches: JsonRecord[][] = [];
  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    batches.push(leads.slice(i, i + BATCH_SIZE));
  }

  const map = new Map<string, AiVerdict>();
  let provider: string | undefined;
  let model: string | undefined;
  const errors: string[] = [];

  const runBatch = async (batch: JsonRecord[]) => {
    const userText = [
      "Classify each of the following leads. Return one verdict per lead, preserving its id.",
      "",
      JSON.stringify({ leads: batch }, null, 2),
    ].join("\n");
    try {
      const result = await callLlmForJson({ env, system, userText, maxTokens: 4096 });
      const parsed = verdictsResponseSchema.parse(result.data);
      provider = provider ?? result.provider;
      model = model ?? result.model;
      for (const verdict of parsed.verdicts) {
        map.set(verdict.id, {
          status: pickEnum(verdict.status, STATUSES, "needs_review"),
          category: pickEnum(verdict.category, CATEGORIES, "valid_new_lead"),
          channel: pickEnum(verdict.channel, CHANNELS, "unknown"),
          type: pickEnum(verdict.type, TYPES, "form"),
          confidence:
            typeof verdict.confidence === "number"
              ? Math.max(0, Math.min(100, Math.round(verdict.confidence)))
              : undefined,
          reason: str(verdict.reason) || undefined,
        });
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "batch failed");
    }
  };

  // Limited concurrency keeps us well under the function timeout without
  // hammering the provider's rate limit.
  const CONCURRENCY = 3;
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    await Promise.all(batches.slice(i, i + CONCURRENCY).map(runBatch));
  }

  // Only surface an error when nothing at all classified — a partial result is
  // still useful (the rest fall back to the heuristic).
  if (map.size === 0 && errors.length) {
    return { verdicts: map, error: errors[0] };
  }
  return { verdicts: map, provider, model };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run lead & call verification for a client: read the individual leads GHL
 * aggregated from every source, vet each one (Claude, with a deterministic
 * fallback), reconcile against Google Ads / GBP, and persist the review. Safe to
 * run standalone (client card) or inside monthly-touch prep. Returns a review
 * with status "error" only for hard failures the caller should surface.
 */
export async function runLeadVerification(
  context: TenantContext,
  clientId: string,
  options: { forceRefresh?: boolean; window?: LeadWindowInput } = {},
): Promise<LeadVerificationReview> {
  const env = getServerEnv();
  const db = getFirebaseAdminDb();

  const dataSource = getMtosDataSource(context);
  const client = await dataSource.getClientById(clientId);
  if (!client) {
    return errorReview(clientId, "Client not found.");
  }

  if (!db) {
    // Seed / no-Firestore mode: there are no integration snapshots to read.
    return {
      ...errorReview(clientId, "Lead verification needs the Firestore-backed data source and a connected GoHighLevel account."),
      status: "ready",
    };
  }

  // NOTE: we deliberately do NOT trigger a full GoHighLevel agency sync here (it
  // iterates every client and was timing the request out). Verification always
  // pulls THIS client's leads/calls directly and live below via
  // fetchGhlClientLeadsAndCalls, so a refresh is inherently fresh.
  void options.forceRefresh;

  const [crmPayload, googleAdsPayload, gbpPayload] = await Promise.all([
    loadSnapshotPayload(db, context.tenantId, "gohighlevel"),
    loadSnapshotPayload(db, context.tenantId, "google-ads"),
    loadSnapshotPayload(db, context.tenantId, "google-business-profile"),
  ]);

  const leadsByClient = (crmPayload?.leadsByClient || {}) as JsonRecord;
  const clientCrm = (leadsByClient[clientId] || null) as JsonRecord | null;
  const locationId = str(clientCrm?.locationId);
  const { since: windowStart, until: windowEnd } = resolveLeadWindow(options.window);
  const windowEndMs = windowEnd ? new Date(windowEnd).getTime() : null;

  const warnings: string[] = [];

  // Keep only records inside the window's END (the pull is bounded by `since`;
  // `until` matters for "Last month" / a custom range). Records without a
  // parseable date are kept rather than silently dropped.
  const withinWindowEnd = (records: JsonRecord[]) => {
    if (windowEndMs === null) {
      return records;
    }
    return records.filter((raw) => {
      const call = (raw.call || null) as JsonRecord | null;
      const dateStr = str(raw.dateAdded) || str(call?.dateAdded);
      const ms = new Date(dateStr).getTime();
      return Number.isNaN(ms) ? true : ms <= windowEndMs;
    });
  };

  // Pull the FULL window directly from GoHighLevel for this one client (paginated),
  // so a busy client's older leads/calls aren't truncated by the shared-snapshot
  // cap. Falls back to whatever the snapshot holds if the direct pull can't run.
  let rawLeads = withinWindowEnd(Array.isArray(clientCrm?.leads) ? (clientCrm?.leads as JsonRecord[]) : []);
  if (locationId) {
    try {
      const direct = await fetchGhlClientLeadsAndCalls(context, locationId, windowStart);
      if (direct && direct.leads.length) {
        rawLeads = withinWindowEnd(direct.leads);
        if (direct.diagnostic) {
          const sinceLabel = new Date(windowStart).toLocaleDateString("en-US", { month: "short", day: "numeric" });
          warnings.push(`GoHighLevel pull (since ${sinceLabel}): ${direct.diagnostic}`);
        }
      }
    } catch (error) {
      console.warn(
        `Lead verification direct GHL pull failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  if (!clientCrm && !rawLeads.length) {
    warnings.push(
      "GoHighLevel has no data matched to this client yet — pin the client's GHL location under Profile mappings, then sync.",
    );
  } else if (!rawLeads.length) {
    warnings.push(
      "No individual lead records available yet — the latest GoHighLevel sync returned only counts. Try Refresh, or re-sync GoHighLevel.",
    );
    const diagnostic = str(clientCrm?.leadsDiagnostic);
    if (diagnostic) {
      warnings.push(`GoHighLevel lead pull diagnostic: ${diagnostic}`);
    }
  }

  // Deterministic first pass over every lead (also seeds duplicate detection).
  const seen = new Set<string>();
  const baseLeads: VerifiedLead[] = rawLeads.map((raw) => {
    const id = str(raw.id) || `lead-${nanoid(8)}`;
    const phone = str(raw.phone);
    const attribution = (raw.attribution || {}) as JsonRecord;
    const call = (raw.call || null) as JsonRecord | null;

    // Phone calls: metadata-driven verdict + an on-demand recording link.
    if (str(raw.type) === "call" || call) {
      const callData = call || {};
      const heuristic = classifyCallHeuristic(callData);
      const messageId = str(callData.messageId);
      const durationSec = Number(callData.durationSec) || 0;
      const direction = str(callData.direction) || undefined;
      const callStatus = str(callData.status) || undefined;
      const contactId = str(callData.contactId);
      return {
        id,
        name: str(raw.name) || undefined,
        phone: phone || undefined,
        receivedAt: str(raw.dateAdded) || undefined,
        rawSource: str(raw.source) || "call",
        channel: resolveChannelHeuristic(raw),
        type: "call",
        status: heuristic.status,
        category: heuristic.category,
        callDurationSec: durationSec || undefined,
        callStatus,
        callDirection: direction,
        reason: `${direction || "inbound"} call · ${durationSec}s${callStatus ? ` · ${callStatus}` : ""}`,
        recordingUrl: messageId
          ? `/api/clients/${clientId}/recording?messageId=${encodeURIComponent(messageId)}`
          : undefined,
        contactUrl: contactId ? contactUrl(locationId, contactId) : undefined,
        verdictSource: "ai",
      };
    }

    const heuristic = classifyHeuristic(raw, seen);
    const email = str(raw.email).toLowerCase();
    const key = phone || email;
    if (key) {
      seen.add(key);
    }
    return {
      id,
      name: str(raw.name) || undefined,
      phone: phone || undefined,
      email: str(raw.email) || undefined,
      receivedAt: str(raw.dateAdded) || undefined,
      rawSource: str(raw.source) || undefined,
      channel: resolveChannelHeuristic(raw),
      type: resolveTypeHeuristic(raw),
      campaign: str(attribution.campaign) || undefined,
      status: heuristic.status,
      category: heuristic.category,
      confidence: undefined,
      contactUrl: contactUrl(locationId, id),
      verdictSource: "ai",
    };
  });

  // Whether a call was answered is a FACT from its metadata, not a judgment —
  // capture missed calls up front so the AI pass can't reclassify them away
  // (the AM can still override an individual verdict by hand afterwards).
  const missedCallIds = new Set(
    baseLeads.filter((lead) => lead.type === "call" && lead.status === "missed_call").map((lead) => lead.id),
  );

  // AI pass (bounded batch). Overrides the heuristic verdict where present.
  let source: LeadVerificationReview["source"] = "heuristic";
  let model: string | undefined;
  let provider: string | undefined;
  if (baseLeads.length) {
    const batch = rawLeads.slice(0, AI_BATCH_CAP);
    if (rawLeads.length > AI_BATCH_CAP) {
      warnings.push(`Vetted the ${AI_BATCH_CAP} most recent leads; ${rawLeads.length - AI_BATCH_CAP} older lead(s) were not AI-vetted.`);
    }
    const ai = await classifyWithClaude(env, batch);
    if (ai && ai.verdicts.size) {
      source = "claude";
      model = ai.model;
      provider = ai.provider;
      for (const lead of baseLeads) {
        const verdict = ai.verdicts.get(lead.id);
        if (verdict) {
          lead.status = verdict.status;
          lead.category = verdict.category;
          lead.channel = verdict.channel;
          // Preserve the call type/recording — the AI vets the call but doesn't reclassify it as a form.
          if (lead.type !== "call") {
            lead.type = verdict.type === "manual" ? lead.type : verdict.type;
          }
          lead.confidence = verdict.confidence;
          if (verdict.reason) {
            lead.reason = verdict.reason;
          }
        }
      }
    } else if (ai?.error) {
      warnings.push(`AI vetting unavailable (${ai.error}) — showing a rules-based first pass. Verdicts can be adjusted by hand.`);
    } else if (!ai) {
      warnings.push("No AI provider is configured — showing a rules-based first pass. Verdicts can be adjusted by hand.");
    }
    // Re-assert the factual missed-call status the AI may have overwritten.
    for (const lead of baseLeads) {
      if (missedCallIds.has(lead.id)) {
        lead.status = "missed_call";
      }
    }
  }

  const platformCounts: Partial<Record<LeadChannel, { count: number | null; label: string }>> = {
    google_ads: { count: googleAdsConversions(googleAdsPayload, clientId), label: "Google Ads conversions" },
    gbp_call: { count: sumGbpCalls(gbpPayload, clientId), label: "GBP calls" },
    meta_ads: { count: null, label: "Meta Ads (not connected)" },
  };

  const review = assembleReview(clientId, baseLeads, platformCounts, {
    source,
    warnings,
    window: { since: windowStart, until: windowEnd ?? getNowIso() },
    model,
    provider,
  });

  await persistReview(db, context.tenantId, review);
  return review;
}

/** AM override of one or more leads' verdicts. Recomputes and persists. */
export async function applyLeadVerdicts(
  context: TenantContext,
  clientId: string,
  verdicts: Record<string, { status?: LeadStatus; category?: LeadCategory }>,
): Promise<LeadVerificationReview> {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Lead verification is not available without the Firestore-backed data source.");
  }
  const existing = await getStoredLeadVerification(context, clientId);
  if (!existing) {
    throw new Error("Run verification first — there is nothing to update yet.");
  }

  const leads = existing.leads.map((lead) => {
    const override = verdicts[lead.id];
    if (!override) {
      return lead;
    }
    return {
      ...lead,
      status: override.status ? pickEnum(override.status, STATUSES, lead.status) : lead.status,
      category: override.category ? pickEnum(override.category, CATEGORIES, lead.category) : lead.category,
      verdictSource: "manual" as const,
    };
  });

  const review: LeadVerificationReview = {
    ...existing,
    leads,
    totals: computeTotals(leads),
    byChannel: computeByChannel(leads),
  };
  await persistReview(db, context.tenantId, review);
  return review;
}

export interface ManualLeadInput {
  name?: string;
  phone?: string;
  email?: string;
  receivedAt?: string;
  source?: string;
  channel?: LeadChannel;
  type?: LeadType;
  status?: LeadStatus;
  category?: LeadCategory;
  notes?: string;
}

/** Merge manually-entered / pasted leads not sourced from a connected integration. */
export async function addManualLeads(
  context: TenantContext,
  clientId: string,
  rows: ManualLeadInput[],
): Promise<LeadVerificationReview> {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Lead verification is not available without the Firestore-backed data source.");
  }
  const existing =
    (await getStoredLeadVerification(context, clientId)) || emptyReadyReview(clientId);

  const manualLeads: VerifiedLead[] = rows
    .filter((row) => str(row.name) || str(row.phone) || str(row.email))
    .map((row) => ({
      id: `manual-${nanoid(8)}`,
      name: str(row.name) || undefined,
      phone: str(row.phone) || undefined,
      email: str(row.email) || undefined,
      receivedAt: str(row.receivedAt) || getNowIso(),
      rawSource: str(row.source) || "manual entry",
      channel: pickEnum(row.channel, CHANNELS, "unknown"),
      type: "manual",
      status: pickEnum(row.status, STATUSES, "valid"),
      category: pickEnum(row.category, CATEGORIES, "valid_new_lead"),
      notes: str(row.notes) || undefined,
      manual: true,
      verdictSource: "manual",
    }));

  const leads = [...manualLeads, ...existing.leads];
  const review: LeadVerificationReview = {
    ...existing,
    leads,
    totals: computeTotals(leads),
    byChannel: computeByChannel(leads),
  };
  await persistReview(db, context.tenantId, review);
  return review;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function errorReview(clientId: string, message: string): LeadVerificationReview {
  return {
    status: "error",
    clientId,
    leads: [],
    totals: { total: 0, valid: 0, flagged: 0, needsReview: 0, missedCalls: 0 },
    byChannel: [],
    reconciliation: [],
    warnings: [message],
    errorMessage: message,
    generatedAt: getNowIso(),
  };
}

function emptyReadyReview(clientId: string): LeadVerificationReview {
  return {
    status: "ready",
    clientId,
    leads: [],
    totals: { total: 0, valid: 0, flagged: 0, needsReview: 0, missedCalls: 0 },
    byChannel: [],
    reconciliation: [],
    warnings: [],
    source: "heuristic",
    generatedAt: getNowIso(),
  };
}

function googleAdsConversions(payload: JsonRecord | null, clientId: string): number | null {
  const adsByClient = (payload?.adsByClient || {}) as JsonRecord;
  const ads = (adsByClient[clientId] || null) as JsonRecord | null;
  if (!ads) {
    return null;
  }
  const conversions = Number(ads.conversions);
  return Number.isFinite(conversions) ? Math.round(conversions) : null;
}

function sumGbpCalls(payload: JsonRecord | null, clientId: string): number | null {
  if (!payload) {
    return null;
  }
  const locationsByClient = (payload.locationsByClient || {}) as JsonRecord;
  const matched = Array.isArray(locationsByClient[clientId]) ? (locationsByClient[clientId] as JsonRecord[]) : [];
  const ids = new Set(matched.map((location) => str(location.name).split("/").filter(Boolean).pop()));
  const rows = Array.isArray(payload.performance) ? (payload.performance as JsonRecord[]) : [];
  const matchedRows = rows.filter((row) => !row.error && ids.has(str(row.locationId)));
  if (!matchedRows.length) {
    return null;
  }
  return matchedRows.reduce((sum, row) => sum + (Number(row.calls) || 0), 0);
}
