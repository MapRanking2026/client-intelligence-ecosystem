import type { AuthzContextV1 } from "@cie/contracts";

import type { SeoProjectV1 } from "@/src/lib/domain/project";
import { normalizePhrase } from "@/src/lib/domain/keyword";
import { getPerformanceSnapshotRepo } from "@/src/lib/server/repositories/performance-snapshot-repo";
import { getKeywordRepo } from "@/src/lib/server/repositories/keyword-repo";
import { getRuleNumber, getRuleRange } from "@/src/lib/server/rules-service";

/**
 * Keyword Portfolio Refinement (spec M2.38-42): flag tracked keywords that
 * are dragging the portfolio so a specialist can consider replacing them.
 * Reads the portfolio size and Low-Performance band from the Rule Library.
 *
 * Honest scope: the SOP's Phase-1 triggers include "flat 3+ months" and
 * "declining", which need multi-scan history SEOOS doesn't store yet. From a
 * single current snapshot we can reliably detect the two point-in-time
 * triggers - "significantly weaker than the portfolio average" and "in the
 * weak absolute rank band" - and we say so rather than pretending to trend.
 */
export type KeywordVerdict = "strong" | "progressing" | "candidate" | "no_data";

export interface KeywordRefinementRow {
  phrase: string;
  avgRank: number | null;
  top3Pct: number | null;
  verdict: KeywordVerdict;
  reason?: string;
}

export interface KeywordRefinement {
  portfolioAvgRank: number | null;
  rankedCount: number;
  portfolioSize: number;
  rows: KeywordRefinementRow[];
  candidates: KeywordRefinementRow[];
  /** How much worse than the portfolio average counts as "significantly weaker". */
  weakerThanAvgBy: number;
  lowPerfBand: [number, number];
  notes: string[];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export async function getKeywordRefinement(
  authz: AuthzContextV1,
  project: SeoProjectV1,
): Promise<KeywordRefinement> {
  const tenantId = authz.tenantId;
  const [snapshot, keywords, portfolioSize, lowPerfBand] = await Promise.all([
    getPerformanceSnapshotRepo().get(tenantId, project.id),
    getKeywordRepo().listByProject(tenantId, project.id),
    getRuleNumber(tenantId, "keywords.portfolio.size", 5),
    getRuleRange(tenantId, "low_performance.avg_rank_band", 5, 20),
  ]);
  const [, lpHi] = lowPerfBand;
  // "Significantly weaker" = worse than the portfolio average by this many
  // positions. Derived from the low-perf band width so it scales with the rule.
  const weakerThanAvgBy = Math.max(3, Math.round((lowPerfBand[1] - lowPerfBand[0]) / 3));

  // Grid ranks keyed by normalized phrase.
  const gridByPhrase = new Map<string, { avgRank: number | null; top3Pct: number | null }>();
  for (const g of snapshot?.grids ?? []) {
    gridByPhrase.set(normalizePhrase(g.keyword), {
      avgRank: g.averageRankPosition,
      top3Pct: g.top3Percent,
    });
  }

  // Universe = tracked keywords if we have them, else the snapshot's grid keywords.
  const phrases = keywords.length
    ? keywords.map((k) => ({ phrase: k.phrase, norm: k.normalizedPhrase }))
    : (snapshot?.grids ?? []).map((g) => ({ phrase: g.keyword, norm: normalizePhrase(g.keyword) }));

  const rows: KeywordRefinementRow[] = phrases.map(({ phrase, norm }) => {
    const grid = gridByPhrase.get(norm);
    const avgRank = grid?.avgRank ?? null;
    const top3Pct = grid?.top3Pct ?? null;
    return { phrase, avgRank, top3Pct, verdict: avgRank == null ? "no_data" : "progressing" };
  });

  const rankedRows = rows.filter((r) => r.avgRank != null) as Array<KeywordRefinementRow & { avgRank: number }>;
  const rankedCount = rankedRows.length;
  const portfolioAvgRank = rankedCount
    ? round1(rankedRows.reduce((a, r) => a + r.avgRank, 0) / rankedCount)
    : null;

  if (portfolioAvgRank != null) {
    for (const r of rankedRows) {
      if (r.avgRank <= 3) {
        r.verdict = "strong";
        continue;
      }
      const weakVsAvg = r.avgRank >= portfolioAvgRank + weakerThanAvgBy;
      const weakAbsolute = r.avgRank > lpHi; // beyond the low-perf band = genuinely weak
      if (weakVsAvg || weakAbsolute) {
        r.verdict = "candidate";
        r.reason = weakAbsolute
          ? `Avg rank ${r.avgRank} is beyond the ${lowPerfBand[0]}-${lowPerfBand[1]} band`
          : `Avg rank ${r.avgRank} is ${round1(r.avgRank - portfolioAvgRank)} worse than the portfolio average (${portfolioAvgRank})`;
      }
    }
  }

  const candidates = rankedRows.filter((r) => r.verdict === "candidate");

  const notes: string[] = [];
  if (keywords.length === 0) notes.push("No tracked keywords on file — analysis uses the grid's own keyword set.");
  if (rankedCount === 0) notes.push("No rank data yet — run a full scan to detect refinement candidates.");
  notes.push(
    "Trend triggers (flat 3+ months, declining) need multi-scan history not stored yet — this pass detects point-in-time weakness only.",
  );

  return {
    portfolioAvgRank,
    rankedCount,
    portfolioSize,
    rows,
    candidates,
    weakerThanAvgBy,
    lowPerfBand,
    notes,
  };
}
