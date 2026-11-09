/**
 * The call dashboard's arithmetic: periods, deltas, the donut, the columns, the 30-day caller
 * cycle, the per-number breakdown and the comparison table.
 *
 * What is most worth pinning here is not that the sums add up -- it is the three refusals. A
 * falling missed-call count must read as GOOD NEWS. A percentage change against a zero must be
 * ABSENT, not "+100%". A rate over no calls must be ABSENT, not 0%. Each of those, got wrong,
 * produces a confident number in front of a client that nobody can defend.
 *
 *   npm run --silent check:call-report
 */
import {
  CALLER_CYCLE_DAYS,
  bucketSizeForPeriod,
  callMix,
  callsByNumber,
  callsInPeriod,
  callsOverTime,
  compareNumbers,
  comparisonMeasures,
  comparisonPeriod,
  countByLabel,
  describeChange,
  hasCallEvidence,
  headlineTiles,
  isWithinPeriod,
  normalisePhone,
  periodDays,
  resolvePeriod,
  summariseCallers,
  toCallRecords,
  zeroLabelCounts,
  type CallPeriod,
  type CallRecord,
} from "@/src/lib/contracts/call-report";
import type { CallLabel, VerifiedLead } from "@/src/lib/mtos-data";

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

const DAY_MS = 24 * 60 * 60 * 1000;

/** A call, as briefly as a test can say one. */
function call(
  at: string,
  label: CallLabel,
  extra: Partial<CallRecord> = {},
): CallRecord {
  return { id: `${at}-${label}-${extra.contactId ?? extra.callerPhone ?? ""}`, at, label, ...extra };
}

const NOW = new Date("2026-11-08T15:30:00.000Z");

console.log("\nperiods a toolbar can ask for");
{
  const thirty = resolvePeriod("last_30_days", NOW);
  check("the last 30 days is 30 days long", periodDays(thirty) === 30);
  check("and runs to the end of today, not to this minute", thirty.end === "2026-11-09T00:00:00.000Z");
  check("and starts at a midnight", thirty.start === "2026-10-10T00:00:00.000Z");
  check("the last 7 days is 7 days long", periodDays(resolvePeriod("last_7_days", NOW)) === 7);
  check("the last 90 days is 90 days long", periodDays(resolvePeriod("last_90_days", NOW)) === 90);

  const thisMonth = resolvePeriod("this_month", NOW);
  check("this month starts on the 1st", thisMonth.start === "2026-11-01T00:00:00.000Z");

  const lastMonth = resolvePeriod("last_month", NOW);
  check("last month is the whole of October", lastMonth.start === "2026-10-01T00:00:00.000Z");
  check("and ends where November begins", lastMonth.end === "2026-11-01T00:00:00.000Z");
  check("so last month is 31 days", periodDays(lastMonth) === 31);

  const custom = resolvePeriod("custom", NOW, { since: "2026-09-01", until: "2026-09-30" });
  check("a custom range pulls in the end day whole", custom.end === "2026-10-01T00:00:00.000Z");
  check("and is 30 days", periodDays(custom) === 30);

  check(
    "a custom range with no dates falls back to 30 days rather than throwing",
    periodDays(resolvePeriod("custom", NOW, {})) === 30,
  );
  check(
    "a backwards custom range falls back too",
    periodDays(resolvePeriod("custom", NOW, { since: "2026-09-30", until: "2026-09-01" })) === 30,
  );
  check(
    "an unparseable date falls back",
    periodDays(resolvePeriod("custom", NOW, { since: "not a date" })) === 30,
  );
}

