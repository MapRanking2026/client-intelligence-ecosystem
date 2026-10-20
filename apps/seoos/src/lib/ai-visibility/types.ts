import { z } from "zod";

/**
 * AI Visibility Tracker — domain contracts.
 *
 * Pure schemas (no server imports) so they are shared by services, API routes,
 * UI and tests. Every record is tenant-scoped and keyed to a SEOOS project
 * (`projectId`, which carries the canonical CIE `clientId`). The tracker never
 * holds its own copy of client identity — only measurement configuration.
 */

const Iso = z.string().min(1);

/* ------------------------------------------------------------------------ */
/* Measurement channels & providers                                          */
/* ------------------------------------------------------------------------ */

/**
 * A = official provider API, B = consumer search surface via a supported
 * integration, C = manual upload. Channels are never mixed in a metric.
 */
export const MeasurementChannel = z.enum(["official_api", "consumer_search", "manual"]);
export type MeasurementChannel = z.infer<typeof MeasurementChannel>;

export const CHANNEL_LABEL: Record<MeasurementChannel, string> = {
  official_api: "Official API",
  consumer_search: "Consumer search surface",
  manual: "Manual observation",
};

export const ProviderId = z.enum(["anthropic", "openai", "gemini", "perplexity", "fixture"]);
export type ProviderId = z.infer<typeof ProviderId>;

/* ------------------------------------------------------------------------ */
/* Client profile (onboarding)                                               */
/* ------------------------------------------------------------------------ */

/** Where a value came from. Only `user` / `cie` values may be `approved`. */
export const FactSource = z.enum(["user", "cie", "website_extraction"]);
export type FactSource = z.infer<typeof FactSource>;

export const ReviewStatus = z.enum(["approved", "suggested", "rejected"]);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

export const ReviewedValue = z.object({
  id: z.string().min(1),
  value: z.string().min(1).max(200),
  status: ReviewStatus.default("approved"),
  source: FactSource.default("user"),
  /** For extracted suggestions: the public page it came from + the matched text. */
  sourceUrl: z.string().optional(),
  evidence: z.string().max(400).optional(),
});
export type ReviewedValue = z.infer<typeof ReviewedValue>;

export const AivLocation = z.object({
  id: z.string().min(1),
  city: z.string().min(1).max(120),
  /** State/region code or name, e.g. "TN". */
  region: z.string().max(80).default(""),
  /** ISO 3166-1 alpha-2. */
  country: z.string().length(2).default("US"),
  zipCodes: z.array(z.string().max(12)).default([]),
  neighborhoods: z.array(z.string().max(120)).default([]),
  status: ReviewStatus.default("approved"),
  source: FactSource.default("user"),
  sourceUrl: z.string().optional(),
  evidence: z.string().max(400).optional(),
});
export type AivLocation = z.infer<typeof AivLocation>;

export const AivCompetitor = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  aliases: z.array(z.string().max(200)).default([]),
  domains: z.array(z.string().max(200)).default([]),
  status: ReviewStatus.default("approved"),
  source: z.enum(["user", "discovered_in_answers"]).default("user"),
});
export type AivCompetitor = z.infer<typeof AivCompetitor>;

export const ScanFrequency = z.enum(["manual", "weekly", "monthly"]);
export type ScanFrequency = z.infer<typeof ScanFrequency>;

export const ProfileStatus = z.enum(["draft", "active", "paused"]);
export type ProfileStatus = z.infer<typeof ProfileStatus>;

