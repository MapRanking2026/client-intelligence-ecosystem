import { RecommendationType, RecommendationV1 } from "@/src/lib/domain/recommendation";
import { newId, nowIso } from "@/src/lib/ids";
import { getProject } from "@/src/lib/server/projects-service";
import { getPerformanceSnapshotRepo } from "@/src/lib/server/repositories/performance-snapshot-repo";
import { getRecommendationRepo } from "@/src/lib/server/repositories/recommendation-repo";
import { AiNotConfiguredError, extractJson, generateText } from "@/src/lib/server/ai/llm";
import { hasAiConfig } from "@/src/lib/server/env";
import { findForNiche } from "@/src/lib/server/niche-studies-service";
import { getEffectivePrompt } from "@/src/lib/server/prompts-service";
import { buildStyleDirective } from "@/src/lib/server/specialist-style-service";
import { listSpecialists } from "@/src/lib/server/specialists-service";
import { effectiveSpecialistId } from "@/src/lib/server/projects-service";

const TYPES = RecommendationType.options;

interface AiRec {
  type?: string;
  title?: string;
  rationale?: string;
  clientSafeExplanation?: string;
  changeExplanation?: string;
  expectedImpact?: string;
  confidence?: string;
  estimatedEffort?: string;
  risks?: string[];
}

function buildUserPrompt(input: {
  businessName: string;
  website?: string;
  niche?: string;
  valueProposition?: string;
  targetLocations: string[];
  avgRank: number | null;
  avgShare: number | null;
  grids: Array<{ keyword: string; rank: number | null; share: number | null; top3: number | null }>;
  keywords: string[];
  checkinBusinessCount: number;
  checkinTotalPosts: number;
  nichePlaybooks: string;
}): string {
  const allowed = TYPES.join(", ");
  return [
    `Business: ${input.businessName}`,
    input.website ? `Website: ${input.website}` : "",
    input.niche ? `Niche: ${input.niche}` : "",
    input.valueProposition ? `Value proposition: ${input.valueProposition}` : "",
    input.targetLocations.length ? `Target locations: ${input.targetLocations.join(", ")}` : "",
    `Average map-grid rank: ${input.avgRank ?? "n/a"}`,
    `Average share of local voice: ${input.avgShare != null ? input.avgShare + "%" : "n/a"}`,
    `Check-ins: ${input.checkinBusinessCount} business(es), ${input.checkinTotalPosts} post(s)`,
    "Per-keyword grid data (keyword | avgRank | share% | top3%):",
    ...input.grids.slice(0, 25).map(
      (g) => `- ${g.keyword} | ${g.rank ?? "n/a"} | ${g.share ?? "n/a"} | ${g.top3 ?? "n/a"}`,
    ),
    input.keywords.length ? `Tracked keywords: ${input.keywords.slice(0, 40).join(", ")}` : "",
    input.nichePlaybooks ? `\nNiche playbooks (apply these proven tactics):\n${input.nichePlaybooks}` : "",
    "",
    `Propose 5-8 recommendations. Each "type" MUST be one of: ${allowed}.`,
    'Return JSON: {"recommendations":[{"type","title","rationale","clientSafeExplanation",',
    '"changeExplanation","expectedImpact":"low|medium|high","confidence":"low|medium|high",',
    '"estimatedEffort":"s|m|l","risks":[]}]}.',
    'Use "changeExplanation" only when the action changes something the client already has',
    "(e.g. switching a primary GBP category/service) — explain the change in plain client language.",
  ]
    .filter(Boolean)
    .join("\n");
}