console.log("\nwhat we compare against");
{
  const period = resolvePeriod("last_30_days", NOW);

  const before = comparisonPeriod(period, "previous_period")!;
  check("the period just before is the same length", periodDays(before) === periodDays(period));
  check("and ends exactly where this one starts", before.end === period.start);
  check(
    "so the two windows cannot share a single call",
    Date.parse(before.end) <= Date.parse(period.start),
  );

  const lastYear = comparisonPeriod(period, "same_period_last_year")!;
  check("the same dates last year keeps the day", lastYear.start === "2025-10-10T00:00:00.000Z");
  check("and the same length", periodDays(lastYear) === 30);

  check("no comparison means no window", comparisonPeriod(period, "none") === undefined);
  check(
    "a custom comparison is used as given",
    comparisonPeriod(period, "custom", { start: "2026-01-01T00:00:00.000Z", end: "2026-02-01T00:00:00.000Z" })
      ?.start === "2026-01-01T00:00:00.000Z",
  );
  check(
    "a backwards custom comparison is refused rather than inverted",
    comparisonPeriod(period, "custom", { start: "2026-02-01T00:00:00.000Z", end: "2026-01-01T00:00:00.000Z" }) ===
      undefined,
  );

  // Half-open, so a call at the boundary belongs to exactly one window.
  check("a call at the start instant is inside", isWithinPeriod(period.start, period));
  check("a call at the end instant is outside", !isWithinPeriod(period.end, period));
  check("a call with no timestamp is in no period", !isWithinPeriod(undefined, period));
  check("an unparseable timestamp is in no period", !isWithinPeriod("whenever", period));
}

console.log("\nwhich way is good news -- the point of the file");
{
  // Good calls: up is good.
  const goodUp = describeChange(40, 30, true)!;
  check("more good calls is an improvement", goodUp.good === true);
  check("and the direction is up", goodUp.direction === "up");
  check("and the percentage is a third", Math.abs(goodUp.percent! - 1 / 3) < 1e-9);

  // Missed calls: DOWN is good. This is the one that paints the wrong arrow if it is wrong.
  const missedDown = describeChange(10, 30, false)!;
  check("FEWER missed calls is an improvement", missedDown.good === true);
  check("even though the direction is down", missedDown.direction === "down");
  const missedUp = describeChange(30, 10, false)!;
  check("MORE missed calls is NOT an improvement", missedUp.good === false);
  check("even though the number went up", missedUp.direction === "up");

  const flat = describeChange(12, 12, true)!;
  check("nothing moved, so nothing is good or bad", flat.good === undefined);
  check("and the direction says flat", flat.direction === "flat");
  check("and the absolute change is zero", flat.absolute === 0);

  check("no earlier figure means no delta at all", describeChange(12, undefined, true) === undefined);
  check(
    "a change from zero has no percentage",
    describeChange(7, 0, true)!.percent === undefined,
  );
  check("but it still has an absolute and a direction", describeChange(7, 0, true)!.absolute === 7);
  check("a fall to zero is a full fall", describeChange(0, 8, true)!.percent === -1);
}

console.log("\nthe six headline tiles");
{
  const current = [
    call("2026-11-01T10:00:00.000Z", "good"),
    call("2026-11-02T10:00:00.000Z", "good"),
    call("2026-11-03T10:00:00.000Z", "missed"),
    call("2026-11-04T10:00:00.000Z", "spam"),
  ];
  const previous = [
    call("2026-10-01T10:00:00.000Z", "good"),
    call("2026-10-02T10:00:00.000Z", "missed"),
    call("2026-10-03T10:00:00.000Z", "missed"),
  ];

  const tiles = headlineTiles(current, previous);
  check("there are six tiles", tiles.length === 6);
  check("the first is the total", tiles[0].key === "total" && tiles[0].value === 4);
  check("and its order is total, good, missed, spam, job seeker, unrelated",
    tiles.map((tile) => tile.key).join(",") === "total,good,missed,spam,job_seeker,unrelated");

  const good = tiles.find((tile) => tile.key === "good")!;
  check("good calls doubled", good.value === 2 && good.previous === 1);
  check("which is good news", good.change?.good === true);

  const missed = tiles.find((tile) => tile.key === "missed")!;
  check("missed calls halved", missed.value === 1 && missed.previous === 2);
  check("which is ALSO good news", missed.change?.good === true);
  check("and the tile knows a rise would be bad", missed.goodWhenRising === false);

  const jobSeeker = tiles.find((tile) => tile.key === "job_seeker")!;
  check("a label that never occurred is a real zero, not absent", jobSeeker.value === 0);
  check("and it compares against zero cleanly", jobSeeker.change?.direction === "flat");

  const alone = headlineTiles(current);
  check("with no comparison, no tile has a previous", alone.every((tile) => tile.previous === undefined));
  check("and no tile has a delta", alone.every((tile) => tile.change === undefined));
  check("but every tile still has its figure", alone[0].value === 4);

  const empty = headlineTiles([]);
  check("an empty period gives six zeroes, not a crash", empty.length === 6 && empty.every((tile) => tile.value === 0));

  check("every tile has a display name", tiles.every((tile) => tile.label.length > 0));
  check("no display name is a snake_case internal", tiles.every((tile) => !tile.label.includes("_")));
}

