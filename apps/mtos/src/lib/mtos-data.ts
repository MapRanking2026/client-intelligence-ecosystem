export type Confidence = "High" | "Medium" | "Low";
/**
 * "unknown" is a real state, not a default: most ClickUp Health Tracker rows have no health value
 * set, and rendering those as "needs_attention" made 181 unassessed clients look like they had been
 * assessed and found wanting. Anything deriving a judgement from health must handle it.
 */
export type HealthTone =
  | "excellent"
  | "healthy"
  | "needs_attention"
  | "at_risk"
  | "critical"
  | "unknown";

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
  /** Which LLM provider actually answered (claude/openai/gemini). */
  provider?: string;
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
  /**
   * The reporting window this figure covers, as the AM would say it out loud
   * ("Last 30 days", "All time", "Latest scan"). Stated explicitly so the UI can
   * show it on every tile and the AI can attribute a period without parsing the
   * label. Optional: scorecards persisted before this field existed omit it.
   */
  period?: string;
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
  /** Messages started from the profile. Optional: snapshots taken before this metric was pulled omit it. */
  conversations?: number;
  /** Bookings made through the profile. Optional for the same reason as `conversations`. */
  bookings?: number;
  previous: {
    calls: number;
    websiteClicks: number;
    directionRequests: number;
    searches: number;
    mapViews: number;
    conversations?: number;
    bookings?: number;
  };
}

/** A single review worth reading out loud during the touch (negative, or still unanswered). */
export interface GbpReviewHighlight {
  reviewId: string;
  reviewer: string;
  starRating: number | null;
  comment: string;
  createdAt: string;
  replied: boolean;
}

/**
 * Everything the Business Profile APIs tell us about a client's listing beyond the raw
 * performance counters: review health, posting cadence, photo freshness, the search
 * terms that surfaced the profile, and how complete the listing itself is. Every block is
 * nullable because each one comes from a different Google API, and a client's connection may
 * have access to some but not all of them -- a block that could not be read is null and the
 * reason lands in `notes`.
 */
export interface GbpProfileInsight {
  locationId: string;
  locationName: string;
  /** The window the period-scoped figures below cover (same window as GbpPerformanceSnapshot). */
  periodStart: string;
  periodEnd: string;
  reviews: {
    totalCount: number | null;
    averageRating: number | null;
    newInPeriod: number | null;
    unansweredCount: number | null;
    /** Share of all reviews that have an owner reply. */
    responseRatePercent: number | null;
    lastReviewAt: string | null;
    /** Unanswered reviews, worst rating first -- the AM's to-do list for the call. */
    unanswered: GbpReviewHighlight[];
    /** Recent 1-2 star reviews, whether or not they were answered. */
    recentNegative: GbpReviewHighlight[];
  } | null;
  posts: {
    countInPeriod: number | null;
    lastPostAt: string | null;
    lastPostSummary: string;
  } | null;
  photos: {
    totalCount: number | null;
    newInPeriod: number | null;
    lastPhotoAt: string | null;
  } | null;
  /** Top search terms that put this profile in front of someone, highest impressions first. */
  searchKeywords: { term: string; impressions: number | null; isThreshold: boolean }[];
  completeness: {
    /** Share of the listing fields MTOS checks that are actually filled in. */
    percent: number | null;
    /** Human-readable names of the fields still missing, for the client ask list. */
    missing: string[];
    primaryCategory: string;
    additionalCategoryCount: number | null;
    serviceItemCount: number | null;
    /** Google's own open state for the listing: OPEN, CLOSED_TEMPORARILY, CLOSED_PERMANENTLY. */
    openState: string;
  } | null;
  /** Why a block above is null, or anything else the AM should know about this listing. */
  notes: string[];
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
  /** When this business last actually posted. Null when nothing has been published yet. */
  lastPostAt: string | null;
  lastPostPlatform: string | null;
  /** Next queued post, if anything is lined up. */
  nextScheduledPostAt: string | null;
}

