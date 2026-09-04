import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { ClientRecord, MonthlyTouchRecord, QaScorecardCategory } from "@/src/lib/mtos-data";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";

type ClientQaTouchSummary = {
  id: string;
  touchDate: string;
  status: MonthlyTouchRecord["status"];
  qaStatus: MonthlyTouchRecord["qaReview"] extends infer T
    ? T extends { status: infer S }
      ? S
      : "not_started"
    : "not_started";
  overallGrade: string;
  overallScore: number | null;
  sentimentLabel: string;
  sentimentScore: number;
  prepReady: boolean;
  postMeetingReady: boolean;
  qaReady: boolean;
  summary: string;
};

type ClientQaCard = {
  client: ClientRecord;
  averageQaScore: number | null;
  averageSentimentScore: number;
  retentionRisk: "Low" | "Moderate" | "High";
  meetingsRecorded: number;
  latestGrade: string;
  latestTouchDate: string;
  touches: ClientQaTouchSummary[];
};

function average(values: number[]) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function sentimentScoreFromClient(client: ClientRecord) {
  if (client.healthScore >= 85) return 90;
  if (client.healthScore >= 70) return 76;
  if (client.healthScore >= 55) return 62;
  return 44;
}

function sentimentLabel(score: number) {
  if (score >= 85) return "Positive";
  if (score >= 70) return "Stable";
  if (score >= 55) return "Mixed";
  return "At Risk";
}

function retentionRiskFromClient(client: ClientRecord, averageQaScore: number | null) {
  const qaPenalty = averageQaScore !== null && averageQaScore < 75;
  if (client.healthScore < 60 || qaPenalty) return "High";
  if (client.healthScore < 80) return "Moderate";
  return "Low";
}

function overallScoreFromScorecard(scorecard?: QaScorecardCategory[]) {
  if (!scorecard?.length) return null;
  return Math.round((scorecard.reduce((sum, item) => sum + item.score, 0) / scorecard.length) * 20);
}

function sortTouchesNewestFirst(a: MonthlyTouchRecord, b: MonthlyTouchRecord) {
  const aValue = new Date(a.updatedAt || a.scheduledAt || 0).getTime();
  const bValue = new Date(b.updatedAt || b.scheduledAt || 0).getTime();
  return bValue - aValue;
}

export async function getQaClientIndexView(context: TenantContext) {
  const dataSource = getMtosDataSource(context);
  const [clients, touches] = await Promise.all([dataSource.getClients(), dataSource.getMonthlyTouches()]);

  const cards: ClientQaCard[] = clients.map((client) => {
    const clientTouches = touches.filter((touch) => touch.clientId === client.id).sort(sortTouchesNewestFirst);
    const touchSummaries = clientTouches.map((touch) => {
      const overallScore = overallScoreFromScorecard(touch.qaReview?.scorecard);
      const derivedSentimentScore = Math.max(35, Math.min(98, Math.round((client.relationshipScore + client.healthScore) / 2 + (overallScore !== null ? (overallScore - 75) / 3 : 0))));
      return {
        id: touch.id,
        touchDate: client.touchDate,
        status: touch.status,
        qaStatus: touch.qaReview?.status || "not_started",
        overallGrade: touch.qaReview?.overallGrade || "--",
        overallScore,
        sentimentLabel: sentimentLabel(derivedSentimentScore),
        sentimentScore: derivedSentimentScore,
        prepReady: Boolean(touch.prepPack),
        postMeetingReady: Boolean(touch.postMeeting?.analyzedAt),
        qaReady: Boolean(touch.qaReview?.scorecard?.length),
        summary: touch.qaReview?.summary || touch.executiveBrief,
      } satisfies ClientQaTouchSummary;
    });

    const completedScores = touchSummaries
      .map((touch) => touch.overallScore)
      .filter((value): value is number => value !== null);
    const averageQaScore = completedScores.length ? average(completedScores) : null;
    const averageSentimentScore = touchSummaries.length
      ? average(touchSummaries.map((touch) => touch.sentimentScore))
      : sentimentScoreFromClient(client);

    return {
      client,
      averageQaScore,
      averageSentimentScore,
      retentionRisk: retentionRiskFromClient(client, averageQaScore),
      meetingsRecorded: touchSummaries.length,
      latestGrade: touchSummaries[0]?.overallGrade || "--",
      latestTouchDate: touchSummaries[0]?.touchDate || client.touchDate,
      touches: touchSummaries,
    } satisfies ClientQaCard;
  });

  return {
    context,
    cards,
  };
}

export async function getQaClientDetailView(context: TenantContext, clientId: string) {
  const { cards } = await getQaClientIndexView(context);
  return cards.find((item) => item.client.id === clientId) || null;
}

export async function getQaMeetingDetailView(context: TenantContext, touchId: string) {
  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    return null;
  }

  const client = await dataSource.getClientById(touch.clientId);
  if (!client) {
    return null;
  }

  const overallScore = overallScoreFromScorecard(touch.qaReview?.scorecard);
  return {
    context,
    client,
    touch,
    overallScore,
    sentimentScore: Math.max(35, Math.min(98, Math.round((client.relationshipScore + client.healthScore) / 2 + (overallScore !== null ? (overallScore - 75) / 3 : 0)))),
  };
}
