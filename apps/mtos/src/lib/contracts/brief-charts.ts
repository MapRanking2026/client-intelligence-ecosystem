import { rankTrackerChip, unlinkedChip, type SourceChip } from "@/src/lib/contracts/brief-sources";
import type { BriefSectionId } from "@/src/lib/contracts/prep-brief";
import type {
  AdsPerformancePack,
  BusinessScorecard,
  GbpPerformanceSnapshot,
  MonthlyTouchPrepPack,
  ScorecardMetric,
  SeoPerformancePack,
} from "@/src/lib/mtos-data";

/**
 * The charts in the review brief: the picture of a number, directly above the sentence about it.
 *
 * The brief's sections are prose, and prose about numbers is the one thing an AM cannot scan. A
 * client asking "so are we up or down" wants the shape of the month, and reading four paragraphs
 * to assemble it is how an AM ends up saying something the data does not support.
 *
 * ## Every figure here is one somebody already pulled
 *
 * Nothing in this file computes a metric. It reads what the preparation already stored on the
 * touch -- the business scorecard, the Google Business Profile snapshots, the rank scans, the ads
 * channels -- and arranges it. That matters because a chart reads as authoritative: an invented
 * number in a paragraph might get hedged, the same number in a bar does not.
 *
 * Three rules follow from that, and they are the whole reason this is a derivation layer rather
 * than a component reading the pack directly:
 *
 * 1. **A metric that is unavailable is left out, not drawn as zero.** `availability` and a null
 *    value both mean "we could not read this", and a bar of height zero says "it happened zero
 *    times". The brief is explicit about gaps elsewhere; a chart must not quietly contradict it.
 * 2. **No previous period means no delta.** A first month shows the value and says nothing about
 *    direction, instead of an arrow measured against a zero nobody ever recorded.
 * 3. **A chart with nothing left in it does not render.** An empty panel with a title is worse
 *    than no panel, because it reads as a real answer of "nothing".
 *
 * ## Direction is per metric, not per chart
 *
 * Cost per lead falling is good. Missed calls falling is good. A ranking falling is good, because
 * rank 3 beats rank 7. Everything else rising is good. Getting this wrong paints a green arrow on
 * a worse month, which is the single most expensive mistake this file could make, so each metric
 * declares its own direction and the tone is computed from that.
 */

export type BriefChartKind = "cards" | "line" | "rank" | "compare" | "funnel" | "stack" | "goal";

/** The prototype's tone names, which the app's chip and dot classes already use. */
export type ChartTone = "good" | "watch" | "risk" | "info" | "muted" | "teal";

export interface ChartCard {
  label: string;
  /** Already formatted for reading: a currency string, a percentage, a count. Never a raw number. */
  value: string;
  /** The delta line under the value, or what the figure covers. Absent when there is nothing true to say. */
  detail?: string;
  tone: ChartTone;
  /** 0-100, for metrics that are a share of something. Absent when the metric is not a share. */
  bar?: number;
  barTone?: ChartTone;
}

/** One keyword's movement. Lower is better, and both ends are real scans. */
export interface ChartRankRow {
  label: string;
  from: number;
  to: number;
}

export interface ChartCompareRow {
  label: string;
  a: number;
  b: number;
  lowerIsBetter?: boolean;
}

export interface ChartFunnelRow {
  label: string;
  value: number;
  tone: ChartTone;
}

export interface ChartStackSegment {
  label: string;
  value: number;
  tone: ChartTone;
}

export interface ChartLineSeries {
  aName: string;
  bName: string;
  a: number[];
  b: number[];
  min: number;
  max: number;
  lowerIsBetter?: boolean;
}

export interface ChartGoal {
  have: number;
  goal: number;
  /** How far through the period we are, so a part-finished goal can be read as ahead or behind. */
  pacePercent: number;
  unit: string;
}

/**
 * One chart, bound to the section and the block it belongs above.
 *
 * `at` is a block index inside the section: the chart renders immediately before that block, which
 * is what "chart then the text explaining it" means in practice. An `at` past the last block puts
 * the chart at the end, so a section that lost a block to an edit still shows its chart.
 */
