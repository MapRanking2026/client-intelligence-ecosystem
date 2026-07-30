import { z } from "zod";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { CallGuide, CallGuideSection, MonthlyTouchRecord, ScorecardMetric } from "@/src/lib/mtos-data";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { getServerEnv } from "@/src/lib/server/env";
import { callLlmForJson, getNowIso, hasAnyLlmProvider, stripUndefinedDeep } from "@/src/lib/server/services/mtos-ai";
import { getPromptText } from "@/src/lib/server/prompt-store";

const callGuideSchema = z.object({
  sections: z
    .array(
      z.object({
        title: z.string().min(1),
        minutes: z.number().min(1).max(30),
        talkingPoints: z.array(z.string().min(1)).min(1).max(5),
        clientPrompts: z.array(z.string().min(1)).min(1).max(3),
      }),
    )
    .min(4)
    .max(7),
});

function formatScorecardMetric(metric?: ScorecardMetric) {
  if (!metric || metric.availability !== "available" || metric.value === null) {
    return null;
  }
  const value = metric.unit === "currency" ? `$${metric.value}` : metric.unit === "percent" ? `${metric.value}%` : metric.value;
  const delta =
    metric.previousValue !== null && metric.previousValue !== undefined
      ? ` (was ${metric.previousValue})`
      : "";
  return `${metric.label}: ${value}${delta}`;
}

/**
 * Deterministic fallback: builds a timed guide straight from the prep pack so an AM always has a
 * usable, evidence-backed guide even if Claude is unavailable. Real numbers only, nothing invented.
 */
function buildDeterministicSections(touch: MonthlyTouchRecord): CallGuideSection[] {
  const prepPack = touch.prepPack;
  const sections: CallGuideSection[] = [];

  // Scorecard first -- the SOP leads with business numbers, not services.
  const scorecard = prepPack?.businessScorecard;
  const scorecardPoints = scorecard
    ? [
        formatScorecardMetric(scorecard.totalLeads),
        formatScorecardMetric(scorecard.qualifiedLeads),
        formatScorecardMetric(scorecard.bookedJobs),
        formatScorecardMetric(scorecard.callsAnswered),
        formatScorecardMetric(scorecard.costPerLead),
      ].filter((point): point is string => Boolean(point))
    : [];
  sections.push({
    title: "Business scorecard",
    minutes: 12,
    talkingPoints: scorecardPoints.length
      ? scorecardPoints
      : ["No CRM/ads numbers are connected -- gather them live using the client prompts."],
    clientPrompts: (prepPack?.leadQualityQuestions || []).slice(0, 2).length
      ? (prepPack?.leadQualityQuestions || []).slice(0, 2)
      : ["How many of this month's leads turned into real jobs?"],
  });

  // SEO / visibility, quoting month-over-month movement per keyword.
  const seoPoints = (prepPack?.seoPerformance?.profiles || [])
    .filter((profile) => profile.status === "active")
    .flatMap((profile) =>
      profile.heatmapComparisons.slice(0, 3).map((comparison) => {
        const movement =
          comparison.previous?.shareOfLocalVoicePercent != null
            ? ` (was ${comparison.previous.shareOfLocalVoicePercent}%)`
            : "";
        return `${profile.business.businessName} -- "${comparison.keyword}": Market Share ${comparison.current.shareOfLocalVoicePercent ?? "n/a"}%${movement}, ARP ${comparison.current.averageRankPosition ?? "n/a"}`;
      }),
    )
    .slice(0, 5);
  if (seoPoints.length) {
    sections.push({
      title: "Map visibility: this month vs last",
      minutes: 12,
      talkingPoints: seoPoints,
      clientPrompts: ["Are you feeling that visibility change in call volume?"],
    });
  }

  // Strategic action implementation %.
  const strategicAction = prepPack?.strategicAction;
  if (strategicAction) {
    sections.push({
      title: "Strategic action review",
      minutes: 8,
      talkingPoints: strategicAction.hasAgreedAction
        ? [
            `"${strategicAction.title}" is ${strategicAction.implementationPercent}% implemented.`,
            strategicAction.resultsSoFar || "Results so far are not documented yet.",
            strategicAction.nextSteps,
          ].filter(Boolean)
        : [strategicAction.nextSteps],
      clientPrompts: ["Does that next step still line up with your priorities?"],
    });
  }

  // Issues, each already carrying a proposed solution and owner.
  const issuePoints = (prepPack?.issuesAndSolutions || [])
    .slice(0, 3)
    .map((item) => `${item.issue} -- ${item.businessImpact} Fix: ${item.solution} (${item.owner}, due ${item.dueDate})`);
  const risks = issuePoints.length ? issuePoints : touch.risks.slice(0, 3);
  if (risks.length) {
    sections.push({
      title: "Issues and what we're already doing",
      minutes: 10,
      talkingPoints: risks,
      clientPrompts: ["Anything else that felt off this month we haven't covered?"],
    });
  }

  // Wins + growth conversation.
  sections.push({
    title: "Wins and growth conversation",
    minutes: 12,
    talkingPoints: [...touch.wins.slice(0, 3), ...touch.talkingPoints.slice(0, 2)].filter(Boolean).length
      ? [...touch.wins.slice(0, 3), ...touch.talkingPoints.slice(0, 2)].filter(Boolean)
      : ["Anchor the conversation on measurable business value."],
    clientPrompts: ["Where do you want to grow over the next quarter?"],
  });

  // Recap -- the SOP's five-question close.
  sections.push({
    title: "Recap and close",
    minutes: 6,
    talkingPoints: (prepPack?.recapQuestions || []).map((item) => item.question).length
      ? (prepPack?.recapQuestions || []).map((item) => item.question)
      : ["Restate what was agreed, with owners and dates."],
    clientPrompts: ["Can you give me a tentative date for the items on your side?"],
  });

  return sections;
}

