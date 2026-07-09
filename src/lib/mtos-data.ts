export type Confidence = "High" | "Medium" | "Low";
export type HealthTone = "excellent" | "healthy" | "needs_attention" | "at_risk" | "critical";

export interface EvidenceItem {
  label: string;
  source: string;
  freshness: string;
}

export interface RecommendationItem {
  id: string;
  title: string;
  summary: string;
  rationale: string;
  confidence: Confidence;
  evidence: EvidenceItem[];
}

export interface PrepPackSourceItem {
  providerId: string;
  label: string;
  syncedAt: string;
  summary: string;
  bullets: string[];
}

export interface PrepPackCommitmentItem {
  title: string;
  owner: string;
  dueDate: string;
  status: string;
  category: string;
}

export interface PrepPackOpportunityItem {
  title: string;
  stage: string;
  value: string;
  readiness: string;
  nextStep: string;
}

export interface PrepPackClaudeState {
  status: "generated" | "not_configured" | "failed";
  generatedAt?: string;
  model?: string;
  errorMessage?: string;
}

export type MetricAvailability = "available" | "unavailable";

export interface ScorecardMetric {
  label: string;
  value: number | null;
  previousValue: number | null;
  unit?: "count" | "currency" | "percent";
  availability: MetricAvailability;
  source: string;
}

export interface BusinessScorecard {
  totalLeads: ScorecardMetric;
  qualifiedLeads: ScorecardMetric;
  costPerLead: ScorecardMetric;
  callsAnswered: ScorecardMetric;
  callsMissed: ScorecardMetric;
  formSubmissions: ScorecardMetric;
  bookedJobs: ScorecardMetric;
  shareOfLocalVoice: ScorecardMetric;
  top3Coverage: ScorecardMetric;
  mapCheckIns: ScorecardMetric;
  hasSalesStructureData: boolean;
}

export interface SeoHeatmapRow {
  keyword: string;
  location: string;
  scanDate: string;
  averageRanking: number | null;
  mapPackPercent: number | null;
  marketShare: number | null;
  trend: "up" | "down" | "flat" | "unknown";
  imageUrl: string;
}

export interface GbpPerformanceSnapshot {
  locationId: string;
  periodStart: string;
  periodEnd: string;
  calls: number;
  websiteClicks: number;
  directionRequests: number;
  searches: number;
  mapViews: number;
  previous: {
    calls: number;
    websiteClicks: number;
    directionRequests: number;
    searches: number;
    mapViews: number;
  };
}

export interface MatchedRankTrackerBusiness {
  businessId: string;
  businessName: string;
  address: string;
  rating: number | null;
  reviews: number | null;
  placeId: string;
  keywords: string[];
}

export interface KeywordScanPoint {
  scanDate: string;
  averageRank: number | null;
  top3Pins: number | null;
  marketSharePercent: number | null;
  notRankingPins: number | null;
  reportId: string;
}

export interface KeywordScanHistory {
  keyword: string;
  businessName: string;
  scans: KeywordScanPoint[];
}

export interface HeatmapPin {
  lat: number;
  lng: number;
  rank: number | null;
}

export interface HeatmapCompetitor {
  name: string;
  rating: number | null;
  reviews: number | null;
}

export interface HeatmapGrid {
  keyword: string;
  scanDate: string;
  gridSize: number;
  averageRankPosition: number | null;
  shareOfLocalVoicePercent: number | null;
  top3Percent: number | null;
  pins: HeatmapPin[];
  topCompetitors: HeatmapCompetitor[];
}

export interface MapCheckinBusinessSummary {
  businessName: string;
  totalPosts: number;
  scheduledPosts: number;
  connectedPlatforms: string[];
}

export interface SeoPerformancePack {
  heatmaps: SeoHeatmapRow[];
  matchedBusinesses: MatchedRankTrackerBusiness[];
  keywordScanHistory: KeywordScanHistory[];
  heatmapGrids: HeatmapGrid[];
  checkinBusinesses: MapCheckinBusinessSummary[];
  gbpPerformance: GbpPerformanceSnapshot[];
  mapCheckInCount: number | null;
  availability: MetricAvailability;
  notes: string[];
}

export interface AdsPerformancePack {
  channel: "Google Ads" | "Meta Ads";
  connected: boolean;
  spend: number | null;
  leads: number | null;
  costPerLead: number | null;
  ctr: number | null;
  conversionRate: number | null;
  benchmarkNote: string;
}

