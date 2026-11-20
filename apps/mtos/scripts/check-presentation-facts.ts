/**
 * No figure reaches a client slide that we cannot show a record for.
 *
 * The deck is written by a model from the evidence bundle, so nothing structural stopped it
 * writing a number that was close to the truth rather than the truth -- a market share of 43.2%
 * where the scan says 43.24%, a rank of 8.6 where the record says 8.63. The client opens the same
 * profile during the call and reads the real figure.
 *
 * The case this check exists for is the rounded one, because it is the one that looks right. A
 * fabricated number is usually obvious to whoever knows the account; a tidied one is not, and it
 * is just as wrong.
 *
 * Run with: npm run check:presentation-facts
 */
import {
  exactFigure,
  figuresIn,
  slideClientText,
  unverifiedFigureLines,
  unverifiedFigures,
  FACTUAL_FIGURES_RULE,
} from "@/src/lib/contracts/presentation-facts";
import type { Presentation } from "@/src/lib/mtos-data";

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

/** The shape of what the deck is written from, with the figures the records actually hold. */
const evidence = {
  seoPerformance: {
    keywordScanHistory: [
      {
        keyword: "obgyn near me",
        scans: [
          { scanDate: "2026-11-17T18:55:08.743Z", averageRank: 8.63, top3Pins: 10, marketSharePercent: 43.24 },
          { scanDate: "2026-10-22T14:42:25.008Z", averageRank: 13.81, top3Pins: 0, marketSharePercent: 14.78 },
        ],
      },
    ],
    gbpPerformance: [{ periodStart: "2026-10-22", periodEnd: "2026-11-17", calls: 1240, websiteClicks: 318 }],
  },
};

const deck = (slides: Presentation["slides"]): Presentation => ({ status: "generated", slides });

scenario("A slide that copies the records exactly");
{
  const found = unverifiedFigures(
    deck([
      {
        layout: "table",
        title: "Broader searches are moving too",
        table: {
          headers: ["Keyword", "Avg rank", "Top-3 pins", "Market share"],
          rows: [["obgyn near me", "13.81 → 8.63", "0 → 10", "14.78% → 43.24%"]],
        },
        footnote: "Rank Tracker, Oct 22 vs Nov 17, 2026.",
      },
      { layout: "stat_callouts", title: "Calls", stats: [{ value: "1,240", caption: "calls, 318 website clicks" }] },
    ] as Presentation["slides"]),
    evidence,
  );
  check("nothing is flagged", found.length === 0, JSON.stringify(found));
  check("a thousands separator is the same figure", figuresIn("1,240")[0] === "1240");
  check("and a trailing zero is too", figuresIn("43.20")[0] === figuresIn("43.2")[0]);
  check("a date in the footnote is held by the record it came from", !JSON.stringify(found).includes("22"));
}

scenario("The rounded figure -- the one that looks right");
{
  const found = unverifiedFigures(
    deck([
      {
        layout: "table",
        title: "Broader searches are moving too",
        table: { headers: ["Keyword", "Market share"], rows: [["obgyn near me", "14.7% → 43.2%"]] },
      },
    ] as Presentation["slides"]),
    evidence,
  );
  check("it is caught", found.length === 1, JSON.stringify(found));
  check("both tidied values are named", found[0].figures.includes("43.2") && found[0].figures.includes("14.7"), JSON.stringify(found[0]));
  check("the slide is named by its number", found[0].slide === 1);
  check("and by its title", found[0].title === "Broader searches are moving too");
  check(
    "the AM is told what to do about it",
    /not in this touch's evidence\. Check it against the source/i.test(unverifiedFigureLines(found)[0]),
    unverifiedFigureLines(found)[0],
  );
}

scenario("An invented figure");
{
  const found = unverifiedFigures(
    deck([{ layout: "bullets", title: "Results", bullets: ["Calls rose to 1,890 this month"] }] as Presentation["slides"]),
    evidence,
  );
  check("it is caught", found.length === 1 && found[0].figures.includes("1890"), JSON.stringify(found));
  check(
    "a derived percentage is treated the same way",
    unverifiedFigures(deck([{ layout: "bullets", title: "x", bullets: ["Up 193%"] }] as Presentation["slides"]), evidence).length === 1,
  );
}

scenario("What is not checked, and why");
{
  const internal = unverifiedFigures(
    deck([{ layout: "bullets", title: "Results", bullets: ["Calls were 1,240"], presenterNotes: "Mention the 9,999 we have not verified." }] as Presentation["slides"]),
    evidence,
  );
  check("presenter notes are internal and not scanned", internal.length === 0, JSON.stringify(internal));
  const server = unverifiedFigures(
    deck([{ layout: "rank_comparison", title: "obgyn near me", subtitle: "99.99 to 1.01" }] as Presentation["slides"]),
    evidence,
  );
  check("a server-built comparison is exempt", server.length === 0, JSON.stringify(server));
  check("the slide's own words are what gets read", slideClientText({ layout: "bullets", title: "A", bullets: ["B"] } as Presentation["slides"][number]).includes("A"));
}

scenario("Nothing is rounded on the way out");
{
  check("a market share keeps every digit", exactFigure(43.24) === "43.24");
  check("so does a rank", exactFigure(8.63) === "8.63");
  check("a long value is not shortened", exactFigure(12.3456) === "12.3456");
  check("a whole number stays whole", exactFigure(44) === "44");
  check("thousands stay legible", exactFigure(1240) === "1,240");
  check("and so do thousands with decimals", exactFigure(1240.5) === "1,240.5");
}

scenario("The model is asked for it before it is checked");
{
  check("the rule forbids rounding", /do not round/i.test(FACTUAL_FIGURES_RULE));
  check("it gives the example that matters", FACTUAL_FIGURES_RULE.includes("43.24%") && FACTUAL_FIGURES_RULE.includes("43.2%"));
  check("it forbids calculating a figure the evidence lacks", /do not\s+calculate a figure the evidence does not state/i.test(FACTUAL_FIGURES_RULE), FACTUAL_FIGURES_RULE);
  check("and says what to do instead", /say it is not available/i.test(FACTUAL_FIGURES_RULE));
}

console.log(`\n${checks - failures}/${checks} checks passed`);
console.log(
  "\nNot covered here (needs an LLM provider):\n" +
    "  - whether the model follows the rule without the check behind it\n" +
    "  - the spoken presenter script, which is generated separately and read aloud to the client",
);
if (failures) {
  process.exitCode = 1;
}
