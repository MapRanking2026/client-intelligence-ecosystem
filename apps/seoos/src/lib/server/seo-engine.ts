import { z } from "zod";
import {
  AppId,
  canTransition,
  ReportingPeriodV1,
  SeoCapabilityId,
  SeoIntelligencePackageV1,
  SeoIntelligenceRequestV1,
  type SeoPackageSectionV1,
  type SeoRequestStatus,
  zClientId,
} from "@cie/contracts";
import {
  getCapability,
  makeSeoPackageIdempotencyKey,
  makeSeoRequestIdempotencyKey,
} from "@cie/core";
import { hash32, newId, nowIso } from "@/src/lib/ids";
import { getRequestRepo } from "@/src/lib/server/repositories/request-repo";

/**
 * SEO Intelligence engine — the request→package loop, now persisted through the
 * RequestRepo (Firestore when creds are present, in-memory seed otherwise).
 *
 * Fulfillment currently uses deterministic stub producers over synced-data
 * shapes; real per-capability producers land per Phase in the ledger. Requests
 * are idempotency-keyed so duplicate Monthly-Touch prep never double-orders.
 */
export interface SeoContext {
  tenantId: string;
  userId?: string;
  app: z.infer<typeof AppId>;
}

export const CreateSeoRequestInput = z.object({
  clientId: zClientId,
  capability: SeoCapabilityId,
  presetVersion: z.number().int().min(1).default(1),
  reportingPeriod: ReportingPeriodV1,
  monthlyTouchId: z.string().trim().min(1).optional(),
  customQuestions: z.array(z.string().min(1)).default([]),
  intendedAudience: z
    .enum(["internal", "account_manager", "client_ready"])
    .default("internal"),
  priority: z.enum(["normal", "high", "urgent"]).default("normal"),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type CreateSeoRequestInput = z.infer<typeof CreateSeoRequestInput>;

type Request = z.infer<typeof SeoIntelligenceRequestV1>;
type Package = z.infer<typeof SeoIntelligencePackageV1>;

function advance(request: Request, to: SeoRequestStatus): Request {
  if (!canTransition(request.status, to)) {
    throw new Error(`Illegal SEO request transition ${request.status} → ${to}`);
  }
  return { ...request, status: to, updatedAt: nowIso() };
}

function stubSections(request: Request): SeoPackageSectionV1[] {
  const seed = hash32(`${request.clientId}:${request.capability}`);
  const rank = 1 + (seed % 20);
  const delta = ((seed >> 5) % 11) - 5;
  const share = 5 + ((seed >> 3) % 60);

  const ranking: SeoPackageSectionV1 = {
    key: "ranking-summary",
    title: "Keyword Ranking Summary",
    kind: "ranking",
    data: { averagePosition: rank, positionChange: delta, trackedKeywords: 25 + (seed % 50) },
    evidence: [
      {
        schemaVersion: 1,
        id: `ev_${seed.toString(16)}`,
        sourceProvider: "rank-tracker",
        capability: request.capability,
        freshness: "cached",
        confidence: "medium",
        redactionLevel: "aggregate",
        lineage: [{ source: "rank-tracker", detail: "period rollup" }],
      },
    ],
    confidence: "medium",
  };
  const grid: SeoPackageSectionV1 = {
    key: "grid-heatmap",
    title: "Grid Heatmap (market share)",
    kind: "grid-heatmap",
    data: { marketSharePct: share, gridPoints: 49 },
    evidence: [],
    confidence: "low",
  };

  switch (request.capability) {
    case "keyword-ranking-summary":
    case "keyword-deep-dive":
      return [ranking];
    case "grid-heatmap-analysis":
    case "market-share-analysis":
      return [grid];
    case "full-monthly-package":
      return [ranking, grid];
    default:
      return [
        {
          key: "narrative",
          title: getCapability(request.capability)?.label ?? "Result",
          kind: "narrative",
          data: { note: "Stub producer — real fulfillment pending (see ledger)." },
          evidence: [],
          confidence: "low",
        },
      ];
  }
}

function produce(request: Request): Package {
  const version = 1;
  const sections = stubSections(request);
  const overall = sections.some((s) => s.confidence === "low")
    ? "low"
    : sections.some((s) => s.confidence === "medium")
      ? "medium"
      : "high";
  return SeoIntelligencePackageV1.parse({
    schemaVersion: 1,
    id: newId("pkg"),
    requestId: request.id,
    tenantId: request.tenantId,
    clientId: request.clientId,
    capability: request.capability,
    version,
    supersedesVersion: null,
    reportingPeriod: request.reportingPeriod,
    sections,
    dataGaps: sections.some((s) => s.confidence === "low")
      ? [{ schemaVersion: 1, area: "grid", reason: "Latest scan is stale.", severity: "warning" }]
      : [],
    overallConfidence: overall,
    correlationId: request.correlationId,
    idempotencyKey: makeSeoPackageIdempotencyKey(request.idempotencyKey, version),
    producedAt: nowIso(),
  });
}

export interface SubmitResult {
  request: Request;
  package: Package | null;
  deduped: boolean;
}

export async function submitSeoRequest(
  ctx: SeoContext,
  input: CreateSeoRequestInput,
): Promise<SubmitResult> {
  const repo = getRequestRepo();
  const idempotencyKey = makeSeoRequestIdempotencyKey({
    tenantId: ctx.tenantId,
    clientId: input.clientId,
    monthlyTouchId: input.monthlyTouchId,
    capability: input.capability,
    presetVersion: input.presetVersion,
    reportingPeriod: input.reportingPeriod,
  });

  const existing = await repo.findRequestByIdempotencyKey(ctx.tenantId, idempotencyKey);
  if (existing) {
    return {
      request: existing,
      package: await repo.getLatestPackage(ctx.tenantId, existing.id),
      deduped: true,
    };
  }

  const now = nowIso();
  let request: Request = SeoIntelligenceRequestV1.parse({
    schemaVersion: 1,
    id: newId("req"),
    tenantId: ctx.tenantId,
    clientId: input.clientId,
    monthlyTouchId: input.monthlyTouchId,
    capability: input.capability,
    presetVersion: input.presetVersion,
    reportingPeriod: input.reportingPeriod,
    lineItems: [],
    customQuestions: input.customQuestions,
    intendedAudience: input.intendedAudience,
    priority: input.priority,
    params: input.params,
    idempotencyKey,
    correlationId: newId("corr"),
    status: "submitted",
    requestedByApp: ctx.app,
    requestedByUserId: ctx.userId,
    createdAt: now,
    updatedAt: now,
  });
  await repo.saveRequest(request);

  // Synchronous lifecycle for cacheable capabilities: queued → processing →
  // produce → qa_review → ready. Approval-gated capabilities would pause here.
  request = advance(request, "queued");
  request = advance(request, "processing");
  const pkg = produce(request);
  await repo.savePackage(pkg);
  request = advance(request, "qa_review");
  request = advance(request, "ready");
  await repo.saveRequest(request);

  return { request, package: pkg, deduped: false };
}

export async function getRequest(tenantId: string, requestId: string) {
  return getRequestRepo().getRequest(tenantId, requestId);
}

export async function getLatestPackage(tenantId: string, requestId: string) {
  return getRequestRepo().getLatestPackage(tenantId, requestId);
}

export async function listRequests(tenantId: string) {
  return getRequestRepo().listRequests(tenantId);
}