console.log("\nthe call-mix donut");
{
  const mix = callMix([
    call("2026-11-01T10:00:00.000Z", "good"),
    call("2026-11-02T10:00:00.000Z", "good"),
    call("2026-11-03T10:00:00.000Z", "good"),
    call("2026-11-04T10:00:00.000Z", "missed"),
  ]);
  check("the total is every call", mix.total === 4);
  check("only labels that occurred get a slice", mix.slices.length === 2);
  check("the biggest slice is first", mix.slices[0].label === "good");
  check("shares sum to exactly one", Math.abs(mix.slices.reduce((sum, slice) => sum + slice.share, 0) - 1) < 1e-9);
  check("the good-call rate is three quarters", mix.goodCallRate === 0.75);
  check("every slice carries a colour", mix.slices.every((slice) => slice.tone.startsWith("var(")));
  check("and a display name", mix.slices.every((slice) => !slice.name.includes("_")));

  const quiet = callMix([]);
  check("no calls means no slices", quiet.slices.length === 0);
  check("and the good-call rate is ABSENT, not 0%", quiet.goodCallRate === undefined);

  const allBad = callMix([call("2026-11-01T10:00:00.000Z", "spam")]);
  check("a month of nothing but spam does have a rate, and it is zero", allBad.goodCallRate === 0);
}

console.log("\ncalls over time");
{
  const week: CallPeriod = { start: "2026-11-01T00:00:00.000Z", end: "2026-11-08T00:00:00.000Z" };
  check("a week is drawn daily", bucketSizeForPeriod(week) === "day");
  check("30 days is drawn daily", bucketSizeForPeriod(resolvePeriod("last_30_days", NOW)) === "day");
  check("90 days is drawn weekly", bucketSizeForPeriod(resolvePeriod("last_90_days", NOW)) === "week");
  check(
    "a year is drawn monthly",
    bucketSizeForPeriod({ start: "2025-11-08T00:00:00.000Z", end: "2026-11-08T00:00:00.000Z" }) === "month",
  );

  const daily = callsOverTime(
    [
      call("2026-11-01T09:00:00.000Z", "good"),
      call("2026-11-01T18:00:00.000Z", "missed"),
      call("2026-11-05T12:00:00.000Z", "good"),
      // Outside the window: must not be counted anywhere.
      call("2026-11-20T12:00:00.000Z", "good"),
    ],
    week,
  );
  check("a seven-day window gives seven columns", daily.buckets.length === 7);
  check("and says it is daily", daily.size === "day");
  check("the first column holds both of the 1st's calls", daily.buckets[0].total === 2);
  check("split by label", daily.buckets[0].counts.good === 1 && daily.buckets[0].counts.missed === 1);
  check("a quiet day is KEPT at zero, not dropped", daily.buckets[1].total === 0);
  check("the 5th holds its one call", daily.buckets[4].total === 1);
  check(
    "only calls inside the window are counted",
    daily.buckets.reduce((sum, bucket) => sum + bucket.total, 0) === 3,
  );
  check("every column has a short label", daily.buckets.every((bucket) => bucket.label.length > 0));
  check("and keys sort chronologically", [...daily.buckets.map((b) => b.key)].sort().join() === daily.buckets.map((b) => b.key).join());

  const weekly = callsOverTime([], resolvePeriod("last_90_days", NOW));
  check("90 days gives 13 or 14 weekly columns", weekly.buckets.length >= 13 && weekly.buckets.length <= 14);
  check("and no column is missing a start", weekly.buckets.every((bucket) => bucket.start.endsWith("T00:00:00.000Z")));

  const monthly = callsOverTime(
    [call("2026-03-15T12:00:00.000Z", "good")],
    { start: "2026-01-01T00:00:00.000Z", end: "2027-01-01T00:00:00.000Z" },
  );
  check("a year gives twelve monthly columns", monthly.buckets.length === 12);
  check("and March holds the call", monthly.buckets[2].total === 1);

  const broken = callsOverTime([], { start: "2026-11-08T00:00:00.000Z", end: "2026-11-01T00:00:00.000Z" });
  check("a backwards period gives no columns rather than hanging", broken.buckets.length === 0);
}

