/**
 * The review brief's charts: what gets drawn, what gets left out, and which way the arrow points.
 *
 * Pure checks: nothing is read from or written to Firestore, and no model is called. Everything
 * here is the derivation layer being handed a prep pack and asked what it would draw.
 *
 * These are worth pinning harder than most. A chart is the most quotable thing on the review
 * screen -- an AM reads it, then says it out loud to the client -- so the two ways it can lie are
 * both expensive: a metric nobody could read drawn as a zero, and a worse month painted green
 * because the direction was assumed instead of declared.
 */
import {
  chartsForSection,
  deltaLine,
  deriveBriefCharts,
  formatMetricValue,
  type BriefChart,
} from "@/src/lib/contracts/brief-charts";
import type {
  AdsPerformancePack,
  BusinessScorecard,
  MonthlyTouchPrepPack,
  ScorecardMetric,
  SeoPerformancePack,
} from "@/src/lib/mtos-data";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`FAILED: ${label}`);
}

// ---------------------------------------------------------------------------
// Fixtures: the smallest pack that still exercises a rule
// ---------------------------------------------------------------------------

function metric(
  label: string,
  value: number | null,
  previousValue: number | null = null,
  extra: Partial<ScorecardMetric> = {},
): ScorecardMetric {
  return {
    label,
    value,
    previousValue,
    availability: value === null ? "unavailable" : "available",
    source: "test",
    ...extra,
  };
}

function scorecard(overrides: Partial<BusinessScorecard> = {}): BusinessScorecard {
  return {
    // Every funnel metric carries the same window. The fixture used to give the period to
    // `totalLeads` alone, which is why the mixed-window funnel below reached a real client's brief
    // before anybody noticed: the test could not tell the difference.
    totalLeads: metric("Total leads", 40, 30, { period: "Last 30 days" }),
    qualifiedLeads: metric("Qualified leads", 24, 20, { period: "Last 30 days" }),
    costPerLead: metric("Cost per lead", 69, 74, { unit: "currency", period: "Last 30 days" }),
    callsAnswered: metric("Calls answered", 52, 50, { period: "Last 30 days" }),
    callsMissed: metric("Calls missed", 6, 11, { period: "Last 30 days" }),
    formSubmissions: metric("Form submissions", 7, 19, { period: "Last 30 days" }),
    bookedJobs: metric("Booked jobs", 17, 15, { period: "Last 30 days" }),
    shareOfLocalVoice: metric("Share of local voice", 31, 28, { unit: "percent" }),
    top3Coverage: metric("Top 3 coverage", 44, 40, { unit: "percent" }),
    mapCheckIns: metric("Map check-ins", 18, 12),
    hasSalesStructureData: true,
    ...overrides,
  };
}

function seo(overrides: Partial<SeoPerformancePack> = {}): SeoPerformancePack {
  return {
    heatmaps: [],
    matchedBusinesses: [],
    keywordScanHistory: [],
    heatmapGrids: [],
    checkinBusinesses: [],
    gbpPerformance: [],
    mapCheckInCount: null,
    availability: "available",
    notes: [],
    ...overrides,
  };
}

function pack(overrides: Partial<MonthlyTouchPrepPack> = {}): MonthlyTouchPrepPack {
  return {
    preparedAt: "2026-11-01T00:00:00.000Z",
    pipelineVersion: "test",
    clientSummary: "",
    schedule: { touchDate: "2026-11-10" },
    focusAreas: [],
    keyFacts: [],
    openCommitments: [],
    activeOpportunities: [],
    integrationSources: [],
    businessScorecard: scorecard(),
    seoPerformance: seo(),
    adsPerformance: [],
    ...overrides,
  } as MonthlyTouchPrepPack;
}

function find(charts: BriefChart[], id: string): BriefChart | undefined {
  return charts.find((chart) => chart.id === id);
}

// ---------------------------------------------------------------------------
// Direction: the arrow and the colour
// ---------------------------------------------------------------------------