export interface StrategicActionStatus {
  hasAgreedAction: boolean;
  title: string;
  agreedAt: string;
  implementationPercent: number;
  resultsSoFar: string;
  nextSteps: string;
}

export interface ParticipationChecklistItem {
  label: string;
  inPlace: boolean;
}

export interface ClientParticipation {
  items: ParticipationChecklistItem[];
  basicsReady: boolean;
  gaps: string[];
}

export interface IssueSolutionItem {
  issue: string;
  businessImpact: string;
  solution: string;
  owner: string;
  dueDate: string;
}

export interface MonthlyTouchPrepPack {
  preparedAt: string;
  pipelineVersion: string;
  clientSummary: string;
  schedule: {
    touchDate: string;
    scheduledAt?: string;
    calendarEventId?: string;
  };
  focusAreas: string[];
  keyFacts: string[];
  openCommitments: PrepPackCommitmentItem[];
  activeOpportunities: PrepPackOpportunityItem[];
  integrationSources: PrepPackSourceItem[];
  businessScorecard: BusinessScorecard;
  seoPerformance: SeoPerformancePack;
  adsPerformance: AdsPerformancePack[];
  strategicAction: StrategicActionStatus;
  clientParticipation: ClientParticipation;
  issuesAndSolutions: IssueSolutionItem[];
  leadQualityQuestions: string[];
  recapQuestions: { question: string; answer: string }[];
  dataGaps: string[];
  claude: PrepPackClaudeState;
}

export interface ClientRecord {
  id: string;
  name: string;
  industry: string;
  contact: string;
  lifecycleStage: string;
  touchId: string;
  touchDate: string;
  healthScore: number;
  relationshipScore: number;
  growthReadiness: number;
  tone: HealthTone;
  summary: string;
  topRisks: string[];
  topOpportunities: string[];
  commitmentsOpen: number;
  nextBestAction: string;
  clickupTaskId?: string;
  accountManager?: string;
  location?: string;
  sentiment?: string;
  tenure?: string;
  mrr?: string;
  riskNote?: string;
  contextNotes?: string;
  churnSignals?: string[];
  goals?: string[];
  syncSource?: "clickup";
  sourceUpdatedAt?: string;
  rawPayload?: Record<string, unknown>;
  strategicAction?: {
    title: string;
    agreedAt: string;
    implementationPercent: number;
    resultsSoFar: string;
    nextSteps: string;
  };
  participationChecklist?: {
    offersProvided: boolean;
    freshPhotos: boolean;
    reviewsRequested: boolean;
    approvalsCurrent: boolean;
    gbpSupported: boolean;
  };
}

export interface CommitmentRecord {
  id: string;
  clientId: string;
  title: string;
  owner: string;
  dueDate: string;
  status: "Open" | "In Progress" | "Completed" | "Overdue";
  category: "Client" | "Map Ranking" | "Internal";
  sourceMeeting: string;
}

export interface OpportunityRecord {
  id: string;
  clientId: string;
  title: string;
  stage: "Signal" | "Qualified" | "Proposal" | "Active";
  value: string;
  readiness: string;
  nextStep: string;
}

export interface CallGuideSection {
  title: string;
  minutes: number;
  talkingPoints: string[];
  clientPrompts: string[];
}

export interface CallGuide {
  status: "not_generated" | "generated";
  source?: "claude" | "deterministic";
  sections: CallGuideSection[];
  generatedAt?: string;
  model?: string;
  errorMessage?: string;
}

export type TicketDepartment = "SEO" | "Web Design" | "Ads" | "Account Manager" | "Other";

export interface DraftTicket {
  id: string;
  title: string;
  description: string;
  department: TicketDepartment;
  status: "pending" | "approved" | "declined";
  clickupTaskId?: string;
  clickupTaskUrl?: string;
  executionNote?: string;
}

export interface ClientEmailDraft {
  subject: string;
  body: string;
  status: "pending" | "approved";
}

export interface PostMeetingReview {
  status: "not_started" | "draft_ready" | "approved";
  transcript?: string;
  recapSummary?: string;
  extractedCommitments?: string[];
  draftTickets?: DraftTicket[];
  clientEmail?: ClientEmailDraft;
  analyzedAt?: string;
  model?: string;
  errorMessage?: string;
}

export interface QaScorecardCategory {
  category: string;
  score: number;
  notes: string;
}

export interface QaReview {
  status: "not_started" | "pending_victor_approval" | "approved" | "changes_requested";
  scorecard?: QaScorecardCategory[];
  overallGrade?: string;
  summary?: string;
  generatedAt?: string;
  victorDecisionAt?: string;
  victorNote?: string;
  errorMessage?: string;
}