console.log(`\ncallers, counted once per ${CALLER_CYCLE_DAYS}-day cycle`);
{
  const base = Date.parse("2026-09-01T10:00:00.000Z");
  const at = (days: number) => new Date(base + days * DAY_MS).toISOString();

  // One person, four calls inside ten days: ONE caller, not four.
  const oneJob = summariseCallers([
    call(at(0), "good", { contactId: "c1", callerName: "Maria", callerPhone: "+1 (480) 555-0101" }),
    call(at(2), "good", { contactId: "c1" }),
    call(at(5), "missed", { contactId: "c1" }),
    call(at(9), "good", { contactId: "c1" }),
  ]);
  check("four calls about one job is ONE unique caller", oneJob.uniqueCallers === 1);
  check("and counts as a caller who rang again", oneJob.repeatCallers === 1);
  check("the row keeps all four calls", oneJob.rows[0].calls === 4);
  check("and one cycle holding four", oneJob.rows[0].cycles.length === 1 && oneJob.rows[0].cycles[0].calls === 4);
  check("the CRM contact makes them a saved caller", oneJob.savedCallers === 1);
  check("the row keeps the name", oneJob.rows[0].name === "Maria");

  // The same person coming back two months later is a second enquiry.
  const cameBack = summariseCallers([
    call(at(0), "good", { contactId: "c1" }),
    call(at(60), "good", { contactId: "c1" }),
  ]);
  check("a call two months later opens a second cycle", cameBack.uniqueCallers === 2);
  check("and neither cycle is a repeat", cameBack.repeatCallers === 0);
  check("but it is still one row in the table", cameBack.rows.length === 1);

  // The boundary itself.
  const dayBefore = summariseCallers([
    call(at(0), "good", { contactId: "c1" }),
    call(at(CALLER_CYCLE_DAYS - 1), "good", { contactId: "c1" }),
  ]);
  check(`a call on day ${CALLER_CYCLE_DAYS - 1} is still the same cycle`, dayBefore.uniqueCallers === 1);
  const dayOf = summariseCallers([
    call(at(0), "good", { contactId: "c1" }),
    call(at(CALLER_CYCLE_DAYS), "good", { contactId: "c1" }),
  ]);
  check(`a call on day ${CALLER_CYCLE_DAYS} opens a new one`, dayOf.uniqueCallers === 2);

  // Identity: a contact beats a number, and two spellings of a number are one caller.
  const twoSpellings = summariseCallers([
    call(at(0), "good", { callerPhone: "+1 (480) 555-0101" }),
    call(at(1), "good", { callerPhone: "4805550101" }),
  ]);
  check("two spellings of one number is one caller", twoSpellings.rows.length === 1);
  check("identified by phone, so not a saved caller", twoSpellings.savedCallers === 0);

  const anonymous = summariseCallers([
    call(at(0), "missed", {}),
    call(at(1), "missed", {}),
    call(at(2), "good", { contactId: "c9" }),
  ]);
  check("calls with no caller at all are counted separately", anonymous.unidentifiedCalls === 2);
  check("and are NOT lumped into one fake caller", anonymous.rows.length === 1);

  // New vs returning needs history, and says so when it has none.
  const noHistory = summariseCallers([call(at(0), "good", { contactId: "c1" })]);
  check("without earlier calls, new callers is ABSENT, not zero", noHistory.newCallers === undefined);
  check("and the row cannot say whether they are returning", noHistory.rows[0].returning === undefined);

  const withHistory = summariseCallers(
    [
      call(at(0), "good", { contactId: "c1" }),
      call(at(0), "good", { contactId: "c2" }),
    ],
    [call(at(-90), "good", { contactId: "c1" })],
  );
  check("with earlier calls, one of the two is new", withHistory.newCallers === 1);
  check("and the returning one is marked", withHistory.rows.some((row) => row.returning === true));

  const byPhoneHistory = summariseCallers(
    [call(at(0), "good", { callerPhone: "480-555-0101" })],
    [call(at(-40), "good", { callerPhone: "+14805550101" })],
  );
  check("history matches on the number too, not just the contact", byPhoneHistory.newCallers === 0);

  check("no calls gives no callers and no crash", summariseCallers([]).uniqueCallers === 0);
  check(
    "the table is ordered by who rang most",
    summariseCallers([
      call(at(0), "good", { contactId: "quiet" }),
      call(at(1), "good", { contactId: "busy" }),
      call(at(2), "good", { contactId: "busy" }),
    ]).rows[0].key === "contact:busy",
  );
}