export interface HeatmapComparison {
  keyword: string;
  current: HeatmapGrid;
  previous?: HeatmapGrid;
}

export interface RankTrackerProfileEvidence {
  business: MatchedRankTrackerBusiness;
  status: "active" | "inactive";
  statusNote?: string;
  keywordScans: KeywordScanHistory[];
  heatmapComparisons: HeatmapComparison[];
}

export interface SeoPerformancePack {
  heatmaps: SeoHeatmapRow[];
  matchedBusinesses: MatchedRankTrackerBusiness[];
  profiles?: RankTrackerProfileEvidence[];
  keywordScanHistory: KeywordScanHistory[];
  heatmapGrids: HeatmapGrid[];
  checkinBusinesses: MapCheckinBusinessSummary[];
  gbpPerformance: GbpPerformanceSnapshot[];
  /**
   * Listing health from the Business Profile APIs (reviews, posts, photos, completeness).
   * Optional: prep packs persisted before GBP listing data was pulled omit it.
   */
  gbpProfiles?: GbpProfileInsight[];
  mapCheckInCount: number | null;
  availability: MetricAvailability;
  notes: string[];
}

/**
 * Local Services Ads reports a different shape than search/social: advertisers are billed per
 * charged lead, there is no CTR or click-through conversion rate, and Google returns the prior
 * period alongside the current one. These are the LSA-only numbers that do not fit the generic
 * channel fields on AdsPerformancePack.
 */
export interface LsaPerformanceDetail {
  accountId: string;
  businessName: string;
  currencyCode: string;
  /** Leads Google actually billed for, and the same figure for the preceding period. */
  chargedLeads: number | null;
  previousChargedLeads: number | null;
  previousSpend: number | null;
  phoneCalls: number | null;
  previousPhoneCalls: number | null;
  /** Calls that connected -- the gap against phoneCalls is missed demand the client controls. */
  connectedPhoneCalls: number | null;
  previousConnectedPhoneCalls: number | null;
  /** Google's own 0-1 score for how reliably the business answers LSA phone leads. */
  phoneLeadResponsiveness: number | null;
  averageWeeklyBudget: number | null;
  averageFiveStarRating: number | null;
  totalReviews: number | null;
  /** Lead-level breakdown aggregated from the detailed lead report; null when it could not be read. */
  leadMix: {
    total: number;
    charged: number;
    notCharged: number;
    phoneCalls: number;
    messages: number;
    bookings: number;
    disputed: number;
    /** True when paging stopped early, so the mix describes a sample rather than the full period. */
    capped: boolean;
    topCategories: { category: string; count: number }[];
  } | null;
  notes: string[];
}

export interface AdsPerformancePack {
  channel: "Google Ads" | "Google LSA" | "Meta Ads";
  connected: boolean;
  spend: number | null;
  leads: number | null;
  costPerLead: number | null;
  ctr: number | null;
  conversionRate: number | null;
  benchmarkNote: string;
  /** Present only on the Google LSA channel. */
  lsa?: LsaPerformanceDetail | null;
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
  clickupContext?: ClickupClientContext;
  claude: PrepPackClaudeState;
  /** This month's rotated meeting format, so no two touches feel identical. */
  meetingFormat?: MeetingFormat;
  /** Interactive decisions the client co-owns this touch (client-as-copilot). */
  decisionsTogether?: DecisionTogether[];
  /** Soft variety guardrail note — how this touch differs from the last, or a warning if too similar. */
  varietyNote?: string;
}

/** A rotating meeting "format" that changes the angle/structure of a touch month to month. */
export interface MeetingFormat {
  id: string;
  name: string;
  /** One-line description of the angle this format takes. */
  angle: string;
  /** What to put in the spotlight for this format. */
  spotlight: string;
}

/** An interactive decision the client makes with the AM during the touch. */
export interface DecisionTogether {
  question: string;
  options: string[];
  /** Why this decision matters now. */
  why: string;
}