export interface BriefChart {
  id: string;
  section: BriefSectionId;
  at: number;
  kind: BriefChartKind;
  title: string;
  /** The window the figures cover, said the way an AM would say it. Empty when it is not a window. */
  period: string;
  chips: SourceChip[];
  cards?: ChartCard[];
  rank?: ChartRankRow[];
  compare?: ChartCompareRow[];
  funnel?: ChartFunnelRow[];
  stack?: ChartStackSegment[];
  line?: ChartLineSeries;
  goal?: ChartGoal;
}

// ---------------------------------------------------------------------------
// Formatting and direction
// ---------------------------------------------------------------------------

export function formatMetricValue(value: number, unit: ScorecardMetric["unit"]): string {
  if (unit === "currency") {
    return Number.isInteger(value)
      ? `$${value.toLocaleString("en-US")}`
      : `$${value.toFixed(2)}`;
  }
  if (unit === "percent") return `${Math.round(value)}%`;
  return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toFixed(1);
}

/**
 * The delta line, and the tone that goes with it.
 *
 * Percentages are only honest against a previous value that is not zero; from zero there is no
 * percentage to quote, so the line says what the change actually was. "Flat" is its own answer and
 * gets the muted tone -- painting it green would make a month where nothing moved look like
 * progress.
 */
export function deltaLine(
  value: number,
  previous: number | null,
  unit: ScorecardMetric["unit"],
  lowerIsBetter = false,
): { detail?: string; tone: ChartTone } {
  if (previous === null || !Number.isFinite(previous)) {
    return { tone: "muted" };
  }
  const change = value - previous;
  if (change === 0) {
    return { detail: `flat · was ${formatMetricValue(previous, unit)}`, tone: "muted" };
  }
  const better = lowerIsBetter ? change < 0 : change > 0;
  const arrow = change > 0 ? "▲" : "▼";
  const size =
    previous === 0
      ? formatMetricValue(Math.abs(change), unit)
      : `${Math.round((Math.abs(change) / Math.abs(previous)) * 100)}%`;
  return {
    detail: `${arrow} ${size} · was ${formatMetricValue(previous, unit)}`,
    tone: better ? "good" : "risk",
  };
}

/** A scorecard metric as a card, or nothing when it was not readable. */
function metricCard(
  metric: ScorecardMetric | undefined,
  options: { lowerIsBetter?: boolean } = {},
): ChartCard | undefined {
  if (!metric || metric.availability !== "available" || metric.value === null) return undefined;
  const { detail, tone } = deltaLine(metric.value, metric.previousValue, metric.unit, options.lowerIsBetter);
  const share = metric.unit === "percent" ? Math.max(0, Math.min(100, metric.value)) : undefined;
  return {
    label: metric.label,
    value: formatMetricValue(metric.value, metric.unit),
    ...(detail ? { detail } : metric.period ? { detail: metric.period } : {}),
    tone,
    ...(share !== undefined ? { bar: share, barTone: tone === "muted" ? "info" : tone } : {}),
  };
}

/** A pair of Business Profile figures as a card. The snapshot always carries its own previous period. */
function gbpCard(label: string, value: number | undefined, previous: number | undefined): ChartCard | undefined {
  if (value === undefined || value === null || !Number.isFinite(value)) return undefined;
  const prior = previous === undefined || !Number.isFinite(previous) ? null : previous;
  const { detail, tone } = deltaLine(value, prior, "count");
  return { label, value: formatMetricValue(value, "count"), ...(detail ? { detail } : {}), tone };
}

function nonEmpty<T>(rows: (T | undefined)[]): T[] {
  return rows.filter((row): row is T => row !== undefined);
}

function periodLabel(snapshot: GbpPerformanceSnapshot): string {
  if (!snapshot.periodStart || !snapshot.periodEnd) return "";
  return `${snapshot.periodStart} – ${snapshot.periodEnd}`;
}