console.log("\nby tracking number");
{
  const calls = [
    call("2026-11-01T10:00:00.000Z", "good", { calledNumber: "+14805550101", contactId: "c1" }),
    call("2026-11-02T10:00:00.000Z", "good", { calledNumber: "(480) 555-0101", contactId: "c2" }),
    call("2026-11-03T10:00:00.000Z", "missed", { calledNumber: "+14805550102", contactId: "c3" }),
  ];
  const known = [
    { phoneNumber: "+14805550101", friendlyName: "Main line" },
    { phoneNumber: "+14805550102", friendlyName: "Google Ads" },
    { phoneNumber: "+14805550103", friendlyName: "Yard sign" },
  ];

  const breakdown = callsByNumber(calls, known);
  check("three known lines give three blocks", breakdown.blocks.length === 3);
  check("the busiest line is first", breakdown.blocks[0].total === 2);
  check("two spellings of one line are ONE block", breakdown.blocks[0].phoneNumber.includes("480"));
  check("the CRM name is used", breakdown.blocks[0].friendlyName === "Main line");
  check("good calls are counted per line", breakdown.blocks[0].goodCalls === 2);
  check("unique callers are counted per line", breakdown.blocks[0].uniqueCallers === 2);
  check("the label bar is per line", breakdown.blocks[0].counts.good === 2 && breakdown.blocks[0].counts.missed === 0);
  const silent = breakdown.blocks.find((block) => block.phoneNumber === "+14805550103")!;
  check("a line that rang nobody is still shown, at zero", silent.total === 0);
  check("with its name", silent.friendlyName === "Yard sign");
  check("and no warning, because everything was known", breakdown.warning === undefined);

  const noList = callsByNumber(calls, []);
  check("with no CRM list the lines still appear", noList.blocks.length === 2);
  check("but there is a warning about the missing names", Boolean(noList.warning));
  check("that tells the user to reconnect", noList.warning!.includes("Reconnect GoHighLevel"));
  check("and no block pretends to have a name", noList.blocks.every((block) => block.friendlyName === undefined));

  // The live state of the stored data today: calls, but not one of them recorded a line.
  const oldPulls = callsByNumber(
    [call("2026-11-01T10:00:00.000Z", "good"), call("2026-11-02T10:00:00.000Z", "missed")],
    [],
  );
  check("calls with no line recorded give no blocks", oldPulls.blocks.length === 0);
  check("they are counted as such", oldPulls.callsWithoutNumber === 2);
  check("and the warning explains a refresh is needed", oldPulls.warning!.includes("refresh"));

  const partly = callsByNumber(
    [
      call("2026-11-01T10:00:00.000Z", "good", { calledNumber: "+14805550101" }),
      call("2026-11-02T10:00:00.000Z", "good"),
    ],
    known,
  );
  check("a mixture warns about the ones with no line", partly.warning!.startsWith("1 of these calls"));
  check("and says they still count in the totals", partly.warning!.includes("counted in the totals"));

  const nothing = callsByNumber([], known);
  check("no calls at all gives the known lines at zero and no warning", nothing.blocks.length === 3 && nothing.warning === undefined);

  check(
    "a name discovered on a call is used when the CRM gave none",
    callsByNumber([call("2026-11-01T10:00:00.000Z", "good", { calledNumber: "+14805550101", calledNumberName: "Main line" })], [])
      .blocks[0].friendlyName === "Main line",
  );
}

