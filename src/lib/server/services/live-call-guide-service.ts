import { z } from "zod";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import type {
  AnticipatedObjection,
  CallGuide,
  CallGuideSection,
  MonthlyTouchRecord,
  ScorecardMetric,
  ValueTranslation,
} from "@/src/lib/mtos-data";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { getServerEnv } from "@/src/lib/server/env";
import { callLlmForJson, getNowIso, hasAnyLlmProvider, stripUndefinedDeep } from "@/src/lib/server/services/mtos-ai";
import { getPromptText, getPromptRecord } from "@/src/lib/server/prompt-store";

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

const objectionsSchema = z.object({
  objections: z
    .array(
      z.object({
        objection: z.string().min(1),
        response: z.string().min(1),
        evidence: z.string().optional(),
      }),
    )
    .max(8),
});

const valueTranslationsSchema = z.object({
  translations: z
    .array(
      z.object({
        metric: z.string().min(1),
        meaning: z.string().min(1),
      }),
    )
    .max(10),
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

  // A full timed run-sheet (sections x talking points x client prompts) is large;
  // 1200 truncated the JSON mid-array, which then fails to parse. Give it headroom.
  const result = await callLlmForJson({ env, system, userText, maxTokens: 6000 });
  const parsed = callGuideSchema.parse(result.data);
  return { sections: parsed.sections, provider: result.provider, model: result.model };
}

/**
 * Best-effort presentation aids that wire three SOP-critical, previously-orphaned
 * Prompt Engine prompts into the live guide:
 *   - objection_handling_prompt          -> anticipated objections + grounded responses
 *   - value_performance_translation_prompt -> plain-language value translations
 *   - michelin_communication_standard_prompt -> tone directive applied to both
 *
 * Every model call is isolated in its own try/catch, so a failure only omits that
 * one aid -- the timed run-sheet built by generateLiveCallGuide is never affected.
 * Uses only evidence from the prep pack; the prompts forbid inventing numbers.
 */
async function generatePresentationAids(
  env: ReturnType<typeof getServerEnv>,
  touch: MonthlyTouchRecord,
): Promise<{ anticipatedObjections?: AnticipatedObjection[]; valueTranslations?: ValueTranslation[] }> {
  if (!hasAnyLlmProvider(env)) {
    return {};
  }

  const prepPack = touch.prepPack;
  const evidence = JSON.stringify(
    {
      clientSummary: prepPack?.clientSummary,
      businessScorecard: prepPack?.businessScorecard,
      wins: touch.wins,
      risks: touch.risks,
      issuesAndSolutions: prepPack?.issuesAndSolutions,
      strategicAction: prepPack?.strategicAction,
      adsPerformance: prepPack?.adsPerformance,
      gbpPerformance: prepPack?.seoPerformance?.gbpPerformance,
    },
    null,
    2,
  );

  // The Michelin standard shapes wording everywhere. Fetch the raw body once and
  // append it as a tone directive (getPromptRecord avoids re-nesting the global
  // preamble that getPromptText would add).
  let toneDirective = "";
  try {
    const michelin = (await getPromptRecord("michelin_communication_standard_prompt"))?.prompt?.trim();
    if (michelin) {
      toneDirective = `\n\nApply this communication standard to the wording of every line you return:\n${michelin}`;
    }
  } catch {
    // Tone is a nicety; never block the aids on it.
  }

  const aids: { anticipatedObjections?: AnticipatedObjection[]; valueTranslations?: ValueTranslation[] } = {};

  try {
    const system = await getPromptText("objection_handling_prompt");
    const userText = [
      "Return a JSON object with a single key: objections.",
      "Each item needs: objection (string), response (string), and optionally evidence (string).",
      "Anticipate the objections THIS client is most likely to raise, grounded only in the evidence below. Do not invent metrics or sources.",
      "",
      evidence,
      toneDirective,
    ].join("\n");
    const res = await callLlmForJson({ env, system, userText, maxTokens: 2000 });
    aids.anticipatedObjections = objectionsSchema.parse(res.data).objections;
  } catch {
    // Best-effort: omit objections on any failure.
  }

  try {
    const system = await getPromptText("value_performance_translation_prompt");
    const userText = [
      "Return a JSON object with a single key: translations.",
      "Each item needs: metric (string, the raw number/deliverable) and meaning (string, what it means for the client's business in plain language).",
      "Translate only the metrics present in the evidence below. Do not invent numbers.",
      "",
      evidence,
      toneDirective,
    ].join("\n");
    const res = await callLlmForJson({ env, system, userText, maxTokens: 2000 });
    aids.valueTranslations = valueTranslationsSchema.parse(res.data).translations;
  } catch {
    // Best-effort: omit translations on any failure.
  }

  return aids;
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

  // Additive, best-effort presentation aids (anticipated objections, value
  // translations, Michelin tone). Runs for both the AI and deterministic guides;
  // any failure simply leaves the fields unset and never blocks the run-sheet.
  try {
    const presentationAids = await generatePresentationAids(env, touch);
    if (presentationAids.anticipatedObjections?.length) {
      callGuide.anticipatedObjections = presentationAids.anticipatedObjections;
    }
    if (presentationAids.valueTranslations?.length) {
      callGuide.valueTranslations = presentationAids.valueTranslations;
    }
  } catch {
    // The aids are additive; the timed guide stands on its own.
  }

  const updatedTouch: MonthlyTouchRecord = stripUndefinedDeep({
    ...touch,
    callGuide,
    updatedAt: getNowIso(),
  });

  await db.doc(monthlyTouchPath(context.tenantId, touch.id)).set(updatedTouch, { merge: true });

  return { touch: updatedTouch };
}