export interface MonthlyTouchRecord {
  id: string;
  clientId: string;
  status: "Preparing" | "Ready" | "Live" | "Completed";
  readinessScore: number;
  confidenceScore: number;
  scheduledAt?: string;
  calendarEventId?: string;
  updatedAt?: string;
  executiveBrief: string;
  agenda: string[];
  wins: string[];
  risks: string[];
  opportunities: string[];
  talkingPoints: string[];
  commitments: string[];
  aiRecommendations: RecommendationItem[];
  prepPack?: MonthlyTouchPrepPack;
  callGuide?: CallGuide;
  postMeeting?: PostMeetingReview;
  qaReview?: QaReview;
}

const clients: ClientRecord[] = [
  {
    id: "oakline-dental",
    name: "Oakline Dental Group",
    industry: "Dental",
    contact: "Dr. Maya Brooks",
    lifecycleStage: "Growth",
    touchId: "touch-oakline-july",
    touchDate: "Jul 03, 2026",
    healthScore: 86,
    relationshipScore: 91,
    growthReadiness: 88,
    tone: "healthy",
    summary:
      "Strong relationship momentum with visible SEO and GBP gains, but lead handling speed is creating conversion drag.",
    topRisks: ["Slow call-back speed", "Unresolved website form issue"],
    topOpportunities: ["AI Visibility expansion", "Second-location ads pilot"],
    commitmentsOpen: 4,
    nextBestAction: "Finalize the executive brief and confirm the second-location growth conversation.",
  },
  {
    id: "northpeak-roofing",
    name: "NorthPeak Roofing",
    industry: "Roofing",
    contact: "Evan Porter",
    lifecycleStage: "Recovery",
    touchId: "touch-northpeak-july",
    touchDate: "Jul 05, 2026",
    healthScore: 64,
    relationshipScore: 58,
    growthReadiness: 46,
    tone: "needs_attention",
    summary:
      "Pipeline quality is uneven and trust has softened after delayed website fixes. The next meeting must re-establish clarity and accountability.",
    topRisks: ["Expectation misalignment", "Aging deliverables", "Competitive pressure"],
    topOpportunities: ["Review generation push", "Territory expansion education"],
    commitmentsOpen: 6,
    nextBestAction: "Rebuild confidence with a transparent action plan and overdue commitment review.",
  },
  {
    id: "sable-family-law",
    name: "Sable Family Law",
    industry: "Legal",
    contact: "Alicia Kent",
    lifecycleStage: "Healthy",
    touchId: "touch-sable-july",
    touchDate: "Jul 07, 2026",
    healthScore: 92,
    relationshipScore: 95,
    growthReadiness: 81,
    tone: "excellent",
    summary:
      "Excellent relationship strength, strong review growth, and clear proof of value. The meeting should focus on expansion timing and premium positioning.",
    topRisks: ["No major risks surfaced"],
    topOpportunities: ["Premium content package", "Practice-area landing pages"],
    commitmentsOpen: 2,
    nextBestAction: "Lead with measurable wins and transition into expansion readiness.",
  },
];

const commitments: CommitmentRecord[] = [
  {
    id: "com-1",
    clientId: "oakline-dental",
    title: "Publish updated implant consultation landing page",
    owner: "Website Team",
    dueDate: "Jul 02, 2026",
    status: "In Progress",
    category: "Map Ranking",
    sourceMeeting: "June Monthly Touch",
  },
  {
    id: "com-2",
    clientId: "oakline-dental",
    title: "Client to confirm second-location intake workflow",
    owner: "Client",
    dueDate: "Jul 01, 2026",
    status: "Open",
    category: "Client",
    sourceMeeting: "June Monthly Touch",
  },
  {
    id: "com-3",
    clientId: "northpeak-roofing",
    title: "Resolve mobile quote-form delivery bug",
    owner: "Engineering",
    dueDate: "Jun 29, 2026",
    status: "Overdue",
    category: "Internal",
    sourceMeeting: "June Monthly Touch",
  },
  {
    id: "com-4",
    clientId: "northpeak-roofing",
    title: "Share Q3 storm-season offer sheet",
    owner: "Account Manager",
    dueDate: "Jul 04, 2026",
    status: "Open",
    category: "Map Ranking",
    sourceMeeting: "June Monthly Touch",
  },
  {
    id: "com-5",
    clientId: "sable-family-law",
    title: "Approve revised intake FAQ copy",
    owner: "Client",
    dueDate: "Jul 06, 2026",
    status: "Open",
    category: "Client",
    sourceMeeting: "June Monthly Touch",
  },
];

