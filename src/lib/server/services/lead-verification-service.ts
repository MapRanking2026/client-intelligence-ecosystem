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
  VerifiedLead,
} from "@/src/lib/mtos-data";
import { LEAD_CHANNEL_LABEL } from "@/src/lib/mtos-data";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { integrationSnapshotPath, leadVerificationPath } from "@/src/lib/server/firebase/collections";
import { getServerEnv } from "@/src/lib/server/env";
import { syncIntegrationProvider } from "@/src/lib/server/integration-sync";
import { callLlmForJson, getNowIso, hasAnyLlmProvider, stripUndefinedDeep } from "@/src/lib/server/services/mtos-ai";
import { getPromptText } from "@/src/lib/server/prompt-store";

type JsonRecord = Record<string, unknown>;

const STATUSES: LeadStatus[] = ["valid", "flagged", "needs_review"];
const CATEGORIES: LeadCategory[] = [
  "valid_new_lead",
  "spam",
  "duplicate",
  "existing_customer",
  "wrong_number",
  "sales_solicitation",
  "out_of_area",
  "incomplete",
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

/** Cap how many leads are sent to Claude in one run, to bound token cost. */
const AI_BATCH_CAP = 80;

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
  const missed = /missed|no-?answer|no_answer|voicemail|busy|failed|cancel/.test(status);
  // A very short connected call is almost always a misdial or hangup.
  if (duration > 0 && duration < 10) {
    return { status: "flagged", category: "wrong_number" };
  }
  if (duration >= 60) {
    return { status: "valid", category: "valid_new_lead" };
  }
  // Missed / short / unknown -> let a human (or the AI) decide.
  return { status: "needs_review", category: missed ? "wrong_number" : "valid_new_lead" };
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

  const userText = [
    "Classify each of the following leads. Return one verdict per lead, preserving its id.",
    "",
    JSON.stringify({ leads }, null, 2),
  ].join("\n");

  try {
    const result = await callLlmForJson({ env, system, userText, maxTokens: 4096 });
    const parsed = verdictsResponseSchema.parse(result.data);
    const map = new Map<string, AiVerdict>();
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
    return { verdicts: map, provider: result.provider, model: result.model };
  } catch (error) {
    return { verdicts: new Map(), error: error instanceof Error ? error.message : "Lead classification failed" };
  }
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
  options: { forceRefresh?: boolean } = {},
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

  // A forced refresh re-pulls GoHighLevel before reading. Best-effort: a scope or
  // permission failure must not block verification against the existing snapshot.
  if (options.forceRefresh) {
    try {
      await syncIntegrationProvider(context, "gohighlevel");
    } catch (error) {
      console.warn(
        `Lead verification refresh: GoHighLevel sync failed, using existing snapshot: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  const [crmPayload, googleAdsPayload, gbpPayload] = await Promise.all([
    loadSnapshotPayload(db, context.tenantId, "gohighlevel"),
    loadSnapshotPayload(db, context.tenantId, "google-ads"),
    loadSnapshotPayload(db, context.tenantId, "google-business-profile"),
  ]);

  const leadsByClient = (crmPayload?.leadsByClient || {}) as JsonRecord;
  const clientCrm = (leadsByClient[clientId] || null) as JsonRecord | null;
  const rawLeads = Array.isArray(clientCrm?.leads) ? (clientCrm?.leads as JsonRecord[]) : [];
  const locationId = str(clientCrm?.locationId);

  const warnings: string[] = [];
  if (!clientCrm) {
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
  }

  const platformCounts: Partial<Record<LeadChannel, { count: number | null; label: string }>> = {
    google_ads: { count: googleAdsConversions(googleAdsPayload, clientId), label: "Google Ads conversions" },
    gbp_call: { count: sumGbpCalls(gbpPayload, clientId), label: "GBP calls" },
    meta_ads: { count: null, label: "Meta Ads (not connected)" },
  };

  const windowStart = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const review = assembleReview(clientId, baseLeads, platformCounts, {
    source,
    warnings,
    window: { since: windowStart, until: getNowIso() },
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
    totals: { total: 0, valid: 0, flagged: 0, needsReview: 0 },
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
    totals: { total: 0, valid: 0, flagged: 0, needsReview: 0 },
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