check("more leads is good", deltaLine(40, 30, "count").tone === "good");
check("fewer leads is a risk", deltaLine(20, 30, "count").tone === "risk");
check("a cheaper lead is good even though the number fell", deltaLine(69, 74, "currency", true).tone === "good");
check("a dearer lead is a risk even though the number rose", deltaLine(80, 74, "currency", true).tone === "risk");
check("flat is muted, not green", deltaLine(30, 30, "count").tone === "muted");
check("flat says so, and says what it was", deltaLine(30, 30, "count").detail === "flat · was 30");

// The arrow describes the number's movement; the colour describes whether that is good news. On a
// cost that fell, the arrow points down and the colour is green, and both are correct.
const cheaper = deltaLine(69, 74, "currency", true);
check("a cost that fell shows a down arrow", cheaper.detail?.startsWith("▼") === true);
check("and a percentage against the previous figure", cheaper.detail?.includes("7%") === true);

check("no previous period means no delta line at all", deltaLine(40, null, "count").detail === undefined);
check("and no tone that implies a direction", deltaLine(40, null, "count").tone === "muted");

// A percentage of zero is not a number. From zero the line states the change itself.
const fromZero = deltaLine(5, 0, "count");
check("a rise from zero quotes the change, not a percentage", fromZero.detail?.includes("%") === false);
check("and still names the previous figure", fromZero.detail === "▲ 5 · was 0");

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

check("money is rounded and grouped", formatMetricValue(2140, "currency") === "$2,140");
check("money with cents keeps them", formatMetricValue(68.5, "currency") === "$68.50");
check("a percentage is whole", formatMetricValue(30.6, "percent") === "31%");
check("a count is grouped", formatMetricValue(3480, "count") === "3,480");
check("a fractional count keeps one place", formatMetricValue(6.24, "count") === "6.2");

// ---------------------------------------------------------------------------
// Nothing readable is nothing drawn
// ---------------------------------------------------------------------------

check("an empty pack draws nothing", deriveBriefCharts(undefined).length === 0);

const blank = deriveBriefCharts(
  pack({
    businessScorecard: scorecard({
      totalLeads: metric("Total leads", null),
      qualifiedLeads: metric("Qualified leads", null),
      bookedJobs: metric("Booked jobs", null),
      costPerLead: metric("Cost per lead", null),
      callsMissed: metric("Calls missed", null),
    }),
  }),
);
check("a scorecard nobody could read draws no snapshot card set", find(blank, "chart-snapshot") === undefined);
check("and no funnel", find(blank, "chart-funnel") === undefined);
check("and no lead-quality split", find(blank, "chart-lead-quality") === undefined);

// The important half of that: it is omission, not a zero.
const partial = deriveBriefCharts(
  pack({ businessScorecard: scorecard({ bookedJobs: metric("Booked jobs", null) }) }),
);
const snapshot = find(partial, "chart-snapshot");
check("a readable scorecard with one gap still draws", Boolean(snapshot));
check(
  "and the unreadable metric is absent rather than zero",
  snapshot?.cards?.some((card) => card.label === "Booked jobs") === false,
);
check("while the readable ones are there", (snapshot?.cards?.length || 0) === 3);
check(
  "no card anywhere claims a value of zero for a metric that was unavailable",
  partial.every((chart) => (chart.cards || []).every((card) => card.value !== "0" || card.detail !== undefined)),
);

// ---------------------------------------------------------------------------
// The funnel needs enough steps to be one
// ---------------------------------------------------------------------------

const twoSteps = deriveBriefCharts(
  pack({
    businessScorecard: scorecard({
      bookedJobs: metric("Booked jobs", null),
      callsMissed: metric("Calls missed", null),
    }),
  }),
);
check("two readable steps is not drawn as a funnel", find(twoSteps, "chart-funnel") === undefined);
const funnel = find(deriveBriefCharts(pack()), "chart-funnel");
check("four readable steps is", (funnel?.funnel?.length || 0) === 4);
check("missed calls carry the risk tone inside the funnel", funnel?.funnel?.at(-1)?.tone === "risk");
check("the funnel states the window all its steps share", funnel?.period === "Last 30 days");