console.log("\nthe comparison tables");
{
  const current = [
    call("2026-11-01T10:00:00.000Z", "good", { contactId: "c1" }),
    call("2026-11-02T10:00:00.000Z", "good", { contactId: "c2" }),
    call("2026-11-03T10:00:00.000Z", "missed", { contactId: "c3" }),
  ];
  const previous = [
    call("2026-10-01T10:00:00.000Z", "good", { contactId: "c1" }),
    call("2026-10-02T10:00:00.000Z", "missed", { contactId: "c4" }),
    call("2026-10-03T10:00:00.000Z", "missed", { contactId: "c5" }),
    call("2026-10-04T10:00:00.000Z", "spam", { contactId: "c6" }),
  ];

  const rows = comparisonMeasures(current, previous);
  const byKey = new Map(rows.map((row) => [row.key, row]));
  check("the table covers the total and all five labels", ["total", "good", "missed", "spam", "job_seeker", "unrelated"].every((key) => byKey.has(key)));
  check("plus the good-call rate", byKey.has("good_rate"));
  check("plus the caller figures", byKey.has("unique_callers") && byKey.has("repeat_callers"));
  check("calls fell from 4 to 3", byKey.get("total")!.value === 3 && byKey.get("total")!.previous === 4);
  check("which is not good news", byKey.get("total")!.change?.good === false);
  check("missed calls fell, which IS good news", byKey.get("missed")!.change?.good === true);
  check("the good-call rate rose from 25% to about 67%", Math.abs(byKey.get("good_rate")!.value - 2 / 3) < 1e-9);
  check("and is flagged as a percentage", byKey.get("good_rate")!.format === "percent");
  check("counts are flagged as counts", byKey.get("total")!.format === "count");
  check("every row has a display name", rows.every((row) => row.label.length > 0 && !row.label.includes("_")));

  const alone = comparisonMeasures(current);
  check("with no comparison, no row has a delta", alone.every((row) => row.change === undefined));
  check("but the figures are all still there", alone.find((row) => row.key === "total")!.value === 3);

  const quiet = comparisonMeasures([], previous);
  check("an empty current period has NO good-call rate row", !quiet.some((row) => row.key === "good_rate"));
  check("and still reports its zeroes", quiet.find((row) => row.key === "total")!.value === 0);

  const known = [{ phoneNumber: "+14805550101", friendlyName: "Main line" }];
  const nowNumbers = callsByNumber(
    [call("2026-11-01T10:00:00.000Z", "good", { calledNumber: "+14805550101" })],
    known,
  );
  const thenNumbers = callsByNumber(
    [
      call("2026-10-01T10:00:00.000Z", "good", { calledNumber: "+14805550101" }),
      call("2026-10-02T10:00:00.000Z", "good", { calledNumber: "+14805550101" }),
      call("2026-10-03T10:00:00.000Z", "good", { calledNumber: "+14805559999" }),
    ],
    known,
  );

  const numberRows = compareNumbers(nowNumbers, thenNumbers);
  const main = numberRows.find((row) => row.phoneNumber.includes("0101"))!;
  check("a line's calls are compared across the windows", main.value === 1 && main.previous === 2);
  check("and the fall is not good news", main.change?.good === false);
  const vanished = numberRows.find((row) => row.phoneNumber.includes("9999"));
  check("a line that rang last period and not this one STILL APPEARS", Boolean(vanished));
  check("showing the drop to zero", vanished!.value === 0 && vanished!.previous === 1);
  check("and reading the drop as bad news", vanished!.change?.good === false);

  check(
    "with no comparison, no number row has a delta",
    compareNumbers(nowNumbers).every((row) => row.change === undefined && row.previous === undefined),
  );
}