async function generateClaudeSections(
  env: ReturnType<typeof getServerEnv>,
  touch: MonthlyTouchRecord,
): Promise<{ sections: CallGuideSection[]; provider: string; model: string } | null> {
  if (!hasAnyLlmProvider(env)) {
    return null;
  }

  const system = await getPromptText("meeting_structure_run_sheet_prompt");

  const prepPack = touch.prepPack;
  const userText = [
    "Return a JSON object with a single key: sections.",
    "Each section needs: title, minutes (integer), talkingPoints (array of strings), clientPrompts (array of strings).",
    "Use only the preparation bundle below. Do not invent metrics or sources.",
    "",
    JSON.stringify(
      {
        agenda: touch.agenda,
        wins: touch.wins,
        risks: touch.risks,
        talkingPoints: touch.talkingPoints,
        executiveBrief: touch.executiveBrief,
        commitments: touch.commitments,
        opportunities: touch.opportunities,
        // The full evidence bundle: every connected source that fed the prep pack.
        prepPack: prepPack
          ? {
              clientSummary: prepPack.clientSummary,
              schedule: prepPack.schedule,
              focusAreas: prepPack.focusAreas,
              keyFacts: prepPack.keyFacts,
              openCommitments: prepPack.openCommitments,
              activeOpportunities: prepPack.activeOpportunities,
              businessScorecard: prepPack.businessScorecard,
              seoPerformance: prepPack.seoPerformance
                ? {
                    // Drop raw pin arrays -- the AM reads those off the heatmap, not the guide.
                    profiles: (prepPack.seoPerformance.profiles || []).map((profile) => ({
                      businessName: profile.business.businessName,
                      address: profile.business.address,
                      rating: profile.business.rating,
                      reviews: profile.business.reviews,
                      status: profile.status,
                      statusNote: profile.statusNote,
                      keywordScans: profile.keywordScans,
                      heatmapSummary: profile.heatmapComparisons.map((comparison) => ({
                        keyword: comparison.keyword,
                        current: {
                          scanDate: comparison.current.scanDate,
                          averageRankPosition: comparison.current.averageRankPosition,
                          shareOfLocalVoicePercent: comparison.current.shareOfLocalVoicePercent,
                          top3Percent: comparison.current.top3Percent,
                          topCompetitors: comparison.current.topCompetitors,
                        },
                        previous: comparison.previous
                          ? {
                              scanDate: comparison.previous.scanDate,
                              averageRankPosition: comparison.previous.averageRankPosition,
                              shareOfLocalVoicePercent: comparison.previous.shareOfLocalVoicePercent,
                            }
                          : null,
                      })),
                    })),
                    gbpPerformance: prepPack.seoPerformance.gbpPerformance,
                    checkinBusinesses: prepPack.seoPerformance.checkinBusinesses,
                    notes: prepPack.seoPerformance.notes,
                  }
                : null,
              adsPerformance: prepPack.adsPerformance,
              strategicAction: prepPack.strategicAction,
              clientParticipation: prepPack.clientParticipation,
              issuesAndSolutions: prepPack.issuesAndSolutions,
              leadQualityQuestions: prepPack.leadQualityQuestions,
              recapQuestions: prepPack.recapQuestions,
              dataGaps: prepPack.dataGaps,
              integrationSources: prepPack.integrationSources,
              // Client's Book intelligence + recent project chat, pulled live from ClickUp.
              clickupContext: prepPack.clickupContext,
            }
          : null,
      },
      null,
      2,
    ),
  ].join("\n");

  const result = await callLlmForJson({ env, system, userText, maxTokens: 1200 });
  const parsed = callGuideSchema.parse(result.data);
  return { sections: parsed.sections, provider: result.provider, model: result.model };
}

export async function generateLiveCallGuide(context: TenantContext, touchId: string) {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firebase Admin must be configured before the call guide can be generated");
  }

  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }

  const env = getServerEnv();
  const deterministicSections = buildDeterministicSections(touch);

  let callGuide: CallGuide = {
    status: "generated",
    source: "deterministic",
    sections: deterministicSections,
    generatedAt: getNowIso(),
  };

  try {
    const claudeSections = await generateClaudeSections(env, touch);
    if (claudeSections) {
      callGuide = {
        status: "generated",
        source: "claude",
        sections: claudeSections.sections,
        generatedAt: getNowIso(),
        model: claudeSections.model,
        provider: claudeSections.provider,
      };
    }
  } catch (error) {
    callGuide = {
      status: "generated",
      source: "deterministic",
      sections: deterministicSections,
      generatedAt: getNowIso(),
      errorMessage:
        error instanceof Error
          ? error.message
          : "Claude call guide generation failed; used the deterministic fallback instead.",
    };
  }

  const updatedTouch: MonthlyTouchRecord = stripUndefinedDeep({
    ...touch,
    callGuide,
    updatedAt: getNowIso(),
  });

  await db.doc(monthlyTouchPath(context.tenantId, touch.id)).set(updatedTouch, { merge: true });

  return { touch: updatedTouch };
}