export const AivProfileV1 = z.object({
  schemaVersion: z.literal(1),
  tenantId: z.string().min(1),
  /** Doc id. The SEOOS project this profile measures. */
  projectId: z.string().min(1),
  clientId: z.string().min(1),
  status: ProfileStatus.default("draft"),
  /** Verified business name (approved by a user). */
  businessName: z.string().min(1).max(200),
  aliases: z.array(ReviewedValue).default([]),
  ownedDomains: z.array(ReviewedValue).default([]),
  gbpUrl: z.string().max(500).optional(),
  placeId: z.string().max(200).optional(),
  primaryLocationId: z.string().optional(),
  timezone: z.string().max(64).default("America/Chicago"),
  language: z.string().max(12).default("en"),
  isServiceAreaBusiness: z.boolean().default(false),
  /** Only when the business shows its address publicly; never invented. */
  publicAddress: z.string().max(300).optional(),
  services: z.array(ReviewedValue).default([]),
  categories: z.array(ReviewedValue).default([]),
  locations: z.array(AivLocation).default([]),
  competitors: z.array(AivCompetitor).default([]),
  /** Providers this client is measured with (must be configured agency-wide). */
  providerIds: z.array(ProviderId).default([]),
  scanFrequency: ScanFrequency.default("manual"),
  /** Repetitions per prompt × location × provider (independent observations). */
  repetitions: z.number().int().min(1).max(10).default(3),
  monthlyBudgetUsd: z.number().min(0).max(10000).default(10),
  perScanBudgetUsd: z.number().min(0).max(5000).default(2),
  bilingualLanguage: z.string().max(12).optional(),
  /** Last website-extraction run (suggestions only; never auto-approved). */
  lastSuggestionAt: Iso.optional(),
  activatedAt: Iso.optional(),
  activatedBy: z.string().optional(),
  version: z.number().int().min(1).default(1),
  createdAt: Iso,
  updatedAt: Iso,
  updatedBy: z.string().optional(),
});
export type AivProfileV1 = z.infer<typeof AivProfileV1>;

/* ------------------------------------------------------------------------ */
/* Prompt library                                                            */
/* ------------------------------------------------------------------------ */

export const PromptGroup = z.enum([
  "unbranded_discovery",
  "service_intent",
  "comparison",
  "branded",
  "bilingual",
]);
export type PromptGroup = z.infer<typeof PromptGroup>;

export const PROMPT_GROUP_LABEL: Record<PromptGroup, string> = {
  unbranded_discovery: "Unbranded discovery",
  service_intent: "Service intent",
  comparison: "Comparison intent",
  branded: "Branded research",
  bilingual: "Bilingual (unbranded)",
};

/** Branded prompts name the client; everything else must not. */
export function isBrandedGroup(g: PromptGroup): boolean {
  return g === "branded";
}

export const PromptStatus = z.enum(["draft", "approved", "archived"]);
export type PromptStatus = z.infer<typeof PromptStatus>;

export const PromptVersion = z.object({
  version: z.number().int().min(1),
  text: z.string().min(5).max(600),
  createdAt: Iso,
  createdBy: z.string(),
  changeNote: z.string().max(300).optional(),
});
export type PromptVersion = z.infer<typeof PromptVersion>;

/**
 * Location semantics:
 *  - `explicit_in_text`: the city is written in the prompt ("in La Vergne, TN").
 *    The provider may still receive an approximate user location, but the
 *    observation is NOT equivalent to a GPS-based consumer query.
 *  - `near_me_provider_location`: "near me" with a documented provider location
 *    control applied.
 *  - `near_me_ambiguous`: "near me" without any provider location control.
 */
export const LocationMode = z.enum([
  "explicit_in_text",
  "near_me_provider_location",
  "near_me_ambiguous",
  "none",
]);
export type LocationMode = z.infer<typeof LocationMode>;

export const AivPromptV1 = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  group: PromptGroup,
  language: z.string().max(12).default("en"),
  serviceId: z.string().optional(),
  serviceLabel: z.string().optional(),
  /** Location the prompt targets (also used as the provider user location). */
  locationId: z.string().optional(),
  nearMe: z.boolean().default(false),
  status: PromptStatus.default("draft"),
  currentVersion: z.number().int().min(1),
  versions: z.array(PromptVersion).min(1),
  generatedBy: z.enum(["template", "user"]).default("template"),
  templateKey: z.string().optional(),
  createdAt: Iso,
  updatedAt: Iso,
});
export type AivPromptV1 = z.infer<typeof AivPromptV1>;

export function currentPromptText(p: AivPromptV1): string {
  return (p.versions.find((v) => v.version === p.currentVersion) ?? p.versions[p.versions.length - 1]).text;
}

/* ------------------------------------------------------------------------ */
/* Scans, jobs, attempts                                                     */
/* ------------------------------------------------------------------------ */

export const ScanStatus = z.enum([
  "queued",
  "running",
  "completed",
  "partial",
  "failed",
  "cancelled",
  "budget_stopped",
]);
export type ScanStatus = z.infer<typeof ScanStatus>;

export const TERMINAL_SCAN_STATUSES: ReadonlyArray<ScanStatus> = [
  "completed",
  "partial",
  "failed",
  "cancelled",
  "budget_stopped",
];