/** Whether a scorecard metric is readable at all, which every chart here has to ask first. */
function readable(metric: ScorecardMetric | undefined): metric is ScorecardMetric & { value: number } {
  return Boolean(metric) && metric!.availability === "available" && metric!.value !== null;
}

// ---------------------------------------------------------------------------
// The charts, section by section
// ---------------------------------------------------------------------------

/**
 * Section 3, the client snapshot: the business numbers, before the paragraph describing them.
 *
 * Leads, qualified leads and booked jobs are the three an owner actually asks about, and cost per
 * lead is the one they argue about, so it sits with them rather than with the ads detail.
 */
function snapshotCharts(scorecard: BusinessScorecard | undefined): BriefChart[] {
  if (!scorecard) return [];
  const cards = nonEmpty([
    metricCard(scorecard.totalLeads),
    metricCard(scorecard.qualifiedLeads),
    metricCard(scorecard.bookedJobs),
    metricCard(scorecard.costPerLead, { lowerIsBetter: true }),
  ]);
  if (!cards.length) return [];
  return [
    {
      id: "chart-snapshot",
      section: "3",
      at: 0,
      kind: "cards",
      title: "The month in four numbers",
      period: scorecard.totalLeads.period || "",
      chips: [unlinkedChip("mtos", "Business scorecard")],
      cards,
    },
  ];
}

/**
 * Section 8, wins: what the Business Profile did, then where the rankings moved.
 *
 * Both are the client's own result rather than our activity, which is what makes them a win worth
 * presenting. The ranking chart only lists keywords whose previous scan is real, because moving
 * "from nowhere to 4" is a claim about a month nobody measured.
 */
function winCharts(seo: SeoPerformancePack | undefined): BriefChart[] {
  if (!seo) return [];
  const charts: BriefChart[] = [];
  const snapshot = seo.gbpPerformance?.[0];

  if (snapshot) {
    const cards = nonEmpty([
      gbpCard("Calls", snapshot.calls, snapshot.previous?.calls),
      gbpCard("Direction requests", snapshot.directionRequests, snapshot.previous?.directionRequests),
      gbpCard("Website clicks", snapshot.websiteClicks, snapshot.previous?.websiteClicks),
      gbpCard("Profile views", snapshot.mapViews, snapshot.previous?.mapViews),
    ]);
    if (cards.length) {
      charts.push({
        id: "chart-gbp",
        section: "8",
        at: 0,
        kind: "cards",
        title: "Google Business Profile",
        period: periodLabel(snapshot),
        chips: [unlinkedChip("gbp")],
        cards,
      });
    }
  }

  /*
    Rank movement, from the scans that have two ends. The heatmap row carries the latest average;
    the scan history carries the one before it. A keyword with a single scan is left out rather
    than compared against itself.
  */
  const rank = nonEmpty(
    (seo.heatmaps || []).slice(0, 6).map((row): ChartRankRow | undefined => {
      const to = row.averageRanking;
      const history = (seo.keywordScanHistory || []).find((entry) => entry.keyword === row.keyword);
      const scans = (history?.scans || []).filter((scan) => scan.averageRank !== null);
      const from = scans.length > 1 ? scans[scans.length - 2]!.averageRank : null;
      if (to === null || from === null) return undefined;
      return { label: row.location ? `${row.keyword} · ${row.location}` : row.keyword, from, to };
    }),
  );
  if (rank.length) {
    charts.push({
      id: "chart-rank",
      section: "8",
      at: 3,
      kind: "rank",
      title: "Google Maps position — last scan against the one before",
      period: "",
      chips: [rankTrackerChip("Rank Tracker"), unlinkedChip("rank-tracker", "Heatmaps")],
      rank,
    });
  }

  /*
    Scan by scan, where there are enough scans to draw a shape rather than a guess. Eight is the
    smallest number that gives two comparable halves; below that the line would be mostly noise.
  */
  const history = (seo.keywordScanHistory || []).find(
    (entry) => entry.scans.filter((scan) => scan.averageRank !== null).length >= 8,
  );
  if (history) {
    const points = history.scans
      .filter((scan) => scan.averageRank !== null)
      .map((scan) => scan.averageRank as number);
    const recent = points.slice(-4);
    const prior = points.slice(-8, -4);
    const all = [...recent, ...prior];
    charts.push({
      id: "chart-rank-line",
      section: "8",
      at: 3,
      kind: "line",
      title: `Average position, scan by scan — ${history.keyword}`,
      period: "last eight scans",
      chips: [rankTrackerChip("Rank Tracker")],
      line: {
        aName: "Earlier four",
        bName: "Latest four",
        a: prior,
        b: recent,
        min: Math.max(1, Math.floor(Math.min(...all) - 1)),
        max: Math.ceil(Math.max(...all) + 1),
        lowerIsBetter: true,
      },
    });
  }

  return charts;
}

