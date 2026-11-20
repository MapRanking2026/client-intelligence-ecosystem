/**
 * Keeps the written brief readable: measurement series are summarised, not transcribed.
 *
 * The appendix under each brief section exists so the AM can check the numbers against records
 * rather than against the model's memory of them. Printed naively that is hundreds of bullets --
 * a Client's Book page where "scan Date / average Rank / top3Pins / report Id" repeats for every
 * scan of every keyword, and the actual brief is somewhere below it. The account's figures belong
 * in the charts and in a sentence; the raw series does not belong in the document at all.
 *
 * So this check measures two things a reader would: how long the appendix runs for a realistic
 * account, and whether the figures that matter survived the trim.
 *
 * Run with: npm run check:brief-evidence-brevity
 */
import { completePrepBrief, evidenceMarkdown, PREP_BRIEF_DEPTH_RULE } from "@/src/lib/contracts/prep-brief-quality";
import { namesProduct, withoutProductName } from "@/src/lib/contracts/client-book-page";
import type { ClientRecord, MonthlyTouchPrepPack } from "@/src/lib/mtos-data";

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${label}${detail ? ` - ${detail}` : ""}`);
}

function scenario(name: string) {
  console.log(`\n${name}`);
}

/** Six keywords, a year of scans each -- an ordinary account, not a pathological one. */
const keywordScanHistory = ["gynecologist near me", "endometriosis specialist los angeles", "obgyn los angeles", "womens health clinic", "fibroid treatment", "prenatal care near me"].map(
  (keyword, keywordIndex) => ({
    keyword,
    businessName: "Synthetic Women's Health",
    // Weekly scans running back a year: four of them land in the window the touch reviews, the
    // rest belong to touches that already happened.
    scans: Array.from({ length: 12 }, (_, index) => ({
      scanDate: new Date(Date.parse("2026-11-17T18:55:08.743Z") - index * 7 * 86400000).toISOString(),
      averageRank: 8.6 + index + keywordIndex,
      top3Pins: 9,
      marketSharePercent: 44 - index,
      notRankingPins: 11,
      reportId: `6afca30c6ae3d94f62a0276${index}`,
    })),
  }),
);

const seoPerformance = {
  notes: ["The north location scan is a week older than the rest."],
  keywordScanHistory,
  heatmapGrids: Array.from({ length: 6 }, (_, index) => ({
    keyword: "gynecologist near me",
    scanDate: `2026-11-${17 - index}T18:55:08.743Z`,
    gridSize: 13,
    averageRankPosition: 8.6,
    shareOfLocalVoicePercent: 44,
    top3Percent: 20,
    pins: Array.from({ length: 169 }, () => ({ lat: 34.05, lng: -118.24, rank: 4 })),
    topCompetitors: [{ name: "Competitor A", rating: 4.8, reviews: 212 }],
  })),
  matchedBusinesses: [{ businessId: "abc", businessName: "Synthetic Women's Health", address: "1 Main St", rating: 4.9, reviews: 112, placeId: "xyz", keywords: ["a", "b"] }],
  gbpPerformance: [{ locationId: "loc-1", periodStart: "2026-10-20", periodEnd: "2026-11-17", calls: 120, websiteClicks: 90, directionRequests: 45, searches: 800, mapViews: 640 }],
  checkinBusinesses: [{ businessName: "Synthetic Women's Health", totalPosts: 42, scheduledPosts: 6, connectedPlatforms: ["gbp"], lastPostAt: "2026-11-14", lastPostPlatform: "gbp", nextScheduledPostAt: null }],
  mapCheckInCount: 42,
};

const prep = {
  preparedAt: "2026-11-17T12:00:00Z",
  clientSummary: "Synthetic business context",
  schedule: { touchDate: "Nov 20, 2026" },
  keyFacts: ["Verified active service: local SEO"],
  integrationSources: [],
  openCommitments: [{ title: "Quarterly report", owner: "Internal team", status: "Open", dueDate: "Nov 10", category: "Map Ranking" }],
  completedCommitments: [],
  businessScorecard: { totalLeads: { label: "Leads", value: 12, previousValue: 20, availability: "available", source: "Synthetic source", period: "Fixture period" } },
  seoPerformance,
  adsPerformance: [],
  activeOpportunities: [],
  issuesAndSolutions: [],
  leadQualityQuestions: [],
  dataGaps: ["No verified revenue supplied"],
} as unknown as MonthlyTouchPrepPack;

const client = { name: "Synthetic Women's Health", summary: "Recorded context", industry: "Healthcare", goals: [], healthScore: null } as unknown as ClientRecord;

/** Fixed rather than "now", so the window this check measures does not move with the calendar. */
const AS_OF = Date.parse("2026-11-20T12:00:00Z");
const appendix = evidenceMarkdown({ seoAndGbp: seoPerformance, caveats: prep.dataGaps }, 0, AS_OF);

scenario("The scan history is a sentence, not a list");
{
  const dumped = keywordScanHistory.reduce((total, entry) => total + entry.scans.length, 0);
  check(`${dumped} scan records exist in the prep pack`, dumped === 72);
  check("none of them is written out as a record", !appendix.includes("not Ranking Pins") && !appendix.includes("top3Pins"), appendix.slice(0, 300));
  check("no report IDs reach the page", !/report ?Id/i.test(appendix) && !appendix.includes("6afca30c"));
  check("no place, business or location IDs either", !/place ?Id|business ?Id|location ?Id/i.test(appendix));
  check("the series says how much there is, and over what window", appendix.includes("6 records in the last 30 days"));
  check("and how fresh it is", appendix.includes("Nov 17, 2026"));
  check("the latest figure survives", appendix.includes("average rank 8.6"));
  check("so does the comparison across the window", appendix.includes("was 11.6 on Oct 27, 2026"), appendix.slice(appendix.indexOf("Rank Tracker"), appendix.indexOf("Rank Tracker") + 420));
  check("and the share of the market", appendix.includes("44% market share"));
  check("the keywords beyond the first few are counted, not listed", appendix.includes("The remaining 2 are in the charts"));
  check("the last keyword is not written out", !appendix.includes("prenatal care near me"));
}

scenario("Every other series too");
{
  check("grid scans are summarised", appendix.includes("13x13 grid") && appendix.includes("44% share of local voice"));
  check("the 169 pins behind each grid never appear", !appendix.includes("34.05") && !appendix.includes("-118.24"));
  check("Business Profile activity is one line", appendix.includes("120 calls") && appendix.includes("90 website clicks"));
  check("its period is named", appendix.includes("Oct 20, 2026 to Nov 17, 2026"));
  check("matched businesses keep their rating", appendix.includes("4.9 stars") && appendix.includes("112 reviews"));
  check("Map Check-Ins keeps its post count", appendix.includes("42 posts") && appendix.includes("last posted Nov 14, 2026"));
  check("the competitors ranking above us are named once", appendix.split("Competitor A").length === 2, appendix);
}

scenario("What is not a measurement series is untouched");
{
  check("a plain note is still written in full", appendix.includes("The north location scan is a week older than the rest."));
  check("so is a data gap", appendix.includes("No verified revenue supplied"));
  check("a scalar field keeps its label", appendix.includes("**map Check In Count:** 42"), appendix.slice(0, 200));
  const empty = evidenceMarkdown({ seoAndGbp: { keywordScanHistory: [] } });
  check("an empty series says so rather than vanishing", empty.includes("no records available"), empty);
}

scenario("It is short enough to read");
{
  const lines = appendix.split("\n").length;
  check(`the appendix is ${lines} lines, not hundreds`, lines < 40, String(lines));
  const brief = completePrepBrief(undefined, prep, client);
  const section = brief.sections.find((entry) => entry.id === "10")!;
  check("the performance section still has its evidence", section.markdown.includes("Rank Tracker keyword scans"));
  check("and it is not a transcription", !/report ?Id/i.test(section.markdown) && !section.markdown.includes("top3Pins"));
  check(
    `the whole brief is ${JSON.stringify(brief).length} characters`,
    JSON.stringify(brief).length < 12000,
    String(JSON.stringify(brief).length),
  );
}

scenario("Only the month this touch reviews");
{
  check("the scans outside the window are dropped", appendix.includes("4 scans to Nov 17, 2026"), appendix.slice(appendix.indexOf("Rank Tracker"), appendix.indexOf("Rank Tracker") + 200));
  check("nothing from a year ago survives", !appendix.includes("Nov 18, 2025") && !appendix.includes(", 12 scans"));
  // A grid series that stopped in the spring is the case this is really about: silence is the
  // finding, and last spring's numbers presented as this month's would be the lie.
  const stale = evidenceMarkdown(
    { seoAndGbp: { heatmapGrids: [{ keyword: "x", scanDate: "2026-05-02T00:00:00Z", gridSize: 13, averageRankPosition: 4 }] } },
    0,
    AS_OF,
  );
  check("a series that stopped months ago is not presented as current", !stale.includes("average rank 4"), stale);
  check("and the silence is the finding", stale.includes("nothing in the last 30 days"), stale);
  check("with the date of the last record", stale.includes("the most recent is May 2, 2026"), stale);
  check("a record dated ahead of the page is kept", evidenceMarkdown({ s: { heatmaps: [{ keyword: "x", scanDate: "2026-11-30T00:00:00Z", averageRanking: 3 }] } }, 0, AS_OF).includes("average rank 3"));
  check("the depth rule asks the model for the same window", /30 days before this touch/i.test(PREP_BRIEF_DEPTH_RULE));
}

scenario("The tool does not name itself on a client's page");
{
  check("the appendix never says it", !namesProduct(appendix), appendix.slice(0, 200));
  check("a missing value just says so", evidenceMarkdown({ value: "" }).includes("**value:** Not available."));
  check("and an empty list just says so", evidenceMarkdown({ rows: [] }).includes("No records available."));
  check(
    "the screenshot's line reads plainly now",
    withoutProductName("- **previous Value:** Not available in MTOS.") === "- **previous Value:** Not available.",
    withoutProductName("- **previous Value:** Not available in MTOS."),
  );
  check("a sentence that names it as a subject keeps its grammar", withoutProductName("MTOS has no record of this.") === "Map Ranking has no record of this.");
  check("a possessive becomes ours", withoutProductName("This is MTOS's own record.") === "This is our own record.");
  check("every other preposition goes too", withoutProductName("Nothing recorded on MTOS, nothing from MTOS.") === "Nothing recorded, nothing.");
  check("a page that never mentioned it is untouched", withoutProductName("The client asked for photos.") === "The client asked for photos.");
  check("the whole brief is clean", !namesProduct(JSON.stringify(completePrepBrief(undefined, prep, client))));
  check("the depth rule tells the model not to either", /never \"not available in MTOS\"/i.test(PREP_BRIEF_DEPTH_RULE));
}

scenario("The model is asked for this as well as held to it");
{
  check("the depth rule forbids transcribing the records", /do not list scan after scan/i.test(PREP_BRIEF_DEPTH_RULE));
  check("and forbids the identifiers", /report IDs/i.test(PREP_BRIEF_DEPTH_RULE));
  check("and points at the charts for the rest", /the charts carry the rest/i.test(PREP_BRIEF_DEPTH_RULE));
}

console.log(`\n${checks - failures}/${checks} checks passed`);
console.log(
  "\nNot covered here (needs an LLM provider):\n" +
    "  - whether the model obeys the same rule in the prose it writes above the appendix\n" +
    "  - the post-meeting notes prompt, which carries the rule but is only exercised against a live call",
);
if (failures) {
  process.exitCode = 1;
}