const opportunities: OpportunityRecord[] = [
  {
    id: "opp-1",
    clientId: "oakline-dental",
    title: "AI Visibility package for implant services",
    stage: "Qualified",
    value: "$2.4k MRR",
    readiness: "High",
    nextStep: "Position during the growth-opportunity agenda section.",
  },
  {
    id: "opp-2",
    clientId: "northpeak-roofing",
    title: "Review generation campaign reset",
    stage: "Signal",
    value: "$900 setup",
    readiness: "Medium",
    nextStep: "Frame as trust-recovery support instead of upsell.",
  },
  {
    id: "opp-3",
    clientId: "sable-family-law",
    title: "Practice-area landing page expansion",
    stage: "Proposal",
    value: "$1.8k MRR",
    readiness: "High",
    nextStep: "Review projected conversion upside and timeline.",
  },
];

const monthlyTouches: MonthlyTouchRecord[] = [
  {
    id: "touch-oakline-july",
    clientId: "oakline-dental",
    status: "Ready",
    readinessScore: 94,
    confidenceScore: 92,
    executiveBrief:
      "Oakline is in a strong position heading into July. Local visibility and branded demand are rising, but conversion friction from slow call-back speed and a form-delivery issue is suppressing lead value. The meeting should connect operational fixes to business growth while introducing the AI Visibility expansion opportunity.",
    agenda: [
      "Wins and business growth summary",
      "Lead handling bottlenecks and conversion drag",
      "Roadmap progress and unresolved website issue",
      "AI Visibility and second-location growth plan",
      "Action items, owners, and next review date",
    ],
    wins: [
      "GBP calls increased 18% month over month",
      "Implant consultation pages now rank in the local top pack",
      "Review response time improved from 48h to 12h",
    ],
    risks: [
      "Call-back delay above target for high-intent leads",
      "Contact form issue still unresolved for mobile visitors",
    ],
    opportunities: [
      "AI Visibility pilot for implant services",
      "Second-location Google Ads launch planning",
      "Client education around intake script optimization",
    ],
    talkingPoints: [
      "Translate visibility gains into booked-consultation potential",
      "Show how response speed affects value capture",
      "Frame AI Visibility as a demand-defense layer, not a trendy add-on",
    ],
    commitments: [
      "Confirm mobile-form fix owner and date",
      "Agree on second-location discovery inputs",
      "Document updated call-back SLA",
    ],
    aiRecommendations: [
      {
        id: "oakline-rec-1",
        title: "Lead with conversion clarity before expansion",
        summary: "Address the call-back bottleneck before discussing new acquisition spend.",
        rationale:
          "The client is seeing stronger demand. Solving lead handling first increases trust and protects ROI before a larger growth ask.",
        confidence: "High",
        evidence: [
          { label: "Lead response report", source: "CRM", freshness: "Updated 3h ago" },
          { label: "GBP call trend", source: "Google Business Profile", freshness: "Updated today" },
        ],
      },
      {
        id: "oakline-rec-2",
        title: "Position AI Visibility as market protection",
        summary: "Connect AI Visibility to branded authority and competitor pressure.",
        rationale:
          "The client is already winning on core local search. The next strategic conversation should protect share of voice before competitors close the gap.",
        confidence: "Medium",
        evidence: [
          { label: "AI citation visibility notes", source: "AI Visibility", freshness: "Updated yesterday" },
          { label: "Competitor comparison", source: "GeoGrid", freshness: "Updated 2 days ago" },
        ],
      },
    ],
  },
  {
    id: "touch-northpeak-july",
    clientId: "northpeak-roofing",
    status: "Preparing",
    readinessScore: 71,
    confidenceScore: 63,
    executiveBrief:
      "NorthPeak requires a high-transparency meeting. The client has softening confidence due to delayed execution and unclear value communication. The conversation should reset expectations, account for overdue work, and avoid aggressive expansion pressure.",
    agenda: [
      "Transparent review of overdue items",
      "Current performance and lead-quality context",
      "Roadmap recovery plan",
      "Trust-building follow-through commitments",
    ],
    wins: ["Review rating stabilized at 4.8", "Organic service-page visibility improved"],
    risks: ["Website fixes are delayed", "Lead-quality objections remain unresolved"],
    opportunities: ["Review generation reset", "Territory education sequence"],
    talkingPoints: [
      "Own the delay directly and show a recovery timeline",
      "Distinguish lead quality from close-rate and response speed",
      "Do not introduce aggressive upsell pressure this month",
    ],
    commitments: ["Publish recovery plan", "Confirm QA review of previous meeting"],
    aiRecommendations: [
      {
        id: "northpeak-rec-1",
        title: "Re-establish trust before proposing growth",
        summary: "Use the first half of the meeting to restore clarity and accountability.",
        rationale:
          "Relationship health is below target and unresolved operational issues are creating skepticism.",
        confidence: "High",
        evidence: [
          { label: "Relationship trend notes", source: "Meeting history", freshness: "Updated yesterday" },
          { label: "Open deliverables", source: "ClickUp", freshness: "Updated today" },
        ],
      },
    ],
  },
  {
    id: "touch-sable-july",
    clientId: "sable-family-law",
    status: "Ready",
    readinessScore: 96,
    confidenceScore: 95,
    executiveBrief:
      "Sable enters the July touch from a position of trust and measurable performance strength. The meeting should reinforce proof of value, confirm premium positioning readiness, and align on a controlled expansion plan without introducing unnecessary complexity.",
    agenda: [
      "Performance wins and relationship highlights",
      "Practice-area demand trends and intake quality",
      "Premium positioning and visibility strategy",
      "Landing page expansion and content opportunity",
      "Confirm commitments and next review milestones",
    ],
    wins: [
      "Review velocity increased 22% quarter over quarter",
      "Family-law consultation form conversion improved after copy updates",
      "High-intent keyword coverage expanded across two service categories",
    ],
    risks: [
      "Premium package timing must align with attorney capacity",
      "Content approval speed could delay launch timing",
    ],
    opportunities: [
      "Practice-area landing page expansion",
      "Premium content authority package",
      "Intake education workflow refinement",
    ],
    talkingPoints: [
      "Anchor the meeting around proof of value and strategic confidence",
      "Test appetite for expansion without pressuring timing",
      "Clarify content approval ownership before proposing launch dates",
    ],
    commitments: [
      "Confirm premium package decision timeline",
      "Assign content approval owner",
      "Schedule follow-up review for practice-area launch scope",
    ],
    aiRecommendations: [
      {
        id: "sable-rec-1",
        title: "Lead with measurable proof before premium positioning",
        summary: "Use current performance momentum to justify the next strategic package conversation.",
        rationale:
          "The relationship is strong and performance outcomes are visible, which creates ideal conditions for a premium expansion discussion grounded in value.",
        confidence: "High",
        evidence: [
          { label: "Quarterly review growth", source: "GBP reporting", freshness: "Updated today" },
          { label: "Consultation conversion trend", source: "Website analytics", freshness: "Updated 4h ago" },
        ],
      },
    ],
  },
];