/**
 * Section 9, issues: the funnel, which is where an issue usually turns out to live.
 *
 * Calls answered against calls missed is the one an owner can act on the same afternoon, and it is
 * the number most likely to contradict a complaint that the leads are bad.
 *
 * ## Every step has to cover the same period
 *
 * The scorecard's metrics each carry their own reporting window, and they are not all the same one:
 * leads are usually "Last 30 days" while the CRM reports opportunities and won jobs "All time".
 * Put those in one funnel and it draws a month of leads narrowing into years of pipeline -- a real
 * client's brief showed 81 leads above 2,534 "qualified", which is not a funnel, it is a mistake
 * an owner would spot from across the room. So the steps are filtered to the first one's period
 * and anything on a different clock is left out, even though its figure is perfectly good in the
 * card set above, where it is labelled with its own window.
 *
 * ## And a funnel cannot widen
 *
 * After the period filter, the three narrowing stages are checked: each must be no larger than the
 * one before it. If they are not, the data is telling us something we do not understand, and the
 * whole chart is dropped rather than drawn wrong. `Calls missed` is exempt because it is not a
 * stage of the funnel -- it is the risk figure sitting beside it, and it can legitimately exceed
 * the jobs booked.
 */
function issueCharts(scorecard: BusinessScorecard | undefined): BriefChart[] {
  if (!scorecard) return [];

  /** A step, with the window its figure covers, so mismatched windows can be dropped. */
  interface FunnelCandidate extends ChartFunnelRow {
    period: string;
    /** True for the narrowing stages. `Calls missed` is not one. */
    stage: boolean;
  }

  const candidates = nonEmpty<FunnelCandidate>([
    readable(scorecard.totalLeads)
      ? { label: "Leads", value: scorecard.totalLeads.value, tone: "info", period: scorecard.totalLeads.period || "", stage: true }
      : undefined,
    readable(scorecard.qualifiedLeads)
      ? { label: "Qualified", value: scorecard.qualifiedLeads.value, tone: "info", period: scorecard.qualifiedLeads.period || "", stage: true }
      : undefined,
    readable(scorecard.bookedJobs)
      ? { label: "Booked", value: scorecard.bookedJobs.value, tone: "teal", period: scorecard.bookedJobs.period || "", stage: true }
      : undefined,
    readable(scorecard.callsMissed)
      ? { label: "Calls missed", value: scorecard.callsMissed.value, tone: "risk", period: scorecard.callsMissed.period || "", stage: false }
      : undefined,
  ]);
  if (!candidates.length) return [];

  // The first readable step sets the clock; everything else has to be on it.
  const period = candidates[0].period;
  const sameWindow = candidates.filter((candidate) => candidate.period === period);

  // Two steps is not a funnel, it is a comparison, and drawing it as one overstates the finding.
  if (sameWindow.length < 3) return [];

  const stages = sameWindow.filter((candidate) => candidate.stage).map((candidate) => candidate.value);
  if (stages.some((value, index) => index > 0 && value > stages[index - 1])) return [];

  return [
    {
      id: "chart-funnel",
      section: "9",
      at: 0,
      kind: "funnel",
      title: "Where the month's demand went",
      period,
      chips: [unlinkedChip("ghl", "Lead records"), unlinkedChip("mtos", "Business scorecard")],
      funnel: sameWindow.map(({ label, value, tone }) => ({ label, value, tone })),
    },
  ];
}