function coerceType(raw?: string): RecommendationType {
  const t = (raw ?? "").trim().toLowerCase().replace(/[^a-z_]/g, "");
  return (TYPES as readonly string[]).includes(t) ? (t as RecommendationType) : "data_quality";
}
function coerceEnum<T extends string>(raw: string | undefined, allowed: readonly T[], fallback: T): T {
  const v = (raw ?? "").trim().toLowerCase();
  return (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export interface AiGenResult {
  ok: boolean;
  created: number;
  error?: string;
}

/**
 * Generate AI recommendations for a project from its latest performance
 * snapshot + intake context. Results land as "proposed", requiresApproval —
 * a specialist still decides. No external side effects. Returns a clear error
 * (never fabricated recs) when AI or data is missing.
 */
export async function generateAiRecommendations(
  tenantId: string,
  projectId: string,
): Promise<AiGenResult> {
  if (!hasAiConfig()) {
    return { ok: false, created: 0, error: "AI is not configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY on SEOOS)." };
  }
  const project = await getProject(tenantId, projectId);
  if (!project) return { ok: false, created: 0, error: "Project not found" };

  const snapshot = await getPerformanceSnapshotRepo().get(tenantId, projectId);
  if (!snapshot || (!snapshot.grids.length && !snapshot.keywords.length)) {
    return { ok: false, created: 0, error: "No performance data yet — run Sync all sources on this client first." };
  }

  const rankVals = snapshot.grids.map((g) => g.averageRankPosition).filter((v): v is number => v != null);
  const shareVals = snapshot.grids.map((g) => g.shareOfLocalVoicePercent).filter((v): v is number => v != null);
  const avgRank = rankVals.length ? Math.round((rankVals.reduce((a, b) => a + b, 0) / rankVals.length) * 10) / 10 : null;
  const avgShare = shareVals.length ? Math.round((shareVals.reduce((a, b) => a + b, 0) / shareVals.length) * 10) / 10 : null;

  const studies = await findForNiche(tenantId, project.niche);
  const nichePlaybooks = studies
    .map((s) => `- ${s.title}: ${s.content.replace(/\s+/g, " ").slice(0, 1200)}`)
    .join("\n");

  const user = buildUserPrompt({
    businessName: project.businessName,
    website: project.website,
    niche: project.niche,
    valueProposition: project.valueProposition,
    targetLocations: project.targetLocations ?? [],
    avgRank,
    avgShare,
    grids: snapshot.grids.map((g) => ({
      keyword: g.keyword,
      rank: g.averageRankPosition,
      share: g.shareOfLocalVoicePercent,
      top3: g.top3Percent,
    })),
    keywords: snapshot.keywords.map((k) => k.keyword),
    checkinBusinessCount: snapshot.checkinBusinessCount,
    checkinTotalPosts: snapshot.checkinTotalPosts,
    nichePlaybooks,
  });

  // System instruction = the admin-editable prompt for this action + the
  // account specialist's style directive (always applied).
  const promptTemplate = await getEffectivePrompt(tenantId, "recommendations.generate");
  const specialists = await listSpecialists(tenantId);
  const specialistId = effectiveSpecialistId(project, specialists);
  const specialistName = specialists.find((s) => s.id === specialistId)?.name;
  const styleDirective = await buildStyleDirective(tenantId, specialistId, specialistName);
  const system = `${promptTemplate}\n\n${styleDirective}`;

  let parsed: { recommendations?: AiRec[] };
  try {
    const text = await generateText(system, user);
    parsed = extractJson<{ recommendations?: AiRec[] }>(text);
  } catch (e) {
    if (e instanceof AiNotConfiguredError) return { ok: false, created: 0, error: e.message };
    return { ok: false, created: 0, error: e instanceof Error ? e.message : "ai_failed" };
  }

  const items = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
  if (!items.length) return { ok: false, created: 0, error: "AI returned no recommendations." };

  const repo = getRecommendationRepo();
  let created = 0;
  for (const item of items) {
    if (!item.title || !item.rationale) continue;
    const now = nowIso();
    const rec = RecommendationV1.parse({
      schemaVersion: 1,
      id: newId("rec"),
      tenantId,
      projectId,
      clientId: project.clientId,
      type: coerceType(item.type),
      title: item.title.slice(0, 200),
      rationale: item.rationale,
      clientSafeExplanation: item.clientSafeExplanation,
      changeExplanation: item.changeExplanation,
      evidence: [
        {
          schemaVersion: 1,
          id: newId("ev"),
          sourceProvider: "rank-tracker",
          freshness: "cached",
          confidence: "medium",
          redactionLevel: "aggregate",
          lineage: [{ source: "rank-tracker", detail: `snapshot ${snapshot.generatedAt}` }],
        },
      ],
      expectedImpact: coerceEnum(item.expectedImpact, ["low", "medium", "high"] as const, "medium"),
      confidence: coerceEnum(item.confidence, ["low", "medium", "high"] as const, "medium"),
      estimatedEffort: coerceEnum(item.estimatedEffort, ["s", "m", "l"] as const, "m"),
      risks: Array.isArray(item.risks) ? item.risks.filter((r) => typeof r === "string") : [],
      requiresApproval: true,
      status: "proposed",
      source: "ai",
      createdAt: now,
      updatedAt: now,
    });
    await repo.save(rec);
    created += 1;
  }

  return { ok: true, created };
}
