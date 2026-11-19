import { CLIENT_CONTENT_RULE, clientCallGuide, clientEvidence } from "@/src/lib/contracts/client-content";
import { z } from "zod";

import { BRIEF_SECTIONS } from "@/src/lib/contracts/prep-brief";
import type { BriefSectionId } from "@/src/lib/contracts/prep-brief";
import { normalizeChips, rankTrackerChip } from "@/src/lib/contracts/brief-sources";
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
import { getModelRouteForPrompt } from "@/src/lib/server/prompt-model-route";
import { getPromptText, getPromptRecord } from "@/src/lib/server/prompt-store";

const BRIEF_SECTION_IDS = BRIEF_SECTIONS.map((section) => section.id) as [BriefSectionId, ...BriefSectionId[]];

/**
 * What a guide part may come back as.
 *
 * The first four keys are required and the rest are not, deliberately: a model that answers
 * with only the timed outline still produces a guide the AM can present, and the live screen
 * falls back to the talking points when the richer fields are absent. Making them required
 * would turn a thin answer into no guide at all, minutes before a call.
 *
 * `max(9)` on the parts rather than the old 7: the handoff's guide runs eight parts, and a
 * ceiling that cuts the close off the end of the call is worse than a long left rail.
 */
const callGuideSchema = z.object({
  sections: z
    .array(
      z.object({
        title: z.string().min(1),
        minutes: z.number().min(1).max(30),
        talkingPoints: z.array(z.string().min(1)).min(1).max(6),
        clientPrompts: z.array(z.string().min(1)).min(1).max(3),
        sectionId: z.enum(BRIEF_SECTION_IDS).optional(),
        goal: z.string().optional(),
        say: z.string().optional(),
        points: z
          .array(
            z.object({
              text: z.string().min(1),
              chips: z.array(z.unknown()).optional(),
            }),
          )
          .max(6)
          .optional(),
        ifSays: z
          .array(z.object({ says: z.string().min(1), response: z.string().min(1) }))
          .max(3)
          .optional(),
        qaChips: z.array(z.string().min(1)).max(3).optional(),
        next: z.string().optional(),
      }),
    )
    .min(4)
    .max(9),
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
  // Period and source stay attached: a number read out on a call without its window
  // or its origin is exactly what the SOP forbids.
  const provenance = [metric.period, metric.source].filter(Boolean).join(", ");
  return `${metric.label}: ${value}${delta}${provenance ? ` — ${provenance}` : ""}`;
}

/**
 * The brief as the AM approved it, or nothing when the review step has not been through.
 *
 * Deliberately silent rather than falling back to the unapproved brief: the guide and the deck are
 * built on the approval, and a deck quietly built from text nobody signed off is the failure the
 * single approval button exists to prevent.
 */

/**
 * The evidence bundle a downstream module reasons over: everything the prep pack
 * gathered plus the touch's own lists. Shared so the timed run-sheet and the
 * client-facing deck are built from exactly the same facts -- if these two drifted
 * apart, the deck and the guide would describe different months.
 */
export function buildTouchEvidence(touch: MonthlyTouchRecord) {
  return clientEvidence(touch);
}

/**
 * Deterministic fallback: builds a timed guide straight from the prep pack so an AM always has a
 * usable, evidence-backed guide even if Claude is unavailable. Real numbers only, nothing invented.
 *
 * Every part names the brief section it presents, which is what lets a section declined after
 * approval drop out of the call. Source chips are attached only where the origin of the line is
 * certain -- the heatmap numbers come from Rank Tracker, the promises carry the chips the brief
 * already recorded -- because a chip that links to the wrong place teaches the AM to ignore all
 * of them, and the scorecard lines already name their own period and source in the text.
 */
function buildDeterministicSections(touch: MonthlyTouchRecord): CallGuideSection[] {
  const prepPack = touch.prepPack;
  const sections: CallGuideSection[] = [];

  // What we promised last time and did not deliver, owned before the client raises it. First,
  // and only when there is something to own: a part that says "nothing outstanding" wastes the
  // opening minutes of the call.
  const completed = [...(prepPack?.completedCommitments || []).map((item) => item.title), ...(touch.prepBrief?.promises || []).filter((item) => item.status === "delivered").map((item) => item.what)];
  if (completed.length) sections.push({ title: "Completed work", minutes: 5, sectionId: "8", talkingPoints: completed, clientPrompts: ["What impact have these results had for your business?"], goal: "Review verified completed work." });

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
    sectionId: "8",
    goal: "Show the month in business terms, then let her react before you explain anything.",
    talkingPoints: scorecardPoints.length
      ? scorecardPoints
      : ["No CRM/ads numbers are connected -- gather them live using the client prompts."],
    clientPrompts: (prepPack?.leadQualityQuestions || []).slice(0, 2).length
      ? (prepPack?.leadQualityQuestions || []).slice(0, 2)
      : ["How many of this month's leads turned into real jobs?"],
    qaChips: ["Wins with business impact", "Preparation and evidence"],
    next: "More calls is only half of it -- next, what the numbers were caused by.",
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
      sectionId: "10",
      goal: "Connect the ranking movement to where her customers actually are.",
      talkingPoints: seoPoints,
      // The scan is the source for every one of these lines, so the chip is certain.
      points: seoPoints.map((text) => ({ text, chips: [rankTrackerChip()] })),
      clientPrompts: ["Are you feeling that visibility change in call volume?"],
      next: "Then the issues, each one with what we are already doing about it.",
    });
  }

  // Strategic action implementation %.
  const strategicAction = prepPack?.strategicAction;
  if (strategicAction && strategicAction.implementationPercent === 100) {
    sections.push({
      title: "Strategic action review",
      minutes: 8,
      sectionId: "12",
      goal: "Confirm the agreed action is still the right one, and agree the next move.",
      qaChips: ["Growth conversation"],
      next: "Then recap, with an owner and a date on everything.",
      talkingPoints: strategicAction.hasAgreedAction
        ? [
            `"${strategicAction.title}" is ${strategicAction.implementationPercent}% implemented.`,
            strategicAction.resultsSoFar || "Results so far are not documented yet.",

          ].filter(Boolean)
        : [],
      clientPrompts: ["Does that next step still line up with your priorities?"],
    });
  }

  // Issues, each already carrying a proposed solution and owner.
  const issuePoints = (prepPack?.issuesAndSolutions || [])
    .slice(0, 3)
    .map((item) => `${item.issue} -- ${item.businessImpact}`);
  const risks = issuePoints.length ? issuePoints : touch.risks.slice(0, 3);
  if (risks.length) {
    sections.push({
      title: "Account performance challenges",
      minutes: 10,
      sectionId: "9",
      goal: "Name every issue yourself, each one arriving with a plan, an owner and a date.",
      talkingPoints: risks,
      clientPrompts: ["Anything else that felt off this month we haven't covered?"],
      ifSays: [
        {
          says: "She asks for a credit or a discount.",
          response: "Do not promise one. Say you will take it to your manager today and come back to her with an answer.",
        },
      ],
      qaChips: ["Risk transparency"],
      next: "Then the wins, and where she wants to grow.",
    });
  }

  // Wins + growth conversation.
  sections.push({
    title: "Wins and growth conversation",
    minutes: 12,
    sectionId: "11",
    goal: "Agree the number this quarter is measured against, and the one growth move worth making.",
    talkingPoints: [...touch.wins.slice(0, 3), ...touch.talkingPoints.slice(0, 2)].filter(Boolean).length
      ? [...touch.wins.slice(0, 3), ...touch.talkingPoints.slice(0, 2)].filter(Boolean)
      : ["Anchor the conversation on measurable business value."],
    clientPrompts: ["Where do you want to grow over the next quarter?"],
    qaChips: ["Growth conversation", "Next-step clarity"],
    next: "One quick thing before we wrap -- the recap.",
  });

  // Recap -- the SOP's five-question close.
  sections.push({
    title: "Recap and close",
    minutes: 6,
    sectionId: "14",
    goal: "Recap verified performance and completed work, then confirm the next meeting.",
    talkingPoints: ["Summarize verified results and completed work."],
    clientPrompts: ["What questions do you have about these results?"],
    ifSays: [
      {
        says: "She cannot commit to a date for the next touch.",
        response: "Offer two options and send the invite for the one she picks before you hang up.",
      },
    ],
    qaChips: ["Next-step clarity", "Commitment clarity"],
    next: "End the call -- MTOS waits for the transcript and opens the follow-through.",
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

  const system = await getPromptText("meeting_structure_run_sheet_prompt", {
    brief_section_ids: BRIEF_SECTION_IDS.join(", "),
  });

  const userText = [
    CLIENT_CONTENT_RULE,
    // Evidence only. The shape of `sections`, the optional per-part fields and the source-chip
    // rules are the engine row's contract, resolved above. BRIEF_SECTION_IDS reaches it as a
    // variable, because the brief's section ids are code the renderer shares.
    JSON.stringify(
      buildTouchEvidence(touch),
      null,
      2,
    ),
  ].join("\n");

  // A full timed run-sheet (sections x talking points x client prompts) is large, and the
  // models think before answering with that thinking charged to this same ceiling. 1200,
  // then 12000, both truncated the JSON mid-array -- most recently at position 10828 on the
  // first touch prepared under the richer MT-002 brief, since the guide is derived from the
  // prep. max_tokens is a ceiling, not a spend: headroom costs nothing unless it is used.
  const result = await callLlmForJson({ env, system, userText, maxTokens: 24000, route: await getModelRouteForPrompt(env, "meeting_structure_run_sheet_prompt") });
  const parsed = callGuideSchema.parse(result.data);
  // The chips arrive as whatever the model wrote. `normalizeChips` keeps the ones that name a
  // system MTOS knows and drops the rest, so an invented source cannot be rendered as a link the
  // AM would trust on the call.
  // `points` is pulled out of the spread rather than overwritten in place: spreading the parsed
  // section would carry its own loose `chips?: unknown[]` into the result type.
  const sections: CallGuideSection[] = parsed.sections.map(({ points, ...section }) => ({
    ...section,
    ...(points
      ? {
          points: points.map((point) => {
            const chips = normalizeChips(point.chips);
            return { text: point.text, ...(chips.length ? { chips } : {}) };
          }),
        }
      : {}),
  }));
  return { sections, provider: result.provider, model: result.model };
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

  const evidence = `${CLIENT_CONTENT_RULE}\n${JSON.stringify(buildTouchEvidence(touch), null, 2)}`;

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
    // Evidence only; the answer's shape is the engine row's contract, resolved above.
    const userText = [
      evidence,
      toneDirective,
    ].join("\n");
    const res = await callLlmForJson({ env, system, userText, maxTokens: 6000, route: await getModelRouteForPrompt(env, "objection_handling_prompt") });
    aids.anticipatedObjections = objectionsSchema.parse(res.data).objections;
  } catch {
    // Best-effort: omit objections on any failure.
  }

  try {
    const system = await getPromptText("value_performance_translation_prompt");
    // Evidence only; the answer's shape is the engine row's contract, resolved above.
    const userText = [
      evidence,
      toneDirective,
    ].join("\n");
    const res = await callLlmForJson({ env, system, userText, maxTokens: 6000, route: await getModelRouteForPrompt(env, "value_performance_translation_prompt") });
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

  const safeGuide = clientCallGuide(callGuide, touch)!;
  if (!safeGuide.sections.length) safeGuide.sections = clientCallGuide({ status: "generated", sections: deterministicSections }, touch)?.sections || [];
  const updatedTouch: MonthlyTouchRecord = stripUndefinedDeep({
    ...touch,
    callGuide: safeGuide,
    updatedAt: getNowIso(),
  });

  await db.doc(monthlyTouchPath(context.tenantId, touch.id)).set(updatedTouch, { merge: true });

  return { touch: updatedTouch };
}
