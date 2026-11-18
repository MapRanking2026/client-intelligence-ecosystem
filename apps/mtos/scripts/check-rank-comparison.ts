/**
 * Pins the keyword comparison slides: what may reach a client deck, and what it says.
 *
 * The feature exists because a rank change is the most persuasive thing on a Monthly Touch slide
 * and therefore the easiest to overstate. Four things are requirements rather than behaviour that
 * happens to work:
 *
 *   1. Only a comparison with an APPROVED original capture reaches the deck. A comparison with no
 *      image, or one with no provider source behind it, is dropped rather than drawn.
 *   2. The PowerPoint carries that same image. Until 18 November 2026 it redrew the pins from scan
 *      data, so the .pptx a client was sent showed MapRanking's drawing of a measurement while the
 *      in-app deck showed the measurement -- two different pictures of the same claim.
 *   3. A slide whose image could not be loaded says so. It never falls back to a drawn grid.
 *   4. Two scans that do not cover the same ground are never presented as a like-for-like change.
 *
 * Exercises the pure rules and a real .pptx build. The Firestore reads and the headless capture
 * are listed at the end of the run.
 *
 * Run with: npm run check:rank-comparison
 */
import JSZip from "jszip";

import { rankSummary, sameRankGrid, withRankComparisons } from "@/src/lib/contracts/rank-comparison";
import { buildPptx } from "@/src/lib/server/services/pptx-builder";
import type {
  HeatmapGrid,
  Presentation,
  PresentationRankComparison,
  PresentationSlide,
} from "@/src/lib/mtos-data";

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

function scenario(name: string) {
  console.log(`\n${name}`);
}

function grid(options: { date: string; average: number | null; pins?: [number, number][] }): HeatmapGrid {
  return {
    keyword: "emergency plumber",
    scanDate: options.date,
    gridSize: 5,
    pins: (options.pins || [[33.4, -112.1], [33.5, -112.2]]).map(([lat, lng], index) => ({
      lat,
      lng,
      rank: index + 2,
    })),
    averageRankPosition: options.average,
    top3Percent: 40,
    shareOfLocalVoicePercent: 22,
    topCompetitors: [],
  };
}

function comparison(overrides: Partial<PresentationRankComparison> = {}): PresentationRankComparison {
  const previous = grid({ date: "2026-10-14T00:00:00.000Z", average: 8.4 });
  const current = grid({ date: "2026-11-14T00:00:00.000Z", average: 5.1 });
  return {
    nativeSource: { reportId: "a".repeat(24), heatmapId: "b".repeat(24), scanA: "c".repeat(24), scanB: "d".repeat(24) },
    originalImage: { id: "e".repeat(64), touchId: "touch-1", width: 1600, height: 600, mimeType: "image/png" },
    keyword: "emergency plumber",
    businessId: "biz-1",
    businessName: "Acme Plumbing",
    address: "100 Main St, Phoenix AZ",
    current: { reportId: "scan-current", grid: current },
    previous: { reportId: "scan-previous", grid: previous },
    baselineLabel: "Dates selected and reviewed by the account manager",
    sameGrid: true,
    ...overrides,
  };
}

function deck(slides: PresentationSlide[]): Presentation {
  return {
    status: "generated",
    clientName: "Acme Plumbing",
    periodLabel: "November 2026",
    title: "Monthly Touch",
    slides,
  } as Presentation;
}