console.log("\nturning stored leads into countable calls");
{
  const leads: VerifiedLead[] = [
    {
      id: "call-1",
      type: "call",
      channel: "gbp_call",
      status: "valid",
      category: "valid_new_lead",
      receivedAt: "2026-11-01T10:00:00.000Z",
      callDurationSec: 180,
      callStatus: "completed",
    },
    {
      id: "form-1",
      type: "form",
      channel: "organic_website",
      status: "valid",
      category: "valid_new_lead",
      receivedAt: "2026-11-01T11:00:00.000Z",
    },
    {
      id: "call-no-date",
      type: "call",
      channel: "direct",
      status: "valid",
      category: "valid_new_lead",
      callDurationSec: 60,
      callStatus: "completed",
    },
    {
      id: "call-bad-date",
      type: "call",
      channel: "direct",
      status: "valid",
      category: "valid_new_lead",
      receivedAt: "sometime last week",
    },
    {
      id: "call-manual",
      type: "call",
      channel: "direct",
      status: "valid",
      category: "valid_new_lead",
      receivedAt: "2026-11-02T10:00:00.000Z",
      callDurationSec: 300,
      callStatus: "completed",
      callLabel: "spam",
      labelSource: "manual",
    },
  ];

  const { calls, skippedNotCalls, skippedNoTimestamp, skippedNoCallEvidence } =
    toCallRecords(leads);
  check("only calls are counted", calls.length === 2);
  check("the form is reported as skipped", skippedNotCalls === 1);
  check("and so is the call with no usable timestamp", skippedNoTimestamp === 1);
  check("and the record with no call metadata at all", skippedNoCallEvidence === 1);
  check("a 180s call reads as good", calls.find((record) => record.id === "call-1")!.label === "good");
  check(
    "a hand-set label survives the conversion",
    calls.find((record) => record.id === "call-manual")!.label === "spam",
  );

  check("nothing in, nothing out", toCallRecords([]).calls.length === 0);

  // The live finding this guard exists for: 521 of 888 stored leads typed "call" carry no
  // duration, no status, no direction and no recording, and 303 of them were being counted as
  // MISSED calls purely because they had no duration. That inflated the missed-call rate from
  // about a third to about a half. The shape below is one of those records, verbatim in substance.
  const companionRecord: VerifiedLead = {
    id: "Mf2YeWqBNaPsfxotVJ1P",
    type: "call",
    channel: "unknown",
    status: "valid",
    category: "valid_new_lead",
    receivedAt: "2026-11-01T10:00:00.000Z",
    name: "Maria",
    phone: "+14805550101",
  };
  check("a record with no call metadata is not evidence of a call", !hasCallEvidence(companionRecord));
  check(
    "so it is not counted as a call",
    toCallRecords([companionRecord]).skippedNoCallEvidence === 1,
  );
  check("and it never reaches the figures", toCallRecords([companionRecord]).calls.length === 0);

  // Everything that IS evidence. A genuine missed call has no duration, so duration alone is not
  // the test -- a status, a direction, a recording, a transcript or a tracking line each count.
  const evidence: Array<[string, Partial<VerifiedLead>]> = [
    ["a duration", { callDurationSec: 42 }],
    ["a status", { callStatus: "voicemail" }],
    ["a direction", { callDirection: "inbound" }],
    ["a recording", { recordingUrl: "https://example.com/r.mp3" }],
    ["a transcript", { transcript: "hello?" }],
    ["a tracking line", { calledNumber: "+14805550101" }],
  ];
  for (const [what, fields] of evidence) {
    check(`${what} is evidence of a call`, hasCallEvidence({ ...companionRecord, ...fields }));
  }
  check(
    "a voicemail with no duration is still counted -- it is a real missed call",
    toCallRecords([{ ...companionRecord, callStatus: "voicemail" }]).calls.length === 1,
  );
  check(
    "and a no-answer with no stored verdict is labelled missed, not dropped",
    toCallRecords([
      { ...companionRecord, status: "needs_review", callStatus: "no-answer" },
    ]).calls[0].label === "missed",
  );

  // Pinned because it is surprising and because it moves the Missed figure: where a lead was
  // already vetted "valid / valid new lead", that stored verdict currently outranks a recorded
  // no-answer, so the call reads GOOD rather than MISSED. That is `resolveCallLabel`'s layer order
  // (contracts/call-labels.ts), shipped in Phase A and deliberately not changed here. Whether a
  // recorded no-answer -- a fact about the call -- should beat a judgement about the lead is the
  // owner's call, not this file's. Pinning it means the day that order changes, this says so.
  check(
    "a stored valid verdict currently outranks a recorded no-answer",
    toCallRecords([{ ...companionRecord, callStatus: "no-answer" }]).calls[0].label === "good",
  );
}