export const ScanSlot = z.object({
  /** Stable key: promptId@v:locationId:provider:model:rep */
  key: z.string().min(1),
  promptId: z.string(),
  promptVersion: z.number().int(),
  promptGroup: PromptGroup,
  branded: z.boolean(),
  submittedText: z.string(),
  language: z.string(),
  serviceId: z.string().optional(),
  locationId: z.string().optional(),
  locationMode: LocationMode,
  providerId: ProviderId,
  model: z.string(),
  repetition: z.number().int().min(1),
});
export type ScanSlot = z.infer<typeof ScanSlot>;

export const AivScanV1 = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  clientId: z.string().min(1),
  trigger: z.enum(["manual", "scheduled", "retry"]),
  /** Scheduled scans: period key (e.g. 2026-W43) used for idempotency. */
  scheduleKey: z.string().optional(),
  retryOfScanId: z.string().optional(),
  status: ScanStatus,
  channel: MeasurementChannel.default("official_api"),
  plannedCount: z.number().int().min(0),
  counts: z.object({
    succeeded: z.number().int().default(0),
    failed: z.number().int().default(0),
    cancelled: z.number().int().default(0),
    pending: z.number().int().default(0),
  }),
  estimatedCostUsd: z.number().min(0),
  /** Sum of attempt costs calculated from provider-reported usage. */
  actualCostUsd: z.number().min(0).default(0),
  budgetCapUsd: z.number().min(0),
  /** Fingerprint of prompt versions + providers/models + settings (trend comparability). */
  configFingerprint: z.string(),
  configSummary: z.record(z.string(), z.string()).default({}),
  promptIds: z.array(z.string()).default([]),
  providerModels: z.array(z.string()).default([]),
  locationIds: z.array(z.string()).default([]),
  repetitions: z.number().int().min(1),
  stopReason: z.string().optional(),
  createdBy: z.string(),
  createdAt: Iso,
  startedAt: Iso.optional(),
  finishedAt: Iso.optional(),
  updatedAt: Iso,
});
export type AivScanV1 = z.infer<typeof AivScanV1>;

export const JobStatus = z.enum(["queued", "leased", "succeeded", "failed", "cancelled"]);
export type JobStatus = z.infer<typeof JobStatus>;

export const AivJobV1 = z.object({
  schemaVersion: z.literal(1),
  /** Deterministic: hash(scanId + slot.key). Also the observation id. */
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  scanId: z.string().min(1),
  slot: ScanSlot,
  status: JobStatus,
  attempts: z.number().int().min(0).default(0),
  maxAttempts: z.number().int().min(1).default(4),
  nextAttemptAt: Iso,
  leaseOwner: z.string().optional(),
  leaseExpiresAt: Iso.optional(),
  lastErrorClass: z.string().optional(),
  lastError: z.string().optional(),
  observationId: z.string().optional(),
  createdAt: Iso,
  updatedAt: Iso,
});
export type AivJobV1 = z.infer<typeof AivJobV1>;

/** Outcome classes. Only `success` can produce a valid answer. */
export const CollectionStatus = z.enum([
  "success",
  "no_ai_answer",
  "refusal",
  "timeout",
  "rate_limited",
  "grounding_unavailable",
  "provider_error",
  "auth_error",
  "budget_blocked",
  "parse_failure",
]);
export type CollectionStatus = z.infer<typeof CollectionStatus>;

export const COLLECTION_STATUS_LABEL: Record<CollectionStatus, string> = {
  success: "Answer collected",
  no_ai_answer: "No AI answer",
  refusal: "Refusal",
  timeout: "Timeout",
  rate_limited: "Rate limited",
  grounding_unavailable: "Search/grounding unavailable",
  provider_error: "Provider error",
  auth_error: "Credential or billing error",
  budget_blocked: "Stopped by budget",
  parse_failure: "Response parsing failed",
};

export const AivAttemptV1 = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  scanId: z.string().min(1),
  jobId: z.string().min(1),
  attemptNumber: z.number().int().min(1),
  providerId: ProviderId,
  model: z.string(),
  startedAt: Iso,
  finishedAt: Iso.optional(),
  latencyMs: z.number().int().min(0).default(0),
  /** in_progress is written before the call so an interrupted attempt is never lost. */
  outcome: z.union([CollectionStatus, z.literal("in_progress"), z.literal("interrupted")]),
  errorMessage: z.string().max(1000).optional(),
  httpStatus: z.number().int().optional(),
  requestId: z.string().optional(),
  retryable: z.boolean().default(false),
  costUsd: z.number().min(0).default(0),
  costBasis: z.enum(["calculated_from_reported_usage", "not_billed", "unknown"]).default("unknown"),
  /** Worst-case amount reserved against the spending caps for this attempt. */
  reservedUsd: z.number().min(0).default(0),
  leaseOwner: z.string().optional(),
});
export type AivAttemptV1 = z.infer<typeof AivAttemptV1>;