export function getClients() {
  return clients;
}

export function getClientById(clientId: string) {
  return clients.find((client) => client.id === clientId);
}

export function getMonthlyTouchById(touchId: string) {
  return monthlyTouches.find((touch) => touch.id === touchId);
}

export function getMonthlyTouches() {
  return monthlyTouches;
}

export function getCommitments(clientId?: string) {
  return clientId ? commitments.filter((item) => item.clientId === clientId) : commitments;
}

export function getOpportunities(clientId?: string) {
  return clientId ? opportunities.filter((item) => item.clientId === clientId) : opportunities;
}

export function getCommandCenterSnapshot() {
  const incompletePrep = monthlyTouches.filter((touch) => touch.status !== "Ready").length;
  const overdueCommitments = commitments.filter((commitment) => commitment.status === "Overdue").length;
  const growthReady = opportunities.length;

  return {
    focusDate: "Monday, June 29",
    priorities: [
      "Finish Oakline prep package and confirm unresolved website fix owner",
      "Repair NorthPeak trust by reviewing overdue commitments before the meeting",
      "Review Sable expansion timing and finalize premium package positioning",
    ],
    alerts: [
      {
        label: `${incompletePrep} meeting prep incomplete${incompletePrep === 1 ? "" : "s"}`,
        tone: "warning",
      },
      {
        label: `${overdueCommitments} overdue commitment${overdueCommitments === 1 ? "" : "s"}`,
        tone: "danger",
      },
      {
        label: `${growthReady} growth opportunit${growthReady === 1 ? "y" : "ies"} ready`,
        tone: "positive",
      },
    ],
  };
}
