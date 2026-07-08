import { nanoid } from "nanoid";
import { z } from "zod";

import type { IntegrationSnapshotRecord } from "@/src/lib/contracts/integration-sync";
import type { TenantContext } from "@/src/lib/contracts/mtos";
import type {
  ClientRecord,
  CommitmentRecord,
  MonthlyTouchPrepPack,
  MonthlyTouchRecord,
  OpportunityRecord,
  RecommendationItem,
} from "@/src/lib/mtos-data";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import {
  integrationSnapshotsCollectionPath,
  monthlyTouchPath,
} from "@/src/lib/server/firebase/collections";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { getServerEnv } from "@/src/lib/server/env";
import { callClaudeForJson } from "@/src/lib/server/services/mtos-ai";
import { getPrompt } from "@/src/lib/server/prompt-store";

type JsonRecord = Record<string, unknown>;

interface PrepareMonthlyTouchOptions {
  includeClaude?: boolean;
}

interface ClaudeTouchOutput {
  executiveBrief: string;
  agenda: string[];
  talkingPoints: string[];
  recommendations: RecommendationItem[];
  wins: string[];
  risks: string[];
}

const claudeResponseSchema = z.object({
  executiveBrief: z.string().min(1),
  agenda: z.array(z.string().min(1)).min(4).max(6),
  talkingPoints: z.array(z.string().min(1)).min(3).max(6),
  wins: z.array(z.string().min(1)).min(3).max(8),
  risks: z.array(z.string().min(1)).min(2).max(8),
  recommendations: z
    .array(
      z.object({
        title: z.string().min(1),
        summary: z.string().min(1),
        rationale: z.string().min(1),
        confidence: z.enum(["High", "Medium", "Low"]),
        evidence: z
          .array(
            z.object({
              label: z.string().min(1),
              source: z.string().min(1),
              freshness: z.string().min(1),
            }),
          )
          .min(1)
          .max(3),
      }),
    )
    .min(2)
    .max(4),
});

const providerLabels: Record<string, string> = {
  clickup: "ClickUp",
  "google-calendar": "Google Calendar",
  "google-business-profile": "Google Business Profile",
  "google-search-console": "Google Search Console",
  "rank-tracker": "Rank Tracker",
  "map-checkins": "Map Check-ins",
};

