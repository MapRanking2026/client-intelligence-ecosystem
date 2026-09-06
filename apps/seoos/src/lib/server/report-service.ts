import { getProject } from "@/src/lib/server/projects-service";
import { getPerformanceSnapshotRepo } from "@/src/lib/server/repositories/performance-snapshot-repo";
import { listMonthlyAudits } from "@/src/lib/server/monthly-audits-service";
import { listRecommendations } from "@/src/lib/server/recommendations-service";

export interface MonthlyReport {
  businessName: string;
  website?: string;
  niche?: string;
  period: string;
  generatedAt: string;
  hasData: boolean;
  metrics: {
    avgRank: number | null;
    avgShare: number | null;
    keywordsTracked: number;
    checkinBusinesses: number;
    checkinPosts: number;
  };
  keywords: Array<{ keyword: string; rank: number | null; share: number | null; top3: number | null }>;
  audit?: {
    period: string;
    status: string;
    pass: number;
    warn: number;
    fail: number;
    pending: number;
    reviewResponses?: string;
  };
  /** Client-facing changes with plain-language explanations (category/service). */
  changes: Array<{ title: string; explanation: string }>;
  notes: string[];
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

/**
 * Compose a monthly client report from the latest performance snapshot, the
 * most recent monthly audit, and any client-facing changes. Read-only; assembles
 * only real, synced data (no fabricated metrics). Returns hasData:false when a
 * client hasn't been synced yet.
 */
export async function composeMonthlyReport(
  tenantId: string,
  projectId: string,
): Promise<MonthlyReport | null> {
  const project = await getProject(tenantId, projectId);
  if (!project) return null;

  const snapshot = await getPerformanceSnapshotRepo().get(tenantId, projectId);
  const audits = await listMonthlyAudits(tenantId, projectId);
  const latestAudit = audits.length
    ? audits.slice().sort((a, b) => b.period.localeCompare(a.period))[0]
    : undefined;
  const recs = await listRecommendations(tenantId, projectId);

  const now = new Date();
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  const grids = snapshot?.grids ?? [];
  const rankVals = grids.map((g) => g.averageRankPosition).filter((v): v is number => v != null);
  const shareVals = grids.map((g) => g.shareOfLocalVoicePercent).filter((v): v is number => v != null);

  const audit = latestAudit
    ? (() => {
        const count = (r: string) => latestAudit.items.filter((i) => i.result === r).length;
        const reviewItem = latestAudit.items.find((i) => i.key === "review_responses");
        return {
          period: latestAudit.period,
          status: latestAudit.status,
          pass: count("pass"),
          warn: count("warning"),
          fail: count("fail"),
          pending: count("pending"),
          reviewResponses: reviewItem?.notes,
        };
      })()
    : undefined;

  const changes = recs
    .filter((r) => r.changeExplanation && (r.status === "approved" || r.status === "converted"))
    .map((r) => ({ title: r.title, explanation: r.changeExplanation as string }));

  return {
    businessName: project.businessName,
    website: project.website,
    niche: project.niche,
    period,
    generatedAt: now.toISOString(),
    hasData: Boolean(snapshot) || Boolean(latestAudit),
    metrics: {
      avgRank: avg(rankVals),
      avgShare: avg(shareVals),
      keywordsTracked: snapshot?.keywords.length ?? 0,
      checkinBusinesses: snapshot?.checkinBusinessCount ?? 0,
      checkinPosts: snapshot?.checkinTotalPosts ?? 0,
    },
    keywords: grids.slice(0, 30).map((g) => ({
      keyword: g.keyword,
      rank: g.averageRankPosition,
      share: g.shareOfLocalVoicePercent,
      top3: g.top3Percent,
    })),
    audit,
    changes,
    notes: snapshot?.notes ?? [],
  };
}