/* ------------------------------------------------------------------------ */
/* Observations & analysis                                                   */
/* ------------------------------------------------------------------------ */

export const AivCitation = z.object({
  url: z.string(),
  normalizedUrl: z.string(),
  domain: z.string(),
  title: z.string().optional(),
  citedText: z.string().optional(),
  /** Character spans in `answerText` the provider attached this citation to (deduplicated URL → many spans). */
  answerSpans: z.array(z.object({ start: z.number().int(), end: z.number().int() })).default([]),
  /** Order of first appearance (NOT a recommendation rank). */
  order: z.number().int().min(1),
});
export type AivCitation = z.infer<typeof AivCitation>;

export const AivSearchResult = z.object({
  url: z.string(),
  title: z.string().optional(),
  pageAge: z.string().optional(),
});

export const AivUsage = z.object({
  inputTokens: z.number().int().min(0).default(0),
  outputTokens: z.number().int().min(0).default(0),
  searchRequests: z.number().int().min(0).default(0),
  cacheReadTokens: z.number().int().min(0).default(0),
  cacheWriteTokens: z.number().int().min(0).default(0),
});
export type AivUsage = z.infer<typeof AivUsage>;

export const AnswerClass = z.enum([
  "recommendations_present",
  "no_recommendations",
  "refusal",
  "no_answer",
]);
export type AnswerClass = z.infer<typeof AnswerClass>;

export const Sentiment = z.enum(["positive", "neutral", "negative", "ambiguous"]);
export type Sentiment = z.infer<typeof Sentiment>;

export const TextSpan = z.object({
  start: z.number().int(),
  end: z.number().int(),
  text: z.string(),
});
export type TextSpan = z.infer<typeof TextSpan>;

export const EntityFinding = z.object({
  /** "client" | competitor id | "discovered:<normalized name>" */
  entityKey: z.string(),
  kind: z.enum(["client", "competitor", "discovered"]),
  name: z.string(),
  mentioned: z.boolean(),
  recommended: z.boolean(),
  sentiment: Sentiment,
  /** Present only when the answer is an explicitly ordered list. */
  position: z.number().int().min(1).nullable(),
  matchedBy: z.array(z.enum(["name", "alias", "domain"])).default([]),
  spans: z.array(TextSpan).default([]),
  confidence: z.number().min(0).max(1),
  /** A location in the same passage conflicts with the client's service area. */
  locationConflict: z.string().optional(),
  ownedDomainCited: z.boolean().default(false),
  /** Third-party citations whose title/cited text discuss this business. */
  thirdPartyCitationUrls: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
});
export type EntityFinding = z.infer<typeof EntityFinding>;

export const AivAnalysis = z.object({
  extractorVersion: z.string(),
  analyzedAt: Iso,
  status: z.enum(["analyzed", "failed"]),
  error: z.string().optional(),
  answerClass: AnswerClass,
  orderedList: z.boolean(),
  orderedListLength: z.number().int().min(0).default(0),
  entities: z.array(EntityFinding).default([]),
});
export type AivAnalysis = z.infer<typeof AivAnalysis>;

/** Manual correction overlay — applied on top of the extractor output. */
export const EntityOverride = z.object({
  entityKey: z.string(),
  mentioned: z.boolean().optional(),
  recommended: z.boolean().optional(),
  sentiment: Sentiment.optional(),
  position: z.number().int().min(1).nullable().optional(),
});
export type EntityOverride = z.infer<typeof EntityOverride>;

