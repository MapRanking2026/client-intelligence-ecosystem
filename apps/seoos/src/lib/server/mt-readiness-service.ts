import type { AuthzContextV1 } from "@cie/contracts";

import type { SeoProjectV1 } from "@/src/lib/domain/project";
import { getPerformanceSnapshotRepo } from "@/src/lib/server/repositories/performance-snapshot-repo";
import { getKeywordRepo } from "@/src/lib/server/repositories/keyword-repo";
import { getRuleNumber } from "@/src/lib/server/rules-service";

/**
 * Monthly-Touch readiness scorecard (spec M3.18 "GBP 100%" gate + M9 pre-MT
 * prep). Deterministic (no AI, no live API call): scores the concrete client
 * facts SEOOS already holds — project fields, tracked keywords, grid baseline,
 * synced SEO Dashboard signals — computes a completeness %, and compares it to
 * the pre-MT readiness gate from the Rule Library. Honest about limits: GBP
 * field-level completeness, live rating, and review-reply status can't be
 * verified from the data at hand, so those are surfaced as manual-check items,
 * never faked. Read-only; no outbound.
 */
export type ReadinessState = "ready" | "not_ready" | "manual";

export interface ReadinessItem {
  label: string;
  state: ReadinessState;
  detail?: string;
}

export interface MtReadiness {
  completenessPct: number;
  completenessGatePct: number;
  reviewsRepliedGatePct: number;
  ready: boolean;
  items: ReadinessItem[];
  /** Items needing a human check because no data at hand confirms them. */
  manualChecks: ReadinessItem[];
}

export async function getMtReadiness(
  authz: AuthzContextV1,
  project: SeoProjectV1,
): Promise<MtReadiness> {
  const tenantId = authz.tenantId;
  const [snapshot, keywords, completenessGatePct, reviewsRepliedGatePct] = await Promise.all([
    getPerformanceSnapshotRepo().get(tenantId, project.id),
    getKeywordRepo().listByProject(tenantId, project.id),
    getRuleNumber(tenantId, "gbp.pre_mt_readiness.completeness_pct", 100),
    getRuleNumber(tenantId, "gbp.pre_mt_readiness.reviews_replied_pct", 100),
  ]);

  const hasGrids = Boolean(snapshot && snapshot.grids.length);
  const metrics = project.dashboardMetrics ?? {};
  // Reviews signal from synced SEO Dashboard fields (no live API call): any
  // metric mentioning reviews/reputation/satisfaction counts as "tracked".
  const hasReviewSignal = Object.keys(metrics).some((k) => /review|reputation|satisfaction/i.test(k));

  // Scored items — deterministic, from facts SEOOS actually holds.
  const scored: ReadinessItem[] = [
    { label: "Website on file", state: project.website ? "ready" : "not_ready", detail: project.website },
    { label: "Niche / vertical set", state: project.niche ? "ready" : "not_ready", detail: project.niche },
    { label: "Target locations (geo)", state: project.targetLocations?.length ? "ready" : "not_ready", detail: project.targetLocations?.join(", ") },
    { label: "Services listed", state: project.services?.length ? "ready" : "not_ready", detail: project.services?.length ? `${project.services.length}` : undefined },
    { label: "Tracked keywords", state: keywords.length ? "ready" : "not_ready", detail: `${keywords.length}` },
    { label: "Rank/grid baseline pulled", state: hasGrids ? "ready" : "not_ready" },
    { label: "Pod assigned", state: project.externalIds?.pod ? "ready" : "not_ready", detail: project.externalIds?.pod },
    { label: `Setup readiness >= 80%`, state: project.setupReadiness >= 80 ? "ready" : "not_ready", detail: `${project.setupReadiness}%` },
    { label: "Dashboard metrics synced", state: Object.keys(metrics).length ? "ready" : "not_ready" },
    { label: "Reviews tracked (dashboard)", state: hasReviewSignal ? "ready" : "not_ready", detail: hasReviewSignal ? undefined : "no reviews/satisfaction signal synced" },
  ];

  // Items that can't be confirmed from the data at hand — always manual.
  const manualChecks: ReadinessItem[] = [
    { label: "GBP profile 100% complete", state: "manual", detail: "Verify every GBP field in the profile (categories, description, hours, services, attributes, photos)." },
    { label: "Average rating healthy (>= 4.0)", state: "manual", detail: "Confirm the live rating in the GBP performance panel below." },
    { label: `All reviews replied to (>= ${reviewsRepliedGatePct}%)`, state: "manual", detail: "The reviews API here doesn't expose reply status - confirm in GBP." },
  ];

  const scoredCountable = scored.filter((i) => i.state !== "manual");
  const readyCount = scoredCountable.filter((i) => i.state === "ready").length;
  const completenessPct = scoredCountable.length
    ? Math.round((readyCount / scoredCountable.length) * 100)
    : 0;
  const ready = completenessPct >= completenessGatePct;

  return {
    completenessPct,
    completenessGatePct,
    reviewsRepliedGatePct,
    ready,
    items: scored,
    manualChecks,
  };
}
