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
  makeSeoPackageIdempotencyKey,
  makeSeoRequestIdempotencyKey,
  type SeoIntelligencePort,
} from "@cie/core";
import { hash32, newId, nowIso } from "@/src/lib/ids";

/**
 * In-memory SEO Intelligence engine — the first request→package vertical slice.
 *
 * This is a demo/reference implementation of the shared SeoIntelligencePort:
 * requests + immutable packages live in module memory (reset on restart, not
 * shared across serverless instances). The real implementation swaps this for
 * the Firestore-backed adapter + durable outbox behind the SEOOS server
 * boundary, and enforces authn + tenant + client visibility + permission
 * BEFORE these functions are called (see mtos-seoos-boundaries.md §4).
 */

// --- Context (auth is stubbed for the slice) -------------------------------
export interface SeoContext {
  tenantId: string;
  userId?: string;
  app: z.infer<typeof AppId>;
}

// --- Create payload (validated at the API edge) ----------------------------
export const CreateSeoRequestInput = z.object({
  clientId: zClientId,
  capability: SeoCapabilityId,
  presetVersion: z.number().int().min(1).default(1),
  reportingPeriod: ReportingPeriodV1,
  monthlyTouchId: z.string().trim().min(1).optional(),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type CreateSeoRequestInput = z.infer<typeof CreateSeoRequestInput>;

type Request = z.infer<typeof SeoIntelligenceRequestV1>;
type Package = z.infer<typeof SeoIntelligencePackageV1>;

// --- Store -----------------------------------------------------------------
const requests = new Map<string, Request>(); // `${tenantId}::${requestId}`
const packages = new Map<string, Package[]>(); // `${tenantId}::${requestId}` → versions
const idemIndex = new Map<string, string>(); // `${tenantId}::${idempotencyKey}` → requestId

const rk = (tenantId: string, requestId: string) => `${tenantId}::${requestId}`;
const ik = (tenantId: string, key: string) => `${tenantId}::${key}`;

function advance(request: Request, to: SeoRequestStatus): Request {
  if (!canTransition(request.status, to)) {
    throw new Error(
      `Illegal SEO request transition ${request.status} → ${to}`,
    );
  }
  return { ...request, status: to, updatedAt: nowIso() };
}

// --- Capability producers (deterministic stubs) ----------------------------
function stubSections(request: Request): SeoPackageSectionV1[] {
  const seed = hash32(`${request.clientId}:${request.capability}`);
  const rank = 1 + (seed % 20);
  const delta = ((seed >> 5) % 11) - 5;
  const share = 5 + ((seed >> 3) % 60);

  const ranking: SeoPackageSectionV1 = {
    key: "ranking-summary",
    title: "Keyword Ranking Summary",
    kind: "ranking",
    data: {
      averagePosition: rank,
      positionChange: delta,
      trackedKeywords: 25 + (seed % 50),
    },
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
    evidence: [
      {
        schemaVersion: 1,
        id: `ev_${(seed ^ 0x9e3779b9).toString(16)}`,
        sourceProvider: "geogrid",
        capability: request.capability,
        freshness: "stale",
        confidence: "low",
        redactionLevel: "aggregate",
        lineage: [{ source: "geogrid", detail: "last completed scan" }],
      },
    ],
    confidence: "low",
  };

  switch (request.capability) {
    case "keyword-ranking-summary":
      return [ranking];
    case "grid-heatmap-analysis":
      return [grid];
    case "gbp-performance":
      return [
        {
          key: "gbp-performance",
          title: "GBP Performance",
          kind: "gbp-performance",
          data: { calls: 10 + (seed % 40), directionRequests: seed % 30 },
          evidence: [],
          confidence: "medium",
        },
      ];
    case "full-monthly-package":
      return [ranking, grid];
    case "custom-question":
    default:
      return [
        {
          key: "narrative",
          title: "Answer",
          kind: "narrative",
          data: { note: "Stub answer — real producer pending." },
          evidence: [],
          confidence: "low",
        },
      ];
  }
}

function produce(request: Request): Package {
  const version = 1;
  const sections = stubSections(request);
  const worst = sections.some((s) => s.confidence === "low")
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
      ? [
          {
            schemaVersion: 1,
            area: "grid",
            reason: "Latest scan is stale; showing last completed grid.",
            severity: "warning",
          },
        ]
      : [],
    overallConfidence: worst,
    correlationId: request.correlationId,
    idempotencyKey: makeSeoPackageIdempotencyKey(
      request.idempotencyKey,
      version,
    ),
    producedAt: nowIso(),
  });
}

// --- Public API (implements SeoIntelligencePort, plus slice helpers) --------
export interface SubmitResult {
  request: Request;
  package: Package | null;
  deduped: boolean;
}

export function submitSeoRequest(
  ctx: SeoContext,
  input: CreateSeoRequestInput,
): SubmitResult {
  const idempotencyKey = makeSeoRequestIdempotencyKey({
    tenantId: ctx.tenantId,
    clientId: input.clientId,
    monthlyTouchId: input.monthlyTouchId,
    capability: input.capability,
    presetVersion: input.presetVersion,
    reportingPeriod: input.reportingPeriod,
  });

  const existingId = idemIndex.get(ik(ctx.tenantId, idempotencyKey));
  if (existingId) {
    const existing = requests.get(rk(ctx.tenantId, existingId))!;
    return {
      request: existing,
      package: getLatestPackageSync(ctx.tenantId, existingId),
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
    params: input.params,
    idempotencyKey,
    correlationId: newId("corr"),
    status: "submitted",
    requestedByApp: ctx.app,
    requestedByUserId: ctx.userId,
    createdAt: now,
    updatedAt: now,
  });

  requests.set(rk(ctx.tenantId, request.id), request);
  idemIndex.set(ik(ctx.tenantId, idempotencyKey), request.id);

  // Synchronous lifecycle for the slice: queued → processing → produce → ready.
  request = advance(request, "queued");
  request = advance(request, "processing");
  const pkg = produce(request);
  packages.set(rk(ctx.tenantId, request.id), [pkg]);
  request = advance(request, "qa_review");
  request = advance(request, "ready");
  requests.set(rk(ctx.tenantId, request.id), request);

  return { request, package: pkg, deduped: false };
}

export function getRequestSync(
  tenantId: string,
  requestId: string,
): Request | null {
  return requests.get(rk(tenantId, requestId)) ?? null;
}

export function getLatestPackageSync(
  tenantId: string,
  requestId: string,
): Package | null {
  const versions = packages.get(rk(tenantId, requestId));
  return versions && versions.length ? versions[versions.length - 1] : null;
}

export function listRequests(tenantId: string): Request[] {
  return [...requests.values()]
    .filter((r) => r.tenantId === tenantId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Adapter object conforming to the shared port (async surface). */
export const seoEngine: SeoIntelligencePort = {
  async submitRequest(request) {
    // Direct persistence path (already-shaped request); the slice primarily
    // uses submitSeoRequest, but the port stays satisfiable.
    requests.set(rk(request.tenantId, request.id), request);
    idemIndex.set(ik(request.tenantId, request.idempotencyKey), request.id);
    return request;
  },
  async getRequest(tenantId, requestId) {
    return getRequestSync(tenantId, requestId);
  },
  async getLatestPackage(tenantId, requestId) {
    return getLatestPackageSync(tenantId, requestId);
  },
};