function getNowIso() {
  return new Date().toISOString();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function truncate(value: string, maxLength = 220) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1).trimEnd()}...`;
}

function formatDateTime(value?: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function summarizeSnapshot(snapshot: IntegrationSnapshotRecord) {
  const payload = (snapshot.payload || {}) as JsonRecord;
  const bullets: string[] = [];
  const counts = snapshot.counts;

  if (counts.fetched) {
    bullets.push(`${counts.fetched} records fetched`);
  }
  if (counts.created || counts.updated) {
    bullets.push(`${counts.created + counts.updated} records mapped into MTOS`);
  }

  if (snapshot.providerId === "clickup") {
    const workspace = payload.workspace as { name?: string } | undefined;
    const sampleTasks = Array.isArray(payload.sampleTasks)
      ? (payload.sampleTasks as Array<{ name?: string }>)
      : [];
    if (workspace?.name) {
      bullets.push(`Workspace: ${workspace.name}`);
    }
    if (sampleTasks.length) {
      bullets.push(`Recent task: ${sampleTasks[0]?.name || "Unnamed task"}`);
    }
  }

  if (snapshot.providerId === "google-business-profile") {
    const locations = Array.isArray(payload.locations) ? payload.locations : [];
    if (locations.length) {
      bullets.push(`${locations.length} locations available for reference`);
    }
  }

  if (snapshot.providerId === "google-search-console") {
    const sites = Array.isArray(payload.sites) ? payload.sites : [];
    const analytics = Array.isArray(payload.analytics) ? payload.analytics : [];
    if (sites.length) {
      bullets.push(`${sites.length} verified properties available`);
    }
    if (analytics.length) {
      bullets.push(`${analytics.length} analytics snapshots captured`);
    }
  }

  return {
    providerId: snapshot.providerId,
    label: providerLabels[snapshot.providerId] || snapshot.providerId,
    syncedAt: snapshot.syncedAt,
    summary: snapshot.summary,
    bullets: unique(bullets).slice(0, 3),
  };
}

async function getIntegrationSources(tenantId: string) {
  const db = getFirebaseAdminDb();
  if (!db) {
    return [];
  }

  const snapshot = await db.collection(integrationSnapshotsCollectionPath(tenantId)).get();
  return snapshot.docs
    .map((doc) => doc.data() as IntegrationSnapshotRecord)
    .sort((left, right) => right.syncedAt.localeCompare(left.syncedAt))
    .map(summarizeSnapshot);
}

function buildWins(client: ClientRecord, sources: MonthlyTouchPrepPack["integrationSources"]) {
  const wins = [
    client.relationshipScore >= 80
      ? `Relationship strength remains solid at ${client.relationshipScore}.`
      : "",
    client.healthScore >= 80 ? `Overall account health is stable at ${client.healthScore}.` : "",
    sources.find((source) => source.providerId === "clickup")
      ? "Client context was refreshed from ClickUp before this touch."
      : "",
    client.touchDate ? `The next monthly touch is already mapped to ${client.touchDate}.` : "",
  ];

  return unique(wins).slice(0, 4);
}

function buildRisks(client: ClientRecord, commitments: CommitmentRecord[]) {
  const overdueCommitments = commitments
    .filter((commitment) => commitment.status === "Overdue")
    .map((commitment) => `Overdue commitment: ${commitment.title}`);

  const risks = [...client.topRisks, ...overdueCommitments];
  return unique(risks).slice(0, 5);
}

function buildOpportunities(client: ClientRecord, opportunities: OpportunityRecord[]) {
  const values = [
    ...client.topOpportunities,
    ...opportunities.map((opportunity) => `${opportunity.title} (${opportunity.stage})`),
  ];

  return unique(values).slice(0, 5);
}

function buildCommitmentList(commitments: CommitmentRecord[]) {
  const openCommitments = commitments.filter((commitment) => commitment.status !== "Completed");
  if (!openCommitments.length) {
    return ["No open commitments are currently tracked in MTOS."];
  }

  return openCommitments
    .slice(0, 5)
    .map((commitment) => `${commitment.title} (${commitment.owner}, ${commitment.status}, due ${commitment.dueDate})`);
}

function buildTalkingPoints(
  client: ClientRecord,
  openCommitments: CommitmentRecord[],
  opportunities: OpportunityRecord[],
) {
  const firstCommitment = openCommitments[0];
  const firstOpportunity = opportunities[0];
  const points = [
    client.nextBestAction,
    firstCommitment
      ? `Resolve ${firstCommitment.title.toLowerCase()} and confirm the next owner and due date.`
      : "Confirm there are no hidden blockers before the next reporting cycle.",
    firstOpportunity
      ? `Test readiness for ${firstOpportunity.title} and define the next commercial step.`
      : "Use the meeting to uncover the clearest growth opportunity for the next month.",
    `Anchor the conversation around ${client.contact || "the client contact"} and measurable business value.`,
  ];

  return unique(points).slice(0, 5);
}

function buildAgenda(
  client: ClientRecord,
  openCommitments: CommitmentRecord[],
  opportunities: OpportunityRecord[],
) {
  const agenda = [
    `Open with the account health picture for ${client.name}`,
    openCommitments.length
      ? "Review open commitments, overdue items, and execution blockers"
      : "Confirm completed work and surface new blockers early",
    opportunities.length
      ? "Discuss the strongest active growth opportunity and readiness level"
      : "Explore the most credible growth opportunity for next month",
    "Agree owners, dates, and follow-through before the meeting ends",
  ];

  return unique(agenda);
}

function buildExecutiveBrief(
  client: ClientRecord,
  openCommitments: CommitmentRecord[],
  opportunities: OpportunityRecord[],
  sources: MonthlyTouchPrepPack["integrationSources"],
) {
  const overdueCount = openCommitments.filter((commitment) => commitment.status === "Overdue").length;
  const sourceSummary = sources.length
    ? `${sources.length} connected data source${sources.length === 1 ? "" : "s"} contributed evidence to this prep pack.`
    : "No synced integration snapshots are available yet, so this prep pack is using Monthly Touch OS client and workflow data only.";

  return [
    `${client.name} enters this monthly touch with a health score of ${client.healthScore} and relationship score of ${client.relationshipScore}.`,
    overdueCount
      ? `${overdueCount} overdue commitment${overdueCount === 1 ? "" : "s"} need explicit review before moving into growth planning.`
      : "No overdue commitments are currently blocking the conversation, which creates space for strategy and follow-through.",
    opportunities.length
      ? `${opportunities.length} active growth opportunit${opportunities.length === 1 ? "y is" : "ies are"} available for discussion once the current execution picture is clear.`
      : "The growth portion of the meeting should focus on identifying the next credible expansion path.",
    sourceSummary,
  ].join(" ");
}

function buildKeyFacts(
  client: ClientRecord,
  touch: MonthlyTouchRecord,
  openCommitments: CommitmentRecord[],
  opportunities: OpportunityRecord[],
  sources: MonthlyTouchPrepPack["integrationSources"],
) {
  const scheduledLabel = formatDateTime(touch.scheduledAt);
  return unique([
    `Next touch date: ${client.touchDate || "Not scheduled"}`,
    scheduledLabel ? `Calendar event mapped for ${scheduledLabel}` : "No Google Calendar event is mapped yet",
    `${openCommitments.length} open commitments require review`,
    `${openCommitments.filter((commitment) => commitment.status === "Overdue").length} commitments are overdue`,
    `${opportunities.length} active opportunities are attached to this client`,
    `${sources.length} synced integration sources are available`,
  ]).slice(0, 6);
}

function buildFocusAreas(
  client: ClientRecord,
  openCommitments: CommitmentRecord[],
  opportunities: OpportunityRecord[],
) {
  return unique([
    ...client.topRisks,
    ...openCommitments
      .filter((commitment) => commitment.status === "Overdue")
      .map((commitment) => `Close the loop on ${commitment.title}`),
    ...opportunities.slice(0, 2).map((opportunity) => `Assess readiness for ${opportunity.title}`),
    client.nextBestAction,
  ]).slice(0, 5);
}

function buildDeterministicRecommendations(
  client: ClientRecord,
  openCommitments: CommitmentRecord[],
  opportunities: OpportunityRecord[],
  sources: MonthlyTouchPrepPack["integrationSources"],
) {
  const recommendations: RecommendationItem[] = [];
  const overdueCommitment = openCommitments.find((commitment) => commitment.status === "Overdue");
  const topOpportunity = opportunities[0];

  recommendations.push({
    id: `prep-${nanoid(8)}`,
    title: overdueCommitment ? "Resolve overdue execution first" : "Lead with execution clarity",
    summary: overdueCommitment
      ? `Address ${overdueCommitment.title} early so the client sees ownership before any growth ask.`
      : "Use the first part of the meeting to confirm what was completed, what slipped, and what happens next.",
    rationale:
      "A clean operational review increases trust and makes the rest of the meeting more credible.",
    confidence: overdueCommitment ? "High" : "Medium",
    evidence: [
      {
        label: `${openCommitments.length} open commitments`,
        source: "Monthly Touch OS workflow data",
        freshness: "Prepared just now",
      },
      {
        label: truncate(client.summary),
        source: "Client profile",
        freshness: "Latest synced client context",
      },
    ],
  });

  recommendations.push({
    id: `prep-${nanoid(8)}`,
    title: topOpportunity ? "Convert the clearest growth signal into a decision" : "Create one concrete next-step ask",
    summary: topOpportunity
      ? `Use ${topOpportunity.title} as the main growth conversation and leave with a defined next step.`
      : "If no expansion item is ready, leave the meeting with one measurable experiment or follow-up decision.",
    rationale:
      "Monthly touches are most valuable when they end with an explicit commercial or operational next move.",
    confidence: topOpportunity ? "High" : "Medium",
    evidence: [
      {
        label: topOpportunity ? topOpportunity.title : "No active opportunity attached",
        source: topOpportunity ? "Monthly Touch OS opportunity pipeline" : "Monthly Touch OS preparation bundle",
        freshness: "Prepared just now",
      },
      {
        label: sources[0]?.summary || "No synced external source available",
        source: sources[0]?.label || "Preparation engine",
        freshness: sources[0] ? "Latest integration snapshot" : "Prepared just now",
      },
    ],
  });

  return recommendations;
}

function computeReadinessScore(
  touch: MonthlyTouchRecord,
  openCommitments: CommitmentRecord[],
  opportunities: OpportunityRecord[],
  sources: MonthlyTouchPrepPack["integrationSources"],
  hasClaudeOutput: boolean,
) {
  const score =
    58 +
    Math.min(sources.length * 6, 18) +
    (touch.scheduledAt ? 10 : 0) +
    Math.min(openCommitments.length * 2, 10) +
    Math.min(opportunities.length * 3, 9) +
    (hasClaudeOutput ? 5 : 0);

  return clamp(Math.round(score), 55, 98);
}

function computeConfidenceScore(client: ClientRecord, hasClaudeOutput: boolean) {
  const score = Math.round(client.relationshipScore * 0.65 + client.healthScore * 0.35 + (hasClaudeOutput ? 3 : 0));
  return clamp(score, 55, 98);
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)).filter((item) => item !== undefined) as T;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, nestedValue]) => nestedValue !== undefined)
      .map(([key, nestedValue]) => [key, stripUndefinedDeep(nestedValue)]);
    return Object.fromEntries(entries) as T;
  }

  return value;
}

function extractJsonObject(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return JSON.parse(trimmed) as JsonRecord;
  }

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Claude response did not include a JSON object");
  }

  return JSON.parse(match[0]) as JsonRecord;
}

async function generateClaudeTouchOutput(
  env: ReturnType<typeof getServerEnv>,
  prepPack: MonthlyTouchPrepPack,
  client: ClientRecord,
  touch: MonthlyTouchRecord,
) {
  if (!env.anthropicApiKey) {
    return null;
  }

  const system = await getPrompt(
    "monthly_touch_preparation_prompt",
    [
      "You are preparing an Account Manager for a Growth Touch -- a recurring client meeting whose",
      "purpose is to act as a business growth coach, not a report reader. The AM should never see",
      "information for the first time live on the call; everything they need is in this prep pack.",
      "",
      "Wins: every win must answer 'so what' -- translate the activity into a business outcome",
      "(revenue, leads, calls, visibility, competitive protection, expansion). Never state a",
      "deliverable with no business meaning (bad: 'we posted on GBP'; good: 'a new GBP offer that",
      "increases click-through and signals an active business to Google's algorithm').",
      "Return AT LEAST 3 wins, ordered most business-critical first -- the first 3 get highlighted",
      "to the AM, the rest remain available as the full library, so include every real win you can",
      "support with the data below, not just three.",
      "",
      "Risks: identify problems the AM should raise BEFORE the client does, each with enough context",
      "to explain why it matters and what the recommended next step is. Return AT LEAST 2 risks,",
      "ordered most urgent first -- same highlighted-vs-full-library pattern as wins.",
      "",
      "Use ONLY the preparation bundle provided in the user message. Never invent a metric, a source,",
      "or a client detail that isn't in that bundle -- if there isn't enough evidence for a 3rd win or",
      "a 2nd risk, say so plainly in that item rather than fabricating one.",
      "",
      "Return JSON only. Keep the output concise, specific, and operational.",
    ].join("\n"),
  );

  const parsed = claudeResponseSchema.parse(
    await callClaudeForJson({
      env,
      system,
      userText: [
        "Return a JSON object with keys: executiveBrief, agenda, talkingPoints, wins, risks, recommendations.",
        "Each recommendation must include title, summary, rationale, confidence, and evidence.",
        "Use only the preparation bundle below. Do not invent sources.",
        "",
        JSON.stringify(
          {
            client: {
              name: client.name,
              industry: client.industry,
              contact: client.contact,
              lifecycleStage: client.lifecycleStage,
              healthScore: client.healthScore,
              relationshipScore: client.relationshipScore,
              growthReadiness: client.growthReadiness,
              summary: client.summary,
              topRisks: client.topRisks,
              topOpportunities: client.topOpportunities,
              nextBestAction: client.nextBestAction,
            },
            touch: {
              id: touch.id,
              scheduledAt: touch.scheduledAt || "",
              touchDate: prepPack.schedule.touchDate,
              currentStatus: touch.status,
            },
            prepPack,
          },
          null,
          2,
        ),
      ].join("\n"),
      maxTokens: 1400,
      temperature: 0.2,
    }),
  );

  return {
    executiveBrief: parsed.executiveBrief,
    agenda: unique(parsed.agenda).slice(0, 6),
    talkingPoints: unique(parsed.talkingPoints).slice(0, 6),
    wins: unique(parsed.wins),
    risks: unique(parsed.risks),
    recommendations: parsed.recommendations.map((recommendation) => ({
      id: `claude-${nanoid(8)}`,
      title: recommendation.title,
      summary: recommendation.summary,
      rationale: recommendation.rationale,
      confidence: recommendation.confidence,
      evidence: recommendation.evidence,
    })),
  } satisfies ClaudeTouchOutput;
}

function buildPrepPack(
  client: ClientRecord,
  touch: MonthlyTouchRecord,
  openCommitments: CommitmentRecord[],
  opportunities: OpportunityRecord[],
  integrationSources: MonthlyTouchPrepPack["integrationSources"],
) {
  return {
    preparedAt: getNowIso(),
    pipelineVersion: "prep-pack-v1",
    clientSummary: truncate(client.summary, 320),
    schedule: stripUndefinedDeep({
      touchDate: client.touchDate || "Not scheduled",
      scheduledAt: touch.scheduledAt,
      calendarEventId: touch.calendarEventId,
    }),
    focusAreas: buildFocusAreas(client, openCommitments, opportunities),
    keyFacts: buildKeyFacts(client, touch, openCommitments, opportunities, integrationSources),
    openCommitments: openCommitments.slice(0, 5).map((commitment) => ({
      title: commitment.title,
      owner: commitment.owner,
      dueDate: commitment.dueDate,
      status: commitment.status,
      category: commitment.category,
    })),
    activeOpportunities: opportunities.slice(0, 5).map((opportunity) => ({
      title: opportunity.title,
      stage: opportunity.stage,
      value: opportunity.value,
      readiness: opportunity.readiness,
      nextStep: opportunity.nextStep,
    })),
    integrationSources,
    claude: {
      status: "not_configured",
    },
  } satisfies MonthlyTouchPrepPack;
}

export async function prepareMonthlyTouch(
  context: TenantContext,
  touchId: string,
  options: PrepareMonthlyTouchOptions = {},
) {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firebase Admin must be configured before monthly touch preparation can run");
  }

  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }

  const [client, commitments, opportunities, integrationSources] = await Promise.all([
    dataSource.getClientById(touch.clientId),
    dataSource.getCommitments(touch.clientId),
    dataSource.getOpportunities(touch.clientId),
    getIntegrationSources(context.tenantId),
  ]);

  if (!client) {
    throw new Error("Monthly touch client is not visible for the current user");
  }

  const openCommitments = commitments.filter((commitment) => commitment.status !== "Completed");
  const prepPack = buildPrepPack(client, touch, openCommitments, opportunities, integrationSources);
  const env = getServerEnv();

  let executiveBrief = buildExecutiveBrief(client, openCommitments, opportunities, integrationSources);
  let agenda = buildAgenda(client, openCommitments, opportunities);
  let talkingPoints = buildTalkingPoints(client, openCommitments, opportunities);
  let aiRecommendations = buildDeterministicRecommendations(
    client,
    openCommitments,
    opportunities,
    integrationSources,
  );
  let wins = buildWins(client, integrationSources);
  let risks = buildRisks(client, commitments);
  let claudeState: MonthlyTouchPrepPack["claude"] = {
    status: "not_configured",
  };

  if (options.includeClaude && env.anthropicApiKey) {
    try {
      const claudeOutput = await generateClaudeTouchOutput(env, prepPack, client, touch);
      if (claudeOutput) {
        executiveBrief = claudeOutput.executiveBrief;
        agenda = claudeOutput.agenda;
        talkingPoints = claudeOutput.talkingPoints;
        aiRecommendations = claudeOutput.recommendations;
        wins = claudeOutput.wins;
        risks = claudeOutput.risks;
        claudeState = {
          status: "generated",
          generatedAt: getNowIso(),
          model: env.anthropicModel,
        };
      }
    } catch (error) {
      claudeState = {
        status: "failed",
        generatedAt: getNowIso(),
        model: env.anthropicModel,
        errorMessage: error instanceof Error ? error.message : "Claude generation failed",
      };
    }
  }

  const derivedOpportunities = buildOpportunities(client, opportunities);
  const derivedCommitments = buildCommitmentList(commitments);
  const hasClaudeOutput = claudeState.status === "generated";

  const updatedTouch: MonthlyTouchRecord = stripUndefinedDeep({
    ...touch,
    status: touch.status === "Live" || touch.status === "Completed" ? touch.status : "Ready",
    readinessScore: computeReadinessScore(touch, openCommitments, opportunities, integrationSources, hasClaudeOutput),
    confidenceScore: computeConfidenceScore(client, hasClaudeOutput),
    executiveBrief,
    agenda,
    wins: wins.length ? wins : touch.wins,
    risks: risks.length ? risks : touch.risks,
    opportunities: derivedOpportunities.length ? derivedOpportunities : touch.opportunities,
    talkingPoints,
    commitments: derivedCommitments,
    aiRecommendations,
    prepPack: {
      ...prepPack,
      claude: claudeState,
    },
    updatedAt: getNowIso(),
  });

  await db.doc(monthlyTouchPath(context.tenantId, touch.id)).set(updatedTouch, { merge: true });

  return {
    touch: updatedTouch,
    prepPack: updatedTouch.prepPack,
  };
}