export interface ClickupBookPage {
  pageName: string;
  content: string;
}

export interface ClickupChatMessage {
  author: string;
  authorIsInternal: boolean;
  date: string;
  text: string;
}

export interface ClickupClientContext {
  matched: boolean;
  folderName: string;
  // Key Client's Book pages (business intelligence, offers, competitors, latest meeting/pre-touch notes).
  clientsBook: ClickupBookPage[];
  // Most recent project-channel chat activity.
  recentChat: ClickupChatMessage[];
  notes: string[];
}

export interface ClientRecord {
  id: string;
  name: string;
  industry: string;
  contact: string;
  lifecycleStage: string;
  touchId: string;
  touchDate: string;
  /**
   * null means "not assessed", which is distinct from a low score. ClickUp's Health Tracker carries
   * a three-state label (Good / Neutral / Risk), so a stored number is the band's representative
   * value, not a measured score. Relationship and growth have no ClickUp source at all and stay
   * null until something actually measures them.
   */
  healthScore: number | null;
  relationshipScore: number | null;
  growthReadiness: number | null;
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
  // Manually pinned integration profiles. Always ADDITIVE to automatic name matching --
  // effective profiles = auto matches UNION these ids.
  integrationMappings?: {
    rankTracker?: string[];
    mapCheckins?: string[];
    googleBusinessProfile?: string[];
    gohighlevel?: string[];
    googleAds?: string[];
    googleLsa?: string[];
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

/** A client objection the AM should be ready for, with a grounded response. */
export interface AnticipatedObjection {
  /** The objection or hard question the client is likely to raise. */
  objection: string;
  /** A grounded, non-defensive, solution-focused response for the AM. */
  response: string;
  /** Optional evidence from the prep pack that backs the response. */
  evidence?: string;
}

/** A raw metric/deliverable translated into plain-language business value. */
export interface ValueTranslation {
  /** The raw metric, deliverable, or win (e.g. "ARP improved 12 → 6"). */
  metric: string;
  /** What it means for the client's business, in plain language. */
  meaning: string;
}

export interface CallGuide {
  status: "not_generated" | "generated";
  source?: "claude" | "deterministic";
  sections: CallGuideSection[];
  generatedAt?: string;
  model?: string;
  /** Which LLM provider answered (claude/openai/gemini). */
  provider?: string;
  errorMessage?: string;
  /**
   * Anticipated client objections with grounded responses, from
   * `objection_handling_prompt`. Additive and best-effort: absent if the model
   * is unavailable or the call fails, so it never blocks the timed guide.
   */
  anticipatedObjections?: AnticipatedObjection[];
  /**
   * Plain-language value translations of the month's metrics, from
   * `value_performance_translation_prompt`. Additive and best-effort.
   */
  valueTranslations?: ValueTranslation[];
}

/**
 * The slide shapes the Map Ranking report deck actually uses. Taken from the two
 * approved reference decks (Sparkle Plumbing EN, Lopez ES): both are 13.33x7.5in
 * 16:9, Arial, and build every slide out of this handful of arrangements. A fixed
 * set rather than free-form HTML so the deck cannot drift off-brand, and so the
 * same slide renders identically in the in-app viewer and in the exported .pptx.
 */
export type PresentationLayout =
  | "cover"
  | "agenda"
  | "stat_callouts"
  | "bullets"
  | "two_column"
  | "table"
  | "questions"
  | "status_list"
  | "timeline"
  | "closing";

/** Colour role for a stat or status chip, mapped to the deck's status palette. */
export type PresentationTone = "neutral" | "good" | "watch" | "risk";

export interface PresentationStat {
  value: string;
  caption: string;
  tone?: PresentationTone;
}

export interface PresentationItem {
  label: string;
  detail?: string;
  /** Short chip, e.g. "IMPROVED", "IN MOTION", "NEEDS APPROVAL". */
  status?: string;
  tone?: PresentationTone;
}

export interface PresentationSlide {
  layout: PresentationLayout;
  /** Running section label, e.g. "SECTION 03 · RANKINGS ON GOOGLE MAPS". */
  section?: string;
  title: string;
  subtitle?: string;
  bullets?: string[];
  stats?: PresentationStat[];
  columns?: { heading: string; items: string[] }[];
  table?: { headers: string[]; rows: string[][] };
  items?: PresentationItem[];
  /** Period and source, kept visible on any slide carrying numbers. */
  footnote?: string;
  /**
   * Private AM guidance: talk track, the question to pause on, the decision to
   * capture. Never rendered on the client-visible surface -- see the presenter
   * pane in presentation-viewer.tsx and the notesSlide in the .pptx export.
   */
  presenterNotes?: string;
}

export interface Presentation {
  status: "not_generated" | "generated";
  title?: string;
  clientName?: string;
  /** e.g. "October 2026" or "Last 30 days to Oct 28, 2026". */
  periodLabel?: string;
  preparedFor?: string;
  preparedBy?: string;
  language?: "en" | "es";
  /** Which of the ten experience formats this deck uses, e.g. "01 — Progress Review". */
  experienceFormat?: string;
  /** Why that format fits this month. Internal: never shown to the client. */
  formatRationale?: string;
  slides: PresentationSlide[];
  generatedAt?: string;
  model?: string;
  provider?: string;
  errorMessage?: string;
}

export type TicketDepartment = "SEO" | "Web Design" | "Ads" | "Account Manager" | "Other";

export type TicketPriority = "urgent" | "high" | "normal" | "low";

export type TicketType = "regular" | "billing";

/** The billing-change categories (match the ClickUp "Type" field options). */
export type BillingChangeType =
  | "Upsell"
  | "Downsell"
  | "New Sale"
  | "Pause"
  | "Cancel"
  | "Payment Failed";

export interface DraftTicket {
  id: string;
  title: string;
  description: string;
  department: TicketDepartment;
  /** ClickUp member id chosen for this ticket, used to set the real task assignee. */
  assigneeId?: number;
  /** Display name of the chosen assignee, kept for the UI. */
  assignee?: string;
  /** ClickUp "Business Name" option id this ticket is filed under (editable per multi-GBP accounts). */
  businessOptionId?: string;
  /** Display name of the chosen business, kept for the UI and ticket description. */
  businessName?: string;
  /** ClickUp native priority; drives the default due date. */
  priority?: TicketPriority;
  /** Estimated effort in minutes (ClickUp native time estimate). */
  timeEstimateMinutes?: number;
  /** Optional explicit due date (YYYY-MM-DD). When absent it's derived from priority at creation. */
  dueDate?: string;
  /** Regular ops ticket, or a billing-change ticket (routed to Carlos). Defaults to regular. */
  ticketType?: TicketType;
  /** For billing tickets: the billing-change category. */
  billingChangeType?: BillingChangeType;
  /** For billing tickets: the date the change was requested / the event happened (YYYY-MM-DD). */
  dateRequested?: string;
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

/** A proposed change to one of the two Client Intelligence dashboards. */
export type DashboardKind = "risk_register" | "stakeholder_map";

export interface DashboardUpdateProposal {
  id: string;
  dashboard: DashboardKind;
  action: "create" | "update";
  clientName: string;
  /** One-line description of the proposed change. */
  summary: string;
  /** The exact body written into the ClickUp task on approval. */
  detail: string;
  reason: string;
  evidence: string[];
  status: "pending" | "approved" | "declined";
  clickupTaskId?: string;
  clickupTaskUrl?: string;
  executionNote?: string;
}

/**
 * Output of the Client Intelligence Dashboard Updater step, which runs after
 * transcript analysis and proposes Risk Register / Stakeholder Map updates for
 * AM approval. Purely additive to the post-meeting record.
 */
export interface DashboardUpdateReview {
  status: "draft_ready" | "applied";
  proposals: DashboardUpdateProposal[];
  analyzedAt?: string;
  model?: string;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Client Intelligence -- the per-client record generated after a monthly touch.
// The narrative report is always saved (per client, never posted). When a risk is
// detected, MTOS also pre-fills a Risk Register + Stakeholder Map entry that the
// AM approves before it is written to ClickUp.
// ---------------------------------------------------------------------------

export type YesNo = "Yes" | "No";
export type YesNoMaybe = "Yes" | "No" | "maybe";
export type YesNoKindOf = "Yes" | "No" | "kind of";
export type RiskTier = "Healthy" | "Low" | "Medium" | "High" | "Critical";
export type ClientType = "Direct" | "White Label";
export type CaseStatus = "Watching" | "Working" | "Requested Cancellation" | "Resolved-Healthy";
export type RiskPrimaryCategory =
  | "Communication"
  | "Expectations"
  | "Gen. Business"
  | "Product"
  | "Onboarding";
export type CommunicationPreference = "Phone" | "Email" | "Face-to-Face" | "Text/Chat";
export type MarketingLiteracy = "Low" | "Medium" | "High";

/** The Risk Register row for an at-risk client (mirrors the ClickUp Risk Register form). */
export interface RiskRegisterEntry {
  accountManager?: string;
  clientType?: ClientType;
  caseStatus?: CaseStatus;
  dateFlagged?: string; // YYYY-MM-DD
  money?: YesNo;
  responsiveness?: YesNo;
  lifeChange?: YesNoMaybe;
  technical?: YesNo;
  otherAgency?: YesNoKindOf;
  performance?: YesNo;
  /** ClickUp Risk Score dropdown (1-6). Drives Risk Tier. */
  riskScore?: number;
  riskTier?: RiskTier;
  primaryCategory?: RiskPrimaryCategory;
  nextAction?: string;
  nextActionOwner?: string;
  dueDate?: string; // YYYY-MM-DD
  lastMonthlyTouch?: string; // YYYY-MM-DD
  latestComments?: string;
}

/** The Stakeholder Map row for an at-risk client (mirrors the ClickUp Stakeholder Map form). */
export interface StakeholderMapEntry {
  clientName?: string;
  assignee?: string;
  clientType?: ClientType;
  services?: string[];
  role?: string;
  communicationPreference?: CommunicationPreference;
  marketingLiteracy?: MarketingLiteracy;
  personality?: string;
  whatTheyCareAbout?: string;
  knownHistory?: string;
}

/**
 * AI-suggested client-health reads, generated from the transcript so the score is
 * grounded in what the client actually said rather than guessed before the call.
 * Suggestions only -- the AM confirms or overrides every one of them.
 */
export interface ClientHealthSuggestion {
  /** Suggested NPS, 0-10, or null when the transcript gives nothing to read. */
  suggestedNps: number | null;
  /** Why that score, in one sentence, grounded in the transcript. */
  suggestedNpsReason: string;
  /** True when the client said a number out loud (rather than it being inferred). */
  npsStatedByClient?: boolean;
  /**
   * A ready reason for each score the AM might pick instead, keyed "0".."10", so
   * changing the score still arrives with a grounded starting sentence.
   */
  npsReasonsByScore?: Record<string, string>;
  /** Why the rubric's risk tier fits this client, in one sentence. */
  riskReason?: string;
  /** A ready reason for each alternate tier the AM might pick, keyed by tier. */
  riskReasonsByTier?: Partial<Record<RiskTier, string>>;
  model?: string;
}

/** What the AM actually recorded for this touch, after reviewing the suggestions. */
export interface ClientHealthRecord {
  /** The confirmed NPS, 0-10. */
  nps: number | null;
  npsReason: string;
  /** The confirmed risk status for the register. */
  riskTier?: RiskTier;
  riskReason?: string;
  /** True when the AM changed the score away from the suggestion. */
  overrodeSuggestion?: boolean;
  recordedAt: string;
}

export interface ClientIntelligenceReview {
  status: "draft_ready" | "applied";
  /** Narrative report -- always saved with the client, never posted to ClickUp. */
  report: string;
  /** Whether a retention risk was detected from the touch (gates the Risk Register only). */
  riskDetected: boolean;
  /** True when this Risk Register entry CLEARS a previously-flagged client (resolution). */
  riskResolved?: boolean;
  riskTier?: RiskTier;
  /** Risk Register entry -- present only when at risk. Stakeholder Map is always present. */
  riskRegister?: RiskRegisterEntry;
  stakeholderMap?: StakeholderMapEntry;
  /** True when the client's Stakeholder Map row is already populated (an update, not a first fill). */
  stakeholderUpToDate?: boolean;
  /** The client's linked ClickUp task (Health Tracker) that entries update; absent = not synced. */
  clientTaskLinked?: boolean;
  /** Per-entry approval state + resulting ClickUp task, set when applied. */
  riskRegisterStatus?: "pending" | "approved" | "declined";
  stakeholderMapStatus?: "pending" | "approved" | "declined";
  riskRegisterTaskUrl?: string;
  stakeholderMapTaskUrl?: string;
  /** Non-fatal note (e.g. a list isn't configured) surfaced after applying. */
  executionNote?: string;
  /**
   * NPS and risk-status suggestions read from the transcript. Best-effort: absent
   * when no model is configured or the suggestion call failed, which never blocks
   * the rest of the intelligence step.
   */
  healthSuggestion?: ClientHealthSuggestion;
  /** The NPS and risk status the AM confirmed. Absent until they save it. */
  health?: ClientHealthRecord;
  analyzedAt?: string;
  model?: string;
  errorMessage?: string;
}

export interface PostMeetingReview {
  status: "not_started" | "draft_ready" | "approved";
  transcript?: string;
  recapSummary?: string;
  extractedCommitments?: string[];
  draftTickets?: DraftTicket[];
  clientEmail?: ClientEmailDraft;
  /** @deprecated superseded by clientIntelligence; kept for older records. */
  dashboardUpdates?: DashboardUpdateReview;
  /** Client Intelligence report + (if at risk) Risk Register / Stakeholder Map entries. */
  clientIntelligence?: ClientIntelligenceReview;
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

/**
 * Lead & call verification. A verification run inspects the individual leads,
 * calls, and form submissions a client received (read from the GoHighLevel
 * snapshot, which aggregates every source), vets each one, reconciles the counts
 * against the platforms that report their own numbers (Google Ads, GBP), and
 * confirms each lead's attribution channel. It is non-destructive: the AI drafts
 * a verdict per lead and the AM can override it.
 */
export type LeadType = "call" | "form" | "chat" | "manual";

export type LeadStatus = "valid" | "flagged" | "needs_review" | "missed_call";

/** Resolved attribution channel a lead came in through. */
export type LeadChannel =
  | "google_ads"
  | "organic_website"
  | "meta_ads"
  | "gbp_call"
  | "direct"
  | "referral"
  | "unknown";

/** Why a lead is classified the way it is. `valid_new_lead` is the good outcome. */
export type LeadCategory =
  | "valid_new_lead"
  | "spam"
  | "duplicate"
  | "existing_customer"
  | "wrong_number"
  | "sales_solicitation"
  | "out_of_area"
  | "incomplete"
  | "irrelevant";

export interface VerifiedLead {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  /** ISO timestamp the lead was received. */
  receivedAt?: string;
  /** Raw source string as it arrived from GoHighLevel. */
  rawSource?: string;
  /** Resolved attribution channel. */
  channel: LeadChannel;
  type: LeadType;
  campaign?: string;
  status: LeadStatus;
  category: LeadCategory;
  /** Classification rationale / why it was flagged. */
  reason?: string;
  /** 0-100 attribution + vetting confidence. */
  confidence?: number;
  /** Best-effort call-recording link (streamed on demand for call-type leads). */
  recordingUrl?: string;
  /** Call metadata (for type "call"): duration in seconds, status, direction. */
  callDurationSec?: number;
  callStatus?: string;
  callDirection?: string;
  /** Deep link into the contact in GoHighLevel. */
  contactUrl?: string;
  /** First message / snippet of context. */
  notes?: string;
  /** Whether the current verdict came from the AI or an AM override. */
  verdictSource?: "ai" | "manual";
  /** True for pasted/imported leads not sourced from a connected integration. */
  manual?: boolean;
}

export interface LeadChannelCount {
  channel: LeadChannel;
  total: number;
  valid: number;
  flagged: number;
}

/** GHL's count for a channel vs. the platform that reports its own number. */
export interface LeadReconciliation {
  channel: LeadChannel;
  ghlCount: number;
  platformCount: number | null;
  platformLabel: string;
  delta: number | null;
  note?: string;
}

/** Time window to pull leads/calls for. Default is a rolling last 30 days. */
export type LeadWindowPreset =
  | "last_7_days"
  | "last_30_days"
  | "last_90_days"
  | "this_month"
  | "last_month"
  | "custom";

export const LEAD_WINDOW_LABEL: Record<LeadWindowPreset, string> = {
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
  last_90_days: "Last 90 days",
  this_month: "This month",
  last_month: "Last month",
  custom: "Custom range",
};

export interface LeadWindowInput {
  preset: LeadWindowPreset;
  /** For preset "custom": inclusive YYYY-MM-DD start / end. */
  since?: string;
  until?: string;
}

export interface LeadVerificationReview {
  status: "not_started" | "ready" | "error";
  clientId: string;
  leads: VerifiedLead[];
  totals: {
    total: number;
    valid: number;
    flagged: number;
    needsReview: number;
    /** Calls that rang through but were not answered (voicemail / no-answer). */
    missedCalls: number;
  };
  byChannel: LeadChannelCount[];
  reconciliation: LeadReconciliation[];
  warnings: string[];
  /** Time window the leads were pulled for. */
  window?: { since?: string; until?: string };
  source?: "claude" | "heuristic";
  generatedAt?: string;
  model?: string;
  /** Which LLM provider answered the vetting pass (claude/openai/gemini). */
  provider?: string;
  errorMessage?: string;
}

/** Client-safe display labels, shared by the engine and the UI. */
export const LEAD_CHANNEL_LABEL: Record<LeadChannel, string> = {
  google_ads: "Google Ads",
  organic_website: "Organic / Website",
  meta_ads: "Meta Ads",
  gbp_call: "Google Business calls",
  direct: "Direct",
  referral: "Referral",
  unknown: "Unknown",
};

export const LEAD_CATEGORY_LABEL: Record<LeadCategory, string> = {
  valid_new_lead: "Valid new lead",
  spam: "Spam",
  duplicate: "Duplicate",
  existing_customer: "Existing customer",
  wrong_number: "Wrong number",
  sales_solicitation: "Sales solicitation",
  out_of_area: "Out of area",
  incomplete: "Incomplete",
  irrelevant: "Irrelevant",
};

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  valid: "Valid",
  flagged: "Flagged",
  needs_review: "Needs review",
  missed_call: "Missed call",
};

export const LEAD_TYPE_LABEL: Record<LeadType, string> = {
  call: "Call",
  form: "Form",
  chat: "Chat",
  manual: "Manual",
};

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
  /** The client-facing slide deck, the alternative delivery format to the call guide. */
  presentation?: Presentation;
  /** AM overrides for which screen each call-guide section suggests presenting (section index → screen key). */
  callGuideScreens?: Record<string, string>;
  postMeeting?: PostMeetingReview;
  qaReview?: QaReview;
  /** Latest lead & call verification captured during prep (optional, additive). */
  leadVerification?: LeadVerificationReview;
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