/** A one-pixel PNG: real bytes, so the zip and its content types are exercised honestly. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

scenario("Only approved original captures reach the deck");
{
  const base = deck([
    { layout: "bullets", section: "SEO", title: "Emergency plumber is moving", bullets: ["Grid improved"] } as PresentationSlide,
    { layout: "closing", section: "", title: "Thank you" } as PresentationSlide,
  ]);
  const withImage = withRankComparisons(base, [comparison()]);
  check(
    "a comparison with an approved image gets a slide",
    withImage.slides!.filter((slide) => slide.layout === "rank_comparison").length === 1,
  );
  check(
    "the slide follows the keyword it belongs to",
    withImage.slides![1].layout === "rank_comparison",
    withImage.slides!.map((slide) => slide.layout).join(","),
  );
  check(
    "a comparison with no capture is dropped",
    withRankComparisons(base, [comparison({ originalImage: undefined })]).slides!.every(
      (slide) => slide.layout !== "rank_comparison",
    ),
  );
  check(
    "a comparison with no provider source is dropped",
    withRankComparisons(base, [comparison({ nativeSource: undefined })]).slides!.every(
      (slide) => slide.layout !== "rank_comparison",
    ),
  );
  const unmatched = withRankComparisons(deck([{ layout: "closing", section: "", title: "Thank you" } as PresentationSlide]), [
    comparison(),
  ]);
  check(
    "with no matching keyword slide it lands before the closing",
    unmatched.slides![0].layout === "rank_comparison" && unmatched.slides![1].layout === "closing",
  );
  const twice = withRankComparisons(withImage, [comparison()]);
  check(
    "re-running replaces its slide rather than stacking a second",
    twice.slides!.filter((slide) => slide.layout === "rank_comparison").length === 1,
  );
}

scenario("What the slide claims");
{
  check("an improvement is stated in positions", rankSummary(comparison()).includes("3.3 positions better"), rankSummary(comparison()));
  check(
    "a different grid refuses the like-for-like claim",
    rankSummary(comparison({ sameGrid: false })).includes("compare with care"),
  );
  check(
    "no baseline is said plainly",
    rankSummary(comparison({ previous: undefined })).includes("No verified prior-month scan"),
  );
}

scenario("Whether two scans cover the same ground");
{
  const a = grid({ date: "2026-10-14T00:00:00.000Z", average: 8 });
  const b = grid({ date: "2026-11-14T00:00:00.000Z", average: 5 });
  check("the same pin positions match", sameRankGrid(a, b));
  check(
    "a moved pin does not",
    !sameRankGrid(a, grid({ date: "2026-11-14T00:00:00.000Z", average: 5, pins: [[33.4, -112.1], [34.9, -111.0]] })),
  );
  check("an empty grid never matches", !sameRankGrid(grid({ date: "x", average: null, pins: [] }), b));
}

/** The .pptx scenario reads the built zip back, so it runs inside an async entry point. */
async function pptxScenario() {
  scenario("The PowerPoint carries the original image");
  const slides = withRankComparisons(
    deck([
      { layout: "bullets", section: "SEO", title: "Emergency plumber", bullets: ["Grid improved"] } as PresentationSlide,
      { layout: "closing", section: "", title: "Thank you" } as PresentationSlide,
    ]),
    [comparison()],
  );
  const index = slides.slides!.findIndex((slide) => slide.layout === "rank_comparison");
  const number = index + 1;

  const withBytes = await JSZip.loadAsync(
    await buildPptx(slides, null, new Map([["e".repeat(64), PNG]])),
  );
  const slideXml = await withBytes.file(`ppt/slides/slide${number}.xml`)!.async("string");
  const rels = await withBytes.file(`ppt/slides/_rels/slide${number}.xml.rels`)!.async("string");
  check("the image is in the package", Boolean(withBytes.file(`ppt/media/rank${number}.png`)));
  check("the slide points at it", slideXml.includes('r:embed="rId5"'));
  check("the relationship is declared", rels.includes(`../media/rank${number}.png`));
  check("no pins are redrawn", !slideXml.includes('prst="ellipse"'), "the deck is drawing its own map");
  check("the scan dates are stated", slideXml.includes("2026-10-14") && slideXml.includes("2026-11-14"));

  const without = await JSZip.loadAsync(await buildPptx(slides, null));
  const missingXml = await without.file(`ppt/slides/slide${number}.xml`)!.async("string");
  check("a missing capture leaves no image part", !without.file(`ppt/media/rank${number}.png`));
  check("and says so on the slide", missingXml.includes("not available"), missingXml.slice(0, 200));
  check("and still does not draw a map", !missingXml.includes('prst="ellipse"'));
  check("and the deck still builds", missingXml.includes("emergency plumber"));
}

void pptxScenario().then(() => {
  console.log(`\n${checks - failures}/${checks} checks passed`);
  console.log(
    "\nNot covered here (needs Firestore/Rank Tracker):\n  - the headless Report Builder capture itself\n  - loading image chunks back out of Firestore\n  - the AM's approve step writing approvedRankComparisons",
  );
  if (failures) {
    process.exitCode = 1;
  }
});