export const AivObservationV1 = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  clientId: z.string().min(1),
  scanId: z.string().optional(),
  jobId: z.string().optional(),
  channel: MeasurementChannel,
  /** Fixture observations are produced by tests only and never shown with live data. */
  isFixture: z.boolean().default(false),
  providerId: ProviderId.optional(),
  /** For manual/consumer channels: the surface label, e.g. "ChatGPT app (manual)". */
  surface: z.string().max(120),
  model: z.string().optional(),
  apiVersion: z.string().optional(),
  promptId: z.string().optional(),
  promptVersion: z.number().int().optional(),
  promptGroup: PromptGroup,
  branded: z.boolean(),
  submittedText: z.string(),
  language: z.string(),
  serviceId: z.string().optional(),
  locationId: z.string().optional(),
  locationMode: LocationMode,
  requestedLocation: z
    .object({ city: z.string().optional(), region: z.string().optional(), country: z.string().optional(), timezone: z.string().optional() })
    .optional(),
  /** What the provider actually accepted (documented control), if any. */
  appliedLocation: z
    .object({ control: z.string(), city: z.string().optional(), region: z.string().optional(), country: z.string().optional(), timezone: z.string().optional() })
    .optional(),
  repetition: z.number().int().optional(),
  collectedAt: Iso,
  searchConfig: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  generationSettings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
  /** True/false only when the provider exposes it; null = not reported. */
  searchExecuted: z.boolean().nullable(),
  searchQueries: z.array(z.string()).default([]),
  searchResults: z.array(AivSearchResult).default([]),
  collectionStatus: CollectionStatus,
  collectionError: z.string().max(1000).optional(),
  answerText: z.string().default(""),
  citations: z.array(AivCitation).default([]),
  /** Provider response (secrets never included); may be truncated for size. */
  rawResponse: z.string().optional(),
  rawResponseTruncated: z.boolean().default(false),
  stopReason: z.string().optional(),
  requestId: z.string().optional(),
  usage: AivUsage.optional(),
  latencyMs: z.number().int().optional(),
  costUsd: z.number().min(0).default(0),
  costBasis: z.enum(["calculated_from_reported_usage", "not_billed", "unknown", "manual"]).default("unknown"),
  attemptCount: z.number().int().min(0).default(0),
  analysis: AivAnalysis.optional(),
  overrides: z.array(EntityOverride).default([]),
  /** Manual channel: who uploaded it and optional evidence file. */
  uploadedBy: z.string().optional(),
  evidenceFileId: z.string().optional(),
  manualNote: z.string().max(2000).optional(),
  createdAt: Iso,
  updatedAt: Iso,
});
export type AivObservationV1 = z.infer<typeof AivObservationV1>;

/* ------------------------------------------------------------------------ */
/* Provider settings, agency settings, audit                                 */
/* ------------------------------------------------------------------------ */

export const AivProviderSettingsV1 = z.object({
  schemaVersion: z.literal(1),
  tenantId: z.string().min(1),
  providerId: ProviderId,
  enabled: z.boolean().default(false),
  model: z.string().max(100),
  maxSearchUses: z.number().int().min(1).max(10).default(3),
  maxOutputTokens: z.number().int().min(256).max(8000).default(3000),
  timeoutMs: z.number().int().min(5000).max(240000).default(90000),
  requestsPerMinute: z.number().int().min(1).max(600).default(20),
  maxConcurrency: z.number().int().min(1).max(10).default(2),
  lastTestAt: Iso.optional(),
  lastTestOk: z.boolean().optional(),
  lastTestMessage: z.string().max(500).optional(),
  updatedAt: Iso,
  updatedBy: z.string().optional(),
});
export type AivProviderSettingsV1 = z.infer<typeof AivProviderSettingsV1>;

export const AivAgencySettingsV1 = z.object({
  schemaVersion: z.literal(1),
  tenantId: z.string().min(1),
  monthlyAgencyCapUsd: z.number().min(0).max(100000).default(50),
  updatedAt: Iso,
  updatedBy: z.string().optional(),
});
export type AivAgencySettingsV1 = z.infer<typeof AivAgencySettingsV1>;

export const AivAuditEventV1 = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().optional(),
  actor: z.string(),
  action: z.string(),
  target: z.string().optional(),
  detail: z.record(z.string(), z.unknown()).default({}),
  at: Iso,
});
export type AivAuditEventV1 = z.infer<typeof AivAuditEventV1>;

export const AivEvidenceFileV1 = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  /** Base64 payload (≤ 700 KB decoded) — kept small enough for one Firestore doc. */
  dataBase64: z.string(),
  uploadedBy: z.string(),
  createdAt: Iso,
});
export type AivEvidenceFileV1 = z.infer<typeof AivEvidenceFileV1>;
