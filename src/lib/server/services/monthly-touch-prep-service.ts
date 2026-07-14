import { nanoid } from "nanoid";
import { z } from "zod";

import type { IntegrationSnapshotRecord } from "@/src/lib/contracts/integration-sync";
import type { TenantContext } from "@/src/lib/contracts/mtos";
import type {
  AdsPerformancePack,
  BusinessScorecard,
  ClientParticipation,
  ClientRecord,
  CommitmentRecord,
  HeatmapGrid,
  IssueSolutionItem,
  KeywordScanHistory,
  MapCheckinBusinessSummary,
  MonthlyTouchPrepPack,
  MonthlyTouchRecord,
  OpportunityRecord,
  RankTrackerProfileEvidence,
  RecommendationItem,
  ScorecardMetric,
  SeoPerformancePack,
  StrategicActionStatus,
} from "@/src/lib/mtos-data";
import {
  fetchAllBusinesses,
  fetchBusinessKeywordScanHistory,
  fetchCheckinBusinesses,
  fetchHeatmapComparisons,
  openDashboardSession,
} from "@/src/lib/server/services/mapranking-dashboard";
import { namesLikelyMatch } from "@/src/lib/server/name-matching";
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
  gohighlevel: "GoHighLevel",
};

const LEAD_QUALITY_QUESTIONS = [
  "Out of the leads you received, how many were actually relevant?",
  "Were callers generally looking for the right service?",
  "Did you notice wrong locations, price shoppers, or unqualified leads?",
  "Did any of these leads turn into real opportunities or sales?",
  "Walk me through what happens from a new call to a booked job -- who handles it, and how fast?",
  "How transparent is your pricing upfront, and have you had pushback about surprise or unclear costs?",
  "After an estimate, how soon and how often do you follow up, and where do you usually lose the deal?",
];

const RECAP_QUESTIONS = [
  "What happened?",
  "What does it mean?",
  "What are we doing about it?",
  "What do we need from the client?",
  "What is the next step?",
];

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

async function getRawIntegrationSnapshots(tenantId: string) {
  const db = getFirebaseAdminDb();
  const map = new Map<string, JsonRecord>();
  if (!db) {
    return map;
  }

  const snapshot = await db.collection(integrationSnapshotsCollectionPath(tenantId)).get();
  for (const doc of snapshot.docs) {
    const data = doc.data() as IntegrationSnapshotRecord;
    map.set(data.providerId, (data.payload || {}) as JsonRecord);
  }
  return map;
}