console.log("\nthe small shared helpers");
{
  const zero = zeroLabelCounts();
  check("zero counts cover all five labels", Object.keys(zero).length === 5);
  check("and start at zero", Object.values(zero).every((value) => value === 0));
  zero.good += 1;
  check("and are a fresh object each time", zeroLabelCounts().good === 0);

  check("counting by label adds up", countByLabel([call("2026-11-01T10:00:00.000Z", "good")]).good === 1);

  check("a US number normalises to ten digits", normalisePhone("+1 (480) 555-0101") === "4805550101");
  check("and matches a bare one", normalisePhone("4805550101") === "4805550101");
  check("a too-short number is not a number", normalisePhone("911") === undefined);
  check("and neither is nothing", normalisePhone(undefined) === undefined);

  const period: CallPeriod = { start: "2026-11-01T00:00:00.000Z", end: "2026-11-08T00:00:00.000Z" };
  check(
    "filtering to a period keeps only what is inside",
    callsInPeriod(
      [call("2026-11-03T10:00:00.000Z", "good"), call("2026-12-03T10:00:00.000Z", "good")],
      period,
    ).length === 1,
  );
}

console.log(
  [
    "",
    "Not covered by these checks: whether buckets fall on the right calendar day for a client in",
    "a non-UTC timezone (they are cut on UTC boundaries -- period totals are exact, a single day's",
    "column can be off by a call at the edges); whether GoHighLevel's own call list for a window",
    "matches ours; whether the comparison window actually has stored calls to compare against",
    "(that is a pull question, not an arithmetic one); and whether a caller who rings from two",
    "different numbers with no CRM contact is one person -- nothing in the data can say.",
    "",
    `${passed} passed, ${failed} failed`,
  ].join("\n"),
);

if (failed) {
  process.exit(1);
}