// A funnel whose steps are on different clocks. Found on a real client's brief: 81 leads in the
// last 30 days sitting above 2,534 "qualified" opportunities counted since the account opened.
// That is not a narrowing funnel, it is two unrelated figures stacked, and an owner spots it
// instantly. The mismatched steps are dropped; the figures are still correct in the card set
// above, where each is labelled with its own window.
const mixedWindows = deriveBriefCharts(
  pack({
    businessScorecard: scorecard({
      totalLeads: metric("Total leads", 81, null, { period: "Last 30 days" }),
      qualifiedLeads: metric("Qualified leads", 2534, null, { period: "All time" }),
      bookedJobs: metric("Booked jobs", 8, null, { period: "All time" }),
      callsMissed: metric("Calls missed", null),
    }),
  }),
);
check("steps from different periods are not drawn as one funnel", find(mixedWindows, "chart-funnel") === undefined);

// Three steps that do share a window, but widen. Something is wrong with the data and we do not
// know what, so the chart goes rather than being drawn backwards.
const widening = deriveBriefCharts(
  pack({
    businessScorecard: scorecard({
      totalLeads: metric("Total leads", 20, null, { period: "Last 30 days" }),
      qualifiedLeads: metric("Qualified leads", 900, null, { period: "Last 30 days" }),
      bookedJobs: metric("Booked jobs", 4, null, { period: "Last 30 days" }),
    }),
  }),
);
check("a funnel that widens is not drawn at all", find(widening, "chart-funnel") === undefined);

// Equal stages are legitimate -- every lead qualified, every one booked -- and must still draw.
const flatFunnel = deriveBriefCharts(
  pack({
    businessScorecard: scorecard({
      totalLeads: metric("Total leads", 10, null, { period: "Last 30 days" }),
      qualifiedLeads: metric("Qualified leads", 10, null, { period: "Last 30 days" }),
      bookedJobs: metric("Booked jobs", 10, null, { period: "Last 30 days" }),
    }),
  }),
);
check("a funnel where nothing drops off still draws", find(flatFunnel, "chart-funnel") !== undefined);

// Missed calls is not a stage, so it may exceed the jobs booked without killing the chart.
const manyMissed = deriveBriefCharts(
  pack({
    businessScorecard: scorecard({
      totalLeads: metric("Total leads", 40, null, { period: "Last 30 days" }),
      qualifiedLeads: metric("Qualified leads", 20, null, { period: "Last 30 days" }),
      bookedJobs: metric("Booked jobs", 3, null, { period: "Last 30 days" }),
      callsMissed: metric("Calls missed", 31, null, { period: "Last 30 days" }),
    }),
  }),
);
check("missed calls above the jobs booked is still a funnel", find(manyMissed, "chart-funnel") !== undefined);
check(
  "and every step it draws narrows or holds, missed calls aside",
  (() => {
    const rows = (find(manyMissed, "chart-funnel")?.funnel || []).filter((row) => row.label !== "Calls missed");
    return rows.every((row, index) => index === 0 || row.value <= rows[index - 1].value);
  })(),
);

// ---------------------------------------------------------------------------
// Rank movement needs two real scans
// ---------------------------------------------------------------------------

const oneScan = deriveBriefCharts(
  pack({
    seoPerformance: seo({
      heatmaps: [
        {
          keyword: "dentist near me",
          location: "Main office",
          scanDate: "2026-10-30",
          averageRanking: 3.4,
          mapPackPercent: null,
          marketShare: null,
          trend: "up",
          imageUrl: "",
        } as SeoPerformancePack["heatmaps"][number],
      ],
      keywordScanHistory: [
        {
          keyword: "dentist near me",
          businessName: "Test",
          scans: [{ scanDate: "2026-10-30", averageRank: 3.4, top3Pins: null, marketSharePercent: null, notRankingPins: null, reportId: "a" }],
        },
      ],
    }),
  }),
);
check("a keyword scanned once is not compared against itself", find(oneScan, "chart-rank") === undefined);