function pickString(row: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function pickNumber(row: JsonRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function extractMatchedBusinesses(payload: JsonRecord | undefined, clientId: string) {
  if (!payload) {
    return [];
  }

  const businessesByClient = (payload.businessesByClient || {}) as JsonRecord;
  const matches = Array.isArray(businessesByClient[clientId]) ? (businessesByClient[clientId] as JsonRecord[]) : [];

  return matches.map((row) => ({
    businessId: pickString(row, ["_id", "id"]),
    businessName: pickString(row, ["business_name", "name"]) || "Unnamed business",
    address: pickString(row, ["formatted_address", "address"]),
    rating: pickNumber(row, ["rating"]),
    reviews: pickNumber(row, ["reviews"]),
    placeId: pickString(row, ["place_id"]),
    keywords: Array.from(new Set(Array.isArray(row.keywords) ? (row.keywords as unknown[]).map(String) : [])),
  }));
}

function extractCheckinBusinesses(payload: JsonRecord | undefined, clientId: string): MapCheckinBusinessSummary[] {
  if (!payload) {
    return [];
  }

  const byClient = (payload.checkinBusinessesByClient || {}) as JsonRecord;
  const matches = Array.isArray(byClient[clientId]) ? (byClient[clientId] as JsonRecord[]) : [];

  return matches.map((row) => ({
    businessName: pickString(row, ["business_name"]) || "Unnamed business",
    totalPosts: pickNumber(row, ["totalPosts"]) ?? 0,
    scheduledPosts: pickNumber(row, ["scheduledPosts"]) ?? 0,
    connectedPlatforms: Object.entries((row.integration_status || {}) as Record<string, unknown>)
      .filter(([, connected]) => connected === true)
      .map(([platform]) => platform),
  }));
}

function extractGbpPerformanceRows(payload: JsonRecord | undefined, clientId: string) {
  if (!payload) {
    return [];
  }

  const locationsByClient = (payload.locationsByClient || {}) as JsonRecord;
  const matchedLocations = Array.isArray(locationsByClient[clientId])
    ? (locationsByClient[clientId] as JsonRecord[])
    : [];
  const matchedLocationIds = new Set(
    matchedLocations.map((location) => String(location.name || "").split("/").filter(Boolean).pop()),
  );

  const rows = Array.isArray(payload.performance) ? (payload.performance as JsonRecord[]) : [];
  return rows
    .filter((row) => !row.error && matchedLocationIds.has(String(row.locationId || "")))
    .map((row) => {
      const previous = (row.previous || {}) as JsonRecord;
      return {
        locationId: String(row.locationId || ""),
        periodStart: String(row.periodStart || ""),
        periodEnd: String(row.periodEnd || ""),
        calls: Number(row.calls) || 0,
        websiteClicks: Number(row.websiteClicks) || 0,
        directionRequests: Number(row.directionRequests) || 0,
        searches: Number(row.searches) || 0,
        mapViews: Number(row.mapViews) || 0,
        previous: {
          calls: Number(previous.calls) || 0,
          websiteClicks: Number(previous.websiteClicks) || 0,
          directionRequests: Number(previous.directionRequests) || 0,
          searches: Number(previous.searches) || 0,
          mapViews: Number(previous.mapViews) || 0,
        },
      };
    });
}

function metric(
  label: string,
  value: number | null,
  previousValue: number | null,
  source: string,
  unit: ScorecardMetric["unit"] = "count",
): ScorecardMetric {
  return {
    label,
    value,
    previousValue,
    unit,
    availability: value === null ? "unavailable" : "available",
    source,
  };
}

function latestAndPrevious(scans: KeywordScanHistory["scans"], pick: (scan: KeywordScanHistory["scans"][number]) => number | null) {
  const values = scans.map(pick).filter((value): value is number => value !== null);
  return { latest: values[0] ?? null, previous: values[1] ?? null };
}

function averageAcrossKeywords(
  keywordHistory: KeywordScanHistory[],
  pick: (scan: KeywordScanHistory["scans"][number]) => number | null,
  which: "latest" | "previous",
) {
  const values = keywordHistory
    .map((entry) => latestAndPrevious(entry.scans, pick)[which])
    .filter((value): value is number => value !== null);
  if (!values.length) {
    return null;
  }
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function buildBusinessScorecard(
  rawSnapshots: Map<string, JsonRecord>,
  clientId: string,
  gbpPerformance: ReturnType<typeof extractGbpPerformanceRows>,
  keywordHistory: KeywordScanHistory[],
  checkinBusinesses: MapCheckinBusinessSummary[],
): BusinessScorecard {
  const crmSnapshot = rawSnapshots.get("gohighlevel");
  // Agency-mode sync stores per-client lead data; single-location mode stores workspace totals
  // (which belong to Map Ranking's own sub-account, not any client -- so ignore those).
  const leadsByClient = (crmSnapshot?.leadsByClient || {}) as JsonRecord;
  const crm =
    crmSnapshot?.mode === "agency"
      ? ((leadsByClient[clientId] || null) as JsonRecord | null)
      : null;
  const totalLeads = crm && typeof crm.totalLeads === "number" ? crm.totalLeads : null;
  const qualifiedLeads = crm && typeof crm.qualifiedLeads === "number" ? crm.qualifiedLeads : null;
  const bookedJobs = crm && typeof crm.bookedJobs === "number" ? crm.bookedJobs : null;

  const gbpTotals = gbpPerformance.reduce(
    (acc, row) => ({
      calls: acc.calls + row.calls,
      previousCalls: acc.previousCalls + row.previous.calls,
    }),
    { calls: 0, previousCalls: 0 },
  );

  return {
    totalLeads: metric("New leads (last 30 days)", totalLeads, null, "GoHighLevel contacts"),
    qualifiedLeads: metric("Pipeline opportunities (all time)", qualifiedLeads, null, "GoHighLevel opportunities"),
    costPerLead: metric("Cost per lead", null, null, "Requires Google Ads / Meta Ads sync", "currency"),
    callsAnswered: metric(
      "GBP call clicks",
      gbpPerformance.length ? gbpTotals.calls : null,
      gbpPerformance.length ? gbpTotals.previousCalls : null,
      "Google Business Profile performance",
    ),
    callsMissed: metric("Calls missed", null, null, "Requires CRM call-tracking data"),
    formSubmissions: metric("Form submissions", null, null, "Requires per-source contact breakdown"),
    bookedJobs: metric("Booked jobs (won, all time)", bookedJobs, null, "GoHighLevel won opportunities"),
    shareOfLocalVoice: metric(
      "Market Share (avg across keywords)",
      averageAcrossKeywords(keywordHistory, (scan) => scan.marketSharePercent, "latest"),
      averageAcrossKeywords(keywordHistory, (scan) => scan.marketSharePercent, "previous"),
      "Rank Tracker keyword scans",
      "percent",
    ),
    top3Coverage: metric(
      "Average keyword rank",
      averageAcrossKeywords(keywordHistory, (scan) => scan.averageRank, "latest"),
      averageAcrossKeywords(keywordHistory, (scan) => scan.averageRank, "previous"),
      "Rank Tracker keyword scans",
    ),
    mapCheckIns: metric(
      "Map Check-In posts (all time)",
      checkinBusinesses.length
        ? checkinBusinesses.reduce((sum, business) => sum + business.totalPosts, 0)
        : null,
      null,
      "Map Check-Ins dashboard",
    ),
    hasSalesStructureData: totalLeads !== null && qualifiedLeads !== null,
  };
}

function buildSeoPerformance(
  matchedBusinesses: ReturnType<typeof extractMatchedBusinesses>,
  profiles: RankTrackerProfileEvidence[],
  gbpPerformance: ReturnType<typeof extractGbpPerformanceRows>,
  keywordHistory: KeywordScanHistory[],
  heatmapGrids: HeatmapGrid[],
  checkinBusinesses: MapCheckinBusinessSummary[],
  clientName: string,
): SeoPerformancePack {
  const notes: string[] = [];
  const inactiveProfiles = profiles.filter((profile) => profile.status === "inactive");
  const activeProfiles = profiles.filter((profile) => profile.status === "active");

  if (!matchedBusinesses.length) {
    notes.push(
      `No Rank Tracker business record matched "${clientName}" -- confirm the business name in Rank Tracker matches this client exactly, or check for a typo/suffix mismatch.`,
    );
  } else if (activeProfiles.length > 1) {
    notes.push(
      `${activeProfiles.length} active profiles named "${clientName}" are tracked in Rank Tracker -- each is shown separately below with its own keyword scans and heatmap comparisons.`,
    );
  }
  for (const profile of inactiveProfiles) {
    notes.push(
      `Profile "${profile.business.businessName}" (${profile.business.address || "no address"}) appears SUSPENDED or invisible on Maps: ${profile.statusNote || "no reviews and no grid visibility."}`,
    );
  }
  if (matchedBusinesses.length && !keywordHistory.length && !inactiveProfiles.length) {
    notes.push(
      "The matched Rank Tracker business has no completed keyword scans yet -- ask the SEO team to verify the scan schedule (scans should run 2 days before the touch).",
    );
  }
  if (!gbpPerformance.length) {
    notes.push(
      "No Google Business Profile location matched this client's name, or performance data is unavailable for the matched location -- confirm the GBP listing title matches this client.",
    );
  }
  if (!checkinBusinesses.length) {
    notes.push("No Map Check-Ins business matched this client -- check-ins may not be part of this client's package.");
  }

  return {
    heatmaps: [],
    matchedBusinesses,
    profiles,
    keywordScanHistory: keywordHistory,
    heatmapGrids,
    checkinBusinesses,
    gbpPerformance,
    mapCheckInCount: checkinBusinesses.length
      ? checkinBusinesses.reduce((sum, business) => sum + business.totalPosts, 0)
      : null,
    availability:
      matchedBusinesses.length || gbpPerformance.length || checkinBusinesses.length ? "available" : "unavailable",
    notes,
  };
}

function buildAdsPerformance(): AdsPerformancePack[] {
  return [
    {
      channel: "Google Ads",
      connected: false,
      spend: null,
      leads: null,
      costPerLead: null,
      ctr: null,
      conversionRate: null,
      benchmarkNote:
        "Connect Google Ads to compare CTR and CPL against the 5% CTR / 10% conversion Search benchmark (3% / 3% for PMax) from the Ads prep SOP.",
    },
    {
      channel: "Meta Ads",
      connected: false,
      spend: null,
      leads: null,
      costPerLead: null,
      ctr: null,
      conversionRate: null,
      benchmarkNote: "Connect Meta Ads to review creative performance and CPL once campaigns are active for this client.",
    },
  ];
}

function buildStrategicActionStatus(client: ClientRecord): StrategicActionStatus {
  if (!client.strategicAction) {
    return {
      hasAgreedAction: false,
      title: "",
      agreedAt: "",
      implementationPercent: 0,
      resultsSoFar: "",
      nextSteps:
        "No high-impact action is carried from the last cycle yet -- agree one with the client this touch and record it so next month's prep can report on implementation %.",
    };
  }

  return {
    hasAgreedAction: true,
    title: client.strategicAction.title,
    agreedAt: client.strategicAction.agreedAt,
    implementationPercent: clamp(client.strategicAction.implementationPercent, 0, 100),
    resultsSoFar: client.strategicAction.resultsSoFar,
    nextSteps: client.strategicAction.nextSteps,
  };
}

function buildClientParticipation(client: ClientRecord): ClientParticipation {
  const checklist = client.participationChecklist;
  const items = [
    { label: "Offers / promos provided", inPlace: Boolean(checklist?.offersProvided) },
    { label: "Fresh photos supplied", inPlace: Boolean(checklist?.freshPhotos) },
    { label: "Reviews being requested", inPlace: Boolean(checklist?.reviewsRequested) },
    { label: "Approvals and business updates current", inPlace: Boolean(checklist?.approvalsCurrent) },
    { label: "Current GBP actively supported", inPlace: Boolean(checklist?.gbpSupported) },
  ];
  const gaps = items.filter((item) => !item.inPlace).map((item) => item.label);

  return {
    items,
    basicsReady: Boolean(checklist) && gaps.length === 0,
    gaps: checklist
      ? gaps
      : ["Participation has not been assessed yet -- confirm each item before recommending advanced strategy."],
  };
}

function buildIssuesWithSolutions(
  client: ClientRecord,
  openCommitments: CommitmentRecord[],
): IssueSolutionItem[] {
  const overdue = openCommitments.filter((commitment) => commitment.status === "Overdue");
  const dueDate = client.touchDate || "the next touch";

  const fromOverdue = overdue.map((commitment) => ({
    issue: `Overdue: ${commitment.title}`,
    businessImpact: `This was due ${commitment.dueDate} and is still open, which delays the value the client should already be seeing.`,
    solution: `Confirm the blocker with ${commitment.owner} and commit to a new date live on the call.`,
    owner: commitment.owner,
    dueDate,
  }));

  const fromRisks = client.topRisks
    .filter((risk) => risk && risk.toLowerCase() !== "no major risks surfaced")
    .map((risk) => ({
      issue: risk,
      businessImpact: "Left unaddressed, this directly limits the business outcome the client is paying for.",
      solution: "Bring a specific, named fix to the call rather than surfacing the problem without a plan.",
      owner: "Account Manager",
      dueDate,
    }));

  return [...fromOverdue, ...fromRisks].slice(0, 8);
}

function buildRecapQuestions() {
  return RECAP_QUESTIONS.map((question) => ({ question, answer: "" }));
}

function buildDataGaps(
  seoPerformance: SeoPerformancePack,
  scorecard: BusinessScorecard,
  strategicAction: StrategicActionStatus,
  participation: ClientParticipation,
) {
  const gaps = [...seoPerformance.notes];

  if (scorecard.totalLeads.availability === "unavailable") {
    gaps.push(
      "No per-client GoHighLevel lead data is available -- the current GHL connection is scoped to a single sub-account. Add GOHIGHLEVEL_AGENCY_API_KEY (agency API key or agency private-integration token) and re-sync to pull each client's leads automatically; until then, assess lead volume live using the lead-quality questions below.",
    );
  }
  if (scorecard.costPerLead.availability === "unavailable") {
    gaps.push("No Google Ads / Meta Ads sync is connected -- cost per lead and ROI cannot be shown yet.");
  }
  if (!strategicAction.hasAgreedAction) {
    gaps.push(strategicAction.nextSteps);
  }
  if (!participation.basicsReady) {
    gaps.push(...participation.gaps);
  }

  return unique(gaps);
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
  scorecard: BusinessScorecard,
  seoPerformance: SeoPerformancePack,
  strategicAction: StrategicActionStatus,
  participation: ClientParticipation,
) {
  const overdueCount = openCommitments.filter((commitment) => commitment.status === "Overdue").length;
  const sourceSummary = sources.length
    ? `${sources.length} connected data source${sources.length === 1 ? "" : "s"} contributed evidence to this prep pack.`
    : "No synced integration snapshots are available yet, so this prep pack is using Monthly Touch OS client and workflow data only.";

  const openingParagraph = [
    `${client.name} enters this monthly touch with a health score of ${client.healthScore} and relationship score of ${client.relationshipScore}.`,
    overdueCount
      ? `${overdueCount} overdue commitment${overdueCount === 1 ? "" : "s"} need explicit review before moving into growth planning.`
      : "No overdue commitments are currently blocking the conversation, which creates space for strategy and follow-through.",
    opportunities.length
      ? `${opportunities.length} active growth opportunit${opportunities.length === 1 ? "y is" : "ies are"} available for discussion once the current execution picture is clear.`
      : "The growth portion of the meeting should focus on identifying the next credible expansion path.",
    sourceSummary,
  ].join(" ");

  const scorecardParagraph = scorecard.totalLeads.availability === "available"
    ? `On the business scorecard: ${scorecard.totalLeads.value} new lead${scorecard.totalLeads.value === 1 ? "" : "s"} came in over the last 30 days${scorecard.qualifiedLeads.availability === "available" ? `; the all-time pipeline holds ${scorecard.qualifiedLeads.value} opportunities` : ""}${scorecard.bookedJobs.availability === "available" ? ` with ${scorecard.bookedJobs.value} booked (won) job${scorecard.bookedJobs.value === 1 ? "" : "s"}` : ""}. ${scorecard.callsAnswered.availability === "available" ? `GBP call clicks stand at ${scorecard.callsAnswered.value} (previous period ${scorecard.callsAnswered.previousValue ?? "n/a"}).` : "Call answer/miss data is not connected yet, so phone handling must be assessed live with the client."}`
    : "The business scorecard has no CRM data connected yet -- lead volume, qualified leads, and booked jobs must be gathered live using the lead-quality questions in this pack, per the sales-structure conversation in the SOP.";

  const matchedBusiness = seoPerformance.matchedBusinesses[0];
  const scanSummaries = seoPerformance.keywordScanHistory
    .slice(0, 5)
    .map((entry) => {
      const latest = entry.scans[0];
      const previous = entry.scans[1];
      if (!latest) {
        return "";
      }
      const movement =
        previous && latest.averageRank !== null && previous.averageRank !== null
          ? ` (was ${previous.averageRank})`
          : "";
      return `"${entry.keyword}" avg rank ${latest.averageRank ?? "n/a"}${movement}, Market Share ${latest.marketSharePercent ?? "n/a"}%`;
    })
    .filter(Boolean);

  const seoParagraph = matchedBusiness
    ? `SEO visibility (Rank Tracker, live scans): ${matchedBusiness.businessName} -- ${matchedBusiness.reviews ?? "n/a"} reviews at ${matchedBusiness.rating ?? "n/a"} stars. ${scanSummaries.length ? `Latest keyword scans: ${scanSummaries.join("; ")}. Read Average Rank and Market Share together, and lead with trend over any single snapshot.` : "No completed keyword scans were returned -- verify the scan schedule with the SEO team."}${seoPerformance.gbpPerformance.length ? ` GBP performance: ${seoPerformance.gbpPerformance.reduce((sum, row) => sum + row.calls, 0)} call clicks and ${seoPerformance.gbpPerformance.reduce((sum, row) => sum + row.directionRequests, 0)} direction requests this period.` : ""}${seoPerformance.checkinBusinesses.length ? ` Map Check-Ins: ${seoPerformance.checkinBusinesses.reduce((sum, b) => sum + b.totalPosts, 0)} posts published across connected platforms.` : ""}`
    : `No Rank Tracker business record matched "${client.name}" -- confirm the business name in Rank Tracker matches this client exactly so SEO evidence can be pulled automatically.`;

  const strategicParagraph = strategicAction.hasAgreedAction
    ? `Strategic action: "${strategicAction.title}" (agreed ${strategicAction.agreedAt}) is ${strategicAction.implementationPercent}% implemented. ${strategicAction.resultsSoFar || "Results so far are not yet documented."} Next: ${strategicAction.nextSteps}`
    : strategicAction.nextSteps;

  const participationParagraph = participation.basicsReady
    ? "Client participation basics are in place, so advanced strategy (a new GBP, a new city, bigger spend) is safe to recommend this cycle."
    : `Client participation gap${participation.gaps.length === 1 ? "" : "s"}: ${participation.gaps.join("; ")}. Per the readiness rule, address these before recommending advanced moves.`;

  return [openingParagraph, scorecardParagraph, seoParagraph, strategicParagraph, participationParagraph].join("\n\n");
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
      "The prepPack.businessScorecard, prepPack.seoPerformance, prepPack.strategicAction, and",
      "prepPack.clientParticipation objects hold the SOP-required numbers for this touch (leads, calls,",
      "keyword heatmaps, GBP performance, the agreed strategic action's implementation %, and the",
      "participation-readiness checklist). The executiveBrief must weave these in explicitly by name",
      "and number wherever their availability field is 'available' -- and must say plainly what is",
      "missing (e.g. no CRM connected, no Rank Tracker sync) wherever availability is 'unavailable',",
      "rather than skipping the topic. This is a bachelor-thesis-standard prep document: exhaustive,",
      "specific, and structured -- not a five-sentence summary.",
      "",
      "Return JSON only. Keep the output specific and operational; the executiveBrief may run several",
      "paragraphs if the data supports it.",
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

function isProfileInactive(
  business: ReturnType<typeof extractMatchedBusinesses>[number],
  keywordScans: KeywordScanHistory[],
) {
  const noReviewPresence = (business.rating ?? 0) === 0 && (business.reviews ?? 0) === 0;
  const latestScans = keywordScans
    .map((entry) => entry.scans[0])
    .filter((scan): scan is KeywordScanHistory["scans"][number] => Boolean(scan));
  const noMapPresence =
    latestScans.length > 0 &&
    latestScans.every(
      (scan) => (scan.marketSharePercent ?? 0) === 0 && (scan.averageRank ?? 21) >= 20,
    );

  return noReviewPresence && (noMapPresence || !latestScans.length);
}

async function fetchLiveRankTrackerEvidence(
  context: TenantContext,
  client: ClientRecord,
  snapshotMatches: ReturnType<typeof extractMatchedBusinesses>,
  snapshotCheckins: MapCheckinBusinessSummary[],
) {
  const empty = {
    profiles: [] as RankTrackerProfileEvidence[],
    keywordHistory: [] as KeywordScanHistory[],
    heatmapGrids: [] as HeatmapGrid[],
    checkinBusinesses: snapshotCheckins,
  };

  try {
    const session = await openDashboardSession(context);
    if (!session) {
      return empty;
    }

    // Match live against the current business list so brand-new clients and manual pins take
    // effect immediately -- automatic name matching first, manual pins layered on top.
    const manualIds = new Set(client.integrationMappings?.rankTracker || []);
    const allBusinesses = await fetchAllBusinesses(session);
    let matchedBusinesses: ReturnType<typeof extractMatchedBusinesses> = allBusinesses.filter(
      (business) =>
        namesLikelyMatch(client.name, business.businessName) || manualIds.has(business.businessId),
    );
    if (!matchedBusinesses.length) {
      matchedBusinesses = snapshotMatches;
    }

    // Same live-first approach for Map Check-Ins.
    let checkinBusinesses = snapshotCheckins;
    try {
      const manualCheckinIds = new Set(client.integrationMappings?.mapCheckins || []);
      const allCheckins = await fetchCheckinBusinesses(session);
      const liveCheckins = allCheckins.filter(
        (business) =>
          namesLikelyMatch(client.name, business.businessName) || manualCheckinIds.has(business.businessId),
      );
      if (liveCheckins.length) {
        checkinBusinesses = liveCheckins;
      }
    } catch {
      // keep snapshot fallback
    }

    if (!matchedBusinesses.length) {
      return { ...empty, checkinBusinesses };
    }

    const profiles: RankTrackerProfileEvidence[] = [];
    for (const business of matchedBusinesses.slice(0, 4)) {
      const keywordScans = await fetchBusinessKeywordScanHistory(session, {
        businessId: business.businessId,
        businessName: business.businessName,
      });

      if (isProfileInactive(business, keywordScans)) {
        profiles.push({
          business,
          status: "inactive",
          statusNote:
            "No reviews and no visibility anywhere on the scan grid -- the profile appears suspended, unverified, or brand new. Verify its status in Google Business Profile before the call.",
          keywordScans,
          heatmapComparisons: [],
        });
        continue;
      }

      const heatmapComparisons = await fetchHeatmapComparisons(session, keywordScans);
      profiles.push({
        business,
        status: "active",
        keywordScans,
        heatmapComparisons,
      });
    }

    const activeProfiles = profiles.filter((profile) => profile.status === "active");
    return {
      profiles,
      // Aggregates feed the scorecard and executive brief; only active profiles count.
      keywordHistory: activeProfiles.flatMap((profile) => profile.keywordScans),
      heatmapGrids: activeProfiles.flatMap((profile) =>
        profile.heatmapComparisons.map((comparison) => comparison.current),
      ),
      checkinBusinesses,
    };
  } catch (error) {
    console.warn(
      `Rank Tracker live evidence fetch failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return empty;
  }
}

async function buildPrepPack(
  context: TenantContext,
  client: ClientRecord,
  touch: MonthlyTouchRecord,
  openCommitments: CommitmentRecord[],
  opportunities: OpportunityRecord[],
  integrationSources: MonthlyTouchPrepPack["integrationSources"],
  rawSnapshots: Map<string, JsonRecord>,
) {
  const snapshotMatches = extractMatchedBusinesses(rawSnapshots.get("rank-tracker"), client.id);
  const gbpPerformance = extractGbpPerformanceRows(rawSnapshots.get("google-business-profile"), client.id);
  const snapshotCheckins = extractCheckinBusinesses(rawSnapshots.get("map-checkins"), client.id);
  const { profiles, keywordHistory, heatmapGrids, checkinBusinesses } = await fetchLiveRankTrackerEvidence(
    context,
    client,
    snapshotMatches,
    snapshotCheckins,
  );
  const matchedBusinesses = profiles.length ? profiles.map((profile) => profile.business) : snapshotMatches;

  const businessScorecard = buildBusinessScorecard(
    rawSnapshots,
    client.id,
    gbpPerformance,
    keywordHistory,
    checkinBusinesses,
  );
  const seoPerformance = buildSeoPerformance(
    matchedBusinesses,
    profiles,
    gbpPerformance,
    keywordHistory,
    heatmapGrids,
    checkinBusinesses,
    client.name,
  );
  const adsPerformance = buildAdsPerformance();
  const strategicAction = buildStrategicActionStatus(client);
  const clientParticipation = buildClientParticipation(client);
  const issuesAndSolutions = buildIssuesWithSolutions(client, openCommitments);

  return {
    preparedAt: getNowIso(),
    pipelineVersion: "prep-pack-v3",
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
    businessScorecard,
    seoPerformance,
    adsPerformance,
    strategicAction,
    clientParticipation,
    issuesAndSolutions,
    leadQualityQuestions: LEAD_QUALITY_QUESTIONS,
    recapQuestions: buildRecapQuestions(),
    dataGaps: buildDataGaps(seoPerformance, businessScorecard, strategicAction, clientParticipation),
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

  const [client, commitments, opportunities, integrationSources, rawSnapshots] = await Promise.all([
    dataSource.getClientById(touch.clientId),
    dataSource.getCommitments(touch.clientId),
    dataSource.getOpportunities(touch.clientId),
    getIntegrationSources(context.tenantId),
    getRawIntegrationSnapshots(context.tenantId),
  ]);

  if (!client) {
    throw new Error("Monthly touch client is not visible for the current user");
  }

  const openCommitments = commitments.filter((commitment) => commitment.status !== "Completed");
  const prepPack = await buildPrepPack(
    context,
    client,
    touch,
    openCommitments,
    opportunities,
    integrationSources,
    rawSnapshots,
  );
  const env = getServerEnv();

  let executiveBrief = buildExecutiveBrief(
    client,
    openCommitments,
    opportunities,
    integrationSources,
    prepPack.businessScorecard,
    prepPack.seoPerformance,
    prepPack.strategicAction,
    prepPack.clientParticipation,
  );
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