/**
 * Section 10, service performance: one card set per connected ad channel, then the split of
 * qualified leads against the rest.
 *
 * A channel that is not connected is skipped rather than shown at zero spend -- "we spent nothing"
 * and "we cannot see the account" are different conversations to have with the client.
 */
function serviceCharts(
  ads: AdsPerformancePack[] | undefined,
  scorecard: BusinessScorecard | undefined,
): BriefChart[] {
  const charts: BriefChart[] = [];
  const channels = (ads || []).filter((channel) => channel.connected);

  channels.forEach((channel, index) => {
    const cards = nonEmpty<ChartCard>([
      channel.spend !== null
        ? { label: "Spend", value: formatMetricValue(channel.spend, "currency"), tone: "muted" }
        : undefined,
      channel.leads !== null
        ? { label: "Leads", value: formatMetricValue(channel.leads, "count"), tone: "info" }
        : undefined,
      channel.costPerLead !== null
        ? { label: "Cost per lead", value: formatMetricValue(channel.costPerLead, "currency"), tone: "muted" }
        : undefined,
      channel.ctr !== null
        ? { label: "Click-through rate", value: formatMetricValue(channel.ctr, "percent"), tone: "muted" }
        : undefined,
    ]);
    if (!cards.length) return;
    charts.push({
      id: `chart-ads-${index}`,
      section: "10",
      /*
        Section 10 folds SEO, Google Ads and Meta Ads into one block each, so a channel's cards sit
        above the block that discusses it: Meta after the second, everything else after the first.
      */
      at: channel.channel === "Meta Ads" ? 2 : 1,
      kind: "cards",
      title: channel.channel,
      period: "",
      chips: [
        unlinkedChip(
          channel.channel === "Meta Ads" ? "meta" : channel.channel === "Google LSA" ? "lsa" : "google-ads",
        ),
      ],
      cards,
    });
  });

  const total = scorecard?.totalLeads;
  const qualified = scorecard?.qualifiedLeads;
  if (
    readable(total) &&
    readable(qualified) &&
    total.value > 0 &&
    qualified.value <= total.value
  ) {
    charts.push({
      id: "chart-lead-quality",
      section: "10",
      at: 1,
      kind: "stack",
      title: `Lead quality — ${formatMetricValue(total.value, "count")} leads`,
      period: total.period || "",
      chips: [unlinkedChip("ghl", "Lead records")],
      stack: [
        { label: "Qualified", value: qualified.value, tone: "teal" },
        { label: "Not qualified", value: total.value - qualified.value, tone: "watch" },
      ],
    });
  }

  return charts;
}

/**
 * Every chart the brief can draw for this touch, in section order.
 *
 * There is deliberately no chart for section 11, the goal. A goal chart needs a number somebody
 * agreed to, and MTOS does not store one yet -- the quarterly goal lives in prose in the Client's
 * Book. Drawing a progress bar would mean choosing that number here, which is exactly the kind of
 * invention this file exists to prevent. When a numeric goal is stored, `ChartGoal` is the shape it
 * renders through and nothing else has to change.
 */
export function deriveBriefCharts(prepPack: MonthlyTouchPrepPack | undefined): BriefChart[] {
  if (!prepPack) return [];
  return [
    ...snapshotCharts(prepPack.businessScorecard),
    ...winCharts(prepPack.seoPerformance),
    ...issueCharts(prepPack.businessScorecard),
    ...serviceCharts(prepPack.adsPerformance, prepPack.businessScorecard),
  ];
}

/** The charts for one section, in the order they should render. */
export function chartsForSection(charts: BriefChart[], section: BriefSectionId): BriefChart[] {
  return charts.filter((chart) => chart.section === section).sort((a, b) => a.at - b.at);
}