const twoScans = deriveBriefCharts(
  pack({
    seoPerformance: seo({
      heatmaps: [
        {
          keyword: "dentist near me",
          location: "Main office",
          scanDate: "2026-10-30",
          averageRanking: 3.4,
          mapPackPercent: null,
          marketShare: null,
          trend: "up",
          imageUrl: "",
        } as SeoPerformancePack["heatmaps"][number],
      ],
      keywordScanHistory: [
        {
          keyword: "dentist near me",
          businessName: "Test",
          scans: [
            { scanDate: "2026-09-30", averageRank: 6.2, top3Pins: null, marketSharePercent: null, notRankingPins: null, reportId: "a" },
            { scanDate: "2026-10-30", averageRank: 3.4, top3Pins: null, marketSharePercent: null, notRankingPins: null, reportId: "b" },
          ],
        },
      ],
    }),
  }),
);
const rank = find(twoScans, "chart-rank");
check("two scans gives a movement row", (rank?.rank?.length || 0) === 1);
check("from the earlier scan", rank?.rank?.[0]?.from === 6.2);
check("to the latest average", rank?.rank?.[0]?.to === 3.4);
check("labelled with the keyword and the location", rank?.rank?.[0]?.label === "dentist near me · Main office");

// ---------------------------------------------------------------------------
// Ads: a channel that is not connected is not a channel that spent nothing
// ---------------------------------------------------------------------------

const channels: AdsPerformancePack[] = [
  {
    channel: "Google Ads",
    connected: true,
    spend: 2140,
    leads: 31,
    costPerLead: 69,
    ctr: 4,
    conversionRate: null,
    benchmarkNote: "",
  },
  {
    channel: "Meta Ads",
    connected: false,
    spend: null,
    leads: null,
    costPerLead: null,
    ctr: null,
    conversionRate: null,
    benchmarkNote: "",
  },
];
const ads = deriveBriefCharts(pack({ adsPerformance: channels }));
const adsCharts = ads.filter((chart) => chart.id.startsWith("chart-ads-"));
check("only the connected channel is drawn", adsCharts.length === 1);
check("and it is named as the channel", adsCharts[0]?.title === "Google Ads");
check("with its four figures", (adsCharts[0]?.cards?.length || 0) === 4);

// ---------------------------------------------------------------------------
// Placement: the chart sits above the words about it
// ---------------------------------------------------------------------------

const all = deriveBriefCharts(pack({ adsPerformance: channels }));
check("the snapshot card set belongs to section 3", find(all, "chart-snapshot")?.section === "3");
check("the funnel to section 9", find(all, "chart-funnel")?.section === "9");
check("the lead-quality split to section 10", find(all, "chart-lead-quality")?.section === "10");
check("every chart names a block to sit above", all.every((chart) => Number.isInteger(chart.at) && chart.at >= 0));
check("every chart carries at least one source", all.every((chart) => chart.chips.length > 0));
check("every chart has an id of its own", new Set(all.map((chart) => chart.id)).size === all.length);
check(
  "a section's charts come back in block order",
  (() => {
    const ordered = chartsForSection(all, "10");
    return ordered.every((chart, index) => index === 0 || chart.at >= ordered[index - 1]!.at);
  })(),
);
check("asking for a section with no charts gives none", chartsForSection(all, "4").length === 0);

// Section 11 is the goal, and nothing may invent its target.
check("no goal chart is derived, because no numeric goal is stored", all.every((chart) => chart.kind !== "goal"));
check("and so nothing claims section 11", all.every((chart) => chart.section !== "11"));

// ---------------------------------------------------------------------------
// The lead-quality split has to be a split
// ---------------------------------------------------------------------------

const split = find(all, "chart-lead-quality");
check("qualified and the rest add up to the total", (split?.stack || []).reduce((sum, seg) => sum + seg.value, 0) === 40);
check("qualified is first", split?.stack?.[0]?.label === "Qualified");
const impossible = deriveBriefCharts(
  pack({ businessScorecard: scorecard({ qualifiedLeads: metric("Qualified leads", 55, 20) }) }),
);
check(
  "more qualified leads than leads is not drawn at all",
  find(impossible, "chart-lead-quality") === undefined,
);

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - whether the drawn SVG is legible, which is a screen to look at");
console.log("  - whether a real client's pack has the fields these fixtures do, which needs Firestore");
if (failed) process.exit(1);
