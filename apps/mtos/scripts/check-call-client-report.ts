/**
 * The client report's own rules: what leaves the building, and what the figures say in words.
 *
 * The one most worth pinning is the recordings switch. It is not a cosmetic "hide the player" --
 * `toReportRows` must delete the authenticated URL itself, so that a component which forgets to
 * check the setting cannot put a customer's voice into a document somebody forwards. These checks
 * assert the field is *gone*, not merely unrendered.
 *
 * Second most worth pinning: a report says nothing about what was not measured. No comparison
 * means no comparison sentence; a quiet month gets no percentages; an unidentified caller is named
 * as unidentified rather than folded into a count of one.
 *
 *   npm run --silent check:call-client-report
 */
import {
  RECORDINGS_PER_BATCH,
  absentFigure,
  countRecordings,
  describeChangeInWords,
  formatShare,
  reportDateline,
  reportFooter,
  reportRecordings,
  reportSummaryLines,
  toReportRows,
} from "@/src/lib/contracts/call-client-report";
import type { CallTableRow } from "@/src/lib/contracts/call-dashboard";
import {
  callMix,
  describeChange,
  headlineTiles,
  summariseCallers,
  type CallPeriod,
  type CallRecord,
} from "@/src/lib/contracts/call-report";
import type { CallLabel } from "@/src/lib/mtos-data";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAILED: ${label}`);
  }
}

const PERIOD: CallPeriod = { start: "2026-11-01T00:00:00.000Z", end: "2026-12-01T00:00:00.000Z" };

function row(id: string, extra: Partial<CallTableRow> = {}): CallTableRow {
  return {
    id,
    when: "8 Nov, 2:14 pm",
    at: "2026-11-08T14:14:00.000Z",
    callsFromThisCaller: 1,
    label: "good",
    labelName: "Good",
    labelTone: "var(--good)",
    source: "automatic",
    sourceName: "Automatic rule",
    reason: "Answered and ran 20 seconds or more.",
    overridden: false,
    ...extra,
  };
}

function call(day: number, label: CallLabel, extra: Partial<CallRecord> = {}): CallRecord {
  return {
    id: `c${day}-${label}`,
    at: `2026-11-${String(day).padStart(2, "0")}T12:00:00.000Z`,
    label,
    ...extra,
  };
}

console.log("recordings are off until somebody turns them on");
{
  const rows = [
    row("a", { recordingUrl: "/api/clients/x/recording?messageId=1" }),
    row("b", { recordingUrl: "/api/clients/x/recording?messageId=2" }),
    row("c"),
  ];

  const off = toReportRows(rows, undefined);
  check("an unset setting is off", off.every((r) => r.recordingUrl === undefined));
  check("the URL is deleted, not merely unrendered", !JSON.stringify(off).includes("messageId"));

  const explicitlyOff = toReportRows(rows, false);
  check("false is off", explicitlyOff.every((r) => r.recordingUrl === undefined));

  const on = toReportRows(rows, true);
  check("true carries the two URLs through", on.filter((r) => r.recordingUrl).length === 2);
  check("and leaves the third without one", on[2].recordingUrl === undefined);

  check("the count is taken before the stripping", countRecordings(rows) === 2);
}

console.log("what the report drops on purpose");
{
  const [only] = toReportRows(
    [row("a", { source: "ai", sourceName: "AI review", reason: "The caller was selling SEO.", overridden: true })],
    true,
  );
  const keys = Object.keys(only);
  check("no source", !keys.includes("source"));
  check("no source name", !keys.includes("sourceName"));
  check("no reason", !keys.includes("reason"));
  check("no override flag", !keys.includes("overridden"));
  check("the label itself stays", only.labelName === "Good");
}

console.log("the caller cell");
{
  const [named] = toReportRows([row("a", { callerName: "Dana Reed", callerPhone: "(830) 555-0111" })], false);
  check("a name leads", named.caller === "Dana Reed");
  check("with the number underneath", named.callerPhone === "(830) 555-0111");

  const [numberOnly] = toReportRows([row("b", { callerPhone: "(830) 555-0112" })], false);
  check("a number alone leads", numberOnly.caller === "(830) 555-0112");
  check("and is not repeated underneath", numberOnly.callerPhone === undefined);

  // The CRM stores the number as the name when it has no name, which printed the number twice,
  // one line above the other. Live data on 9 November 2026: this was the usual row, not an edge.
  const [sameTwice] = toReportRows([row("d", { callerName: "(415) 825-7214", callerPhone: "(415) 825-7214" })], false);
  check("a name that IS the number is not printed twice", sameTwice.callerPhone === undefined);
  check("and the number still leads the cell", sameTwice.caller === "(415) 825-7214");
  const [spelled] = toReportRows([row("e", { callerName: "+1 415-825-7214", callerPhone: "(415) 825-7214" })], false);
  check("two spellings of one number count as the same number", spelled.callerPhone === undefined);

  const [neither] = toReportRows([row("c")], false);
  check('neither reads "Not recorded"', neither.caller === "Not recorded");
}

console.log("the recordings section");
{
  const rows = toReportRows([row("a", { recordingUrl: "/r/1" }), row("b", { recordingUrl: "/r/2" })], true);
  const on = reportRecordings(rows, true, 2);
  check("included", on.included);
  check("two players", on.rows.length === 2);
  check("twenty-five at a time", on.batchSize === RECORDINGS_PER_BATCH && RECORDINGS_PER_BATCH === 25);
  check("and says why they arrive in batches", (on.note || "").includes("25 at a time"));

  const offRows = toReportRows([row("a", { recordingUrl: "/r/1" }), row("b", { recordingUrl: "/r/2" })], false);
  const off = reportRecordings(offRows, false, 2);
  check("switched off, no players", off.rows.length === 0);
  check("but the count is still told", off.available === 2);
  check("and the omission is stated rather than silent", (off.note || "").includes("not part of this report"));
  check("without a URL anywhere in it", !JSON.stringify(off).includes("/r/"));

  const none = reportRecordings([], false, 0);
  check("a month with no recordings says nothing at all", none.note === undefined);
}

console.log("the summary paragraph");
{
  const calls = [
    ...Array.from({ length: 12 }, (_, i) => call(i + 1, "good", { contactId: `k${i}` })),
    ...Array.from({ length: 4 }, (_, i) => call(i + 1, "missed", { callerPhone: `830555010${i}` })),
    call(5, "spam", { callerPhone: "8305550200" }),
    call(6, "job_seeker", { callerPhone: "8305550201" }),
  ];
  const summary = reportSummaryLines({
    mix: callMix(calls),
    tiles: headlineTiles(calls),
    callers: summariseCallers(calls),
    periodLabel: "Last 30 days",
    comparisonLabel: undefined,
  });

  check("the headline counts the calls", summary.headline === "18 calls in last 30 days");
  check("the good-call rate is a whole percent", summary.goodCallRate === "67%");
  check("the good sentence leads", summary.lines[0].startsWith("12 of them"));
  check("the missed calls are not softened", summary.lines.some((l) => l.includes("rang out without being answered")));
  check(
    "spam and job seekers are grouped and named",
    summary.lines.some((l) => l.includes("2 were not enquiries") && l.includes("1 spam") && l.includes("1 job seeker")),
  );
  check("the callers are counted", summary.lines.some((l) => l.includes("different callers")));
  check("no comparison asked for, no comparison sentence", !summary.lines.some((l) => l.includes("than")));
  check("never more than five sentences", summary.lines.length <= 5);
}

console.log("a quiet period says so once, with no percentages");
{
  const summary = reportSummaryLines({
    mix: callMix([]),
    tiles: headlineTiles([]),
    callers: summariseCallers([]),
    periodLabel: "Last 7 days",
    comparisonLabel: "The previous 7 days",
  });
  check("one sentence", summary.lines.length === 1);
  check("no rate over nothing", summary.goodCallRate === undefined);
  check('the headline does not read "0 calls"', summary.headline === "No calls recorded");
  check(
    "and it names the other explanation rather than blaming the client",
    summary.lines[0].includes("tracking number that has stopped passing calls"),
  );
}

console.log("a month where nobody could be identified");
{
  const calls = Array.from({ length: 3 }, (_, i) => call(i + 1, "good"));
  const summary = reportSummaryLines({
    mix: callMix(calls),
    tiles: headlineTiles(calls),
    callers: summariseCallers(calls),
    periodLabel: "Last 30 days",
  });
  check(
    "says we could not tell who was calling",
    summary.lines.some((l) => l.includes("could not tell who was calling on 3")),
  );
  check(
    "and that they still count",
    summary.lines.some((l) => l.includes("counted in the total but not grouped")),
  );
}

console.log("the comparison, in words rather than arrows");
{
  const label = "The previous 30 days";
  check(
    "more calls is more calls",
    describeChangeInWords(describeChange(50, 38, true), "calls", label) ===
      "12 more calls than the previous 30 days.",
  );
  check(
    "fewer missed calls reads as fewer, not as a fall",
    describeChangeInWords(describeChange(4, 11, false), "missed calls", label) ===
      "7 fewer missed calls than the previous 30 days.",
  );
  check(
    "flat is flat",
    describeChangeInWords(describeChange(9, 9, true), "calls", label) ===
      "The same number of calls as the previous 30 days.",
  );
  check("nothing to compare against, nothing said", describeChangeInWords(undefined, "calls", label) === undefined);
}

console.log("shares, datelines and footers");
{
  check("a share rounds to a whole percent", formatShare(0.7489) === "75%");
  check("an absent share is absent, not zero", formatShare(undefined) === undefined);

  const dateline = reportDateline(PERIOD);
  check("the dateline opens on the first day", dateline.startsWith("November 1, 2026"));
  check(
    "and closes on the last day the figures cover, not the exclusive end",
    dateline.endsWith("November 30, 2026"),
  );

  check(
    "the footer says who and when",
    reportFooter("MapRanking", "2026-11-09T09:00:00.000Z") === "Prepared by MapRanking on November 9, 2026",
  );

  const absent = absentFigure("This pull did not capture which line the call came in on.");
  check("an absent figure is an em dash", absent.text === "—");
  check("with the reason attached", absent.title.includes("did not capture"));
}

console.log(
  [
    "",
    "Not covered by these checks: whether the printed page breaks in sensible places (that needs a",
    "printer or a print preview), whether the brand colours a tenant chose are legible on paper,",
    "and whether a client is entitled to hear the recordings -- that is a decision a person makes",
    "in Report Branding, and this file only enforces it once made.",
    "",
    `${passed} passed, ${failed} failed`,
  ].join("\n"),
);

if (failed) {
  process.exit(1);
}
