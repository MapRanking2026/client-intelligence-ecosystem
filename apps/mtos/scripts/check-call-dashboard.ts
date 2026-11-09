/**
 * The call dashboard's screen logic: filter tabs, rows, and the four kinds of nothing.
 *
 * The one most worth pinning is the difference between "we never pulled this client" and "we
 * pulled and the phone did not ring". They look identical -- an empty array -- and they ask the
 * reader to do opposite things. Telling an AM a month was quiet when nobody ever looked sends them
 * into a meeting to explain something that may not have happened.
 *
 * Second most worth pinning: a tab reading "Spam 48" still reads 48 after you click it.
 *
 *   npm run --silent check:call-dashboard
 */
import {
  buildCallTable,
  callerSubline,
  callersNote,
  formatCallDuration,
  formatCallTime,
  formatPhone,
  hasAnyFilter,
  numberFilterOptions,
  withLabelProvenance,
  type CallTableFilters,
} from "@/src/lib/contracts/call-dashboard";
import type { CallPeriod, CallRecord } from "@/src/lib/contracts/call-report";
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

const PERIOD: CallPeriod = { start: "2026-11-01T00:00:00.000Z", end: "2026-12-01T00:00:00.000Z" };
const NO_FILTERS: CallTableFilters = {};

function call(day: number, label: CallLabel, extra: Partial<CallRecord> = {}): CallRecord {
  return {
    id: extra.id ?? `c${day}-${label}-${extra.callerPhone ?? extra.contactId ?? ""}`,
    at: `2026-11-${String(day).padStart(2, "0")}T14:00:00.000Z`,
    label,
    ...extra,
  };
}

const CALLS: CallRecord[] = [
  call(1, "good", { callerPhone: "+14805550101", callerName: "Maria", durationSec: 134, calledNumber: "+14805559001", calledNumberName: "Main line" }),
  call(2, "good", { callerPhone: "+14805550101", durationSec: 60, calledNumber: "+14805559001", calledNumberName: "Main line" }),
  call(3, "missed", { callerPhone: "+14805550102", calledNumber: "+14805559001", calledNumberName: "Main line" }),
  call(4, "spam", { callerPhone: "+14805550103", durationSec: 3, calledNumber: "+14805559002", calledNumberName: "Google Ads" }),
  call(5, "unrelated", { callerPhone: "+14805550104", durationSec: 11, calledNumber: "+14805559002", calledNumberName: "Google Ads" }),
];

console.log("\nthe four kinds of nothing");
{
  const never = buildCallTable([], PERIOD, NO_FILTERS, { everPulled: false });
  check("never pulled is its own state", never.state === "never_pulled");
  check("and says nobody has looked, not that it was quiet", never.emptyBody!.includes("nobody has looked"));
  check("and does not offer to clear filters there is none of", !never.clearable);

  const quiet = buildCallTable([], PERIOD, NO_FILTERS, { everPulled: true });
  check("pulled but silent is a DIFFERENT state", quiet.state === "no_calls_in_period");
  check("and it is not the same sentence", quiet.emptyTitle !== never.emptyTitle);
  check("and it suggests a longer period", quiet.emptyBody!.includes("longer period"));

  const hidden = buildCallTable(CALLS, PERIOD, { label: "job_seeker" }, { everPulled: true });
  check("calls that exist but are all filtered out is a third state", hidden.state === "filtered_to_nothing");
  check("and only that state offers Clear filters", hidden.clearable);
  check("and it says calls DO exist", hidden.emptyBody!.includes("There are calls in this period"));
  check("and names the label that found none", hidden.emptyBody!.includes("job seeker"));

  const rows = buildCallTable(CALLS, PERIOD, NO_FILTERS, { everPulled: true });
  check("and having rows is not an empty state at all", rows.state === "rows");
  check("with no empty copy", rows.emptyTitle === undefined && rows.emptyBody === undefined);

  // The period boundary: a pull that found calls, but none in the chosen window.
  const outside = buildCallTable([call(1, "good")], { start: "2026-12-01T00:00:00.000Z", end: "2027-01-01T00:00:00.000Z" }, NO_FILTERS, { everPulled: true });
  check("calls outside the window read as a quiet window, not as never pulled", outside.state === "no_calls_in_period");
}

console.log("\nfilter tabs");
{
  const table = buildCallTable(CALLS, PERIOD, NO_FILTERS, { everPulled: true });
  check("there are six tabs: All plus the five labels", table.tabs.length === 6);
  check("All is first", table.tabs[0].key === "all");
  check("All counts every call", table.tabs[0].count === 5);
  check("All is active when nothing is chosen", table.tabs[0].active);
  check("Good counts two", table.tabs.find((tab) => tab.key === "good")!.count === 2);
  check("Missed counts one", table.tabs.find((tab) => tab.key === "missed")!.count === 1);
  check("a label nobody has is a real zero", table.tabs.find((tab) => tab.key === "job_seeker")!.count === 0);
  check("the counts add up to All", table.tabs.slice(1).reduce((sum, tab) => sum + tab.count, 0) === table.tabs[0].count);
  check("every tab has a readable name", table.tabs.every((tab) => !tab.label.includes("_")));
  check("every label tab carries its colour", table.tabs.slice(1).every((tab) => tab.tone!.startsWith("var(")));

  // The point: a tab you have clicked still tells you what the others hold.
  const filtered = buildCallTable(CALLS, PERIOD, { label: "good" }, { everPulled: true });
  check("choosing Good does not zero the other tabs", filtered.tabs.find((tab) => tab.key === "missed")!.count === 1);
  check("All still counts everything, so there is a way back", filtered.tabs[0].count === 5);
  check("Good is now the active tab", filtered.tabs.find((tab) => tab.key === "good")!.active);
  check("and All is not", !filtered.tabs[0].active);
  check("but only Good's rows are shown", filtered.rows.length === 2);

  // The number filter is a change of subject, so it DOES narrow the counts.
  const line = buildCallTable(CALLS, PERIOD, { number: "4805559002" }, { everPulled: true });
  check("filtering to a line narrows All to that line", line.tabs[0].count === 2);
  check("and narrows the label tabs with it", line.tabs.find((tab) => tab.key === "good")!.count === 0);
  check("and shows that line's rows", line.rows.length === 2);

  const both = buildCallTable(CALLS, PERIOD, { label: "spam", number: "4805559002" }, { everPulled: true });
  check("both filters together still work", both.rows.length === 1);
  check("and the label tabs stay narrowed to the line", both.tabs[0].count === 2);
}

console.log("\nrows");
{
  const table = buildCallTable(CALLS, PERIOD, NO_FILTERS, { everPulled: true });
  check("newest first", table.rows[0].at > table.rows[1].at);
  const maria = table.rows.find((row) => row.callerName === "Maria")!;
  check("a caller's name survives", maria.callerName === "Maria");
  check("the phone is formatted for reading", maria.callerPhone === "(480) 555-0101");
  check("the called line is formatted too", maria.calledNumber === "(480) 555-9001");
  check("and keeps its CRM name", maria.calledNumberName === "Main line");
  check("a duration reads as minutes and seconds", maria.duration === "2:14");
  check("a caller who rang twice says so", maria.callsFromThisCaller === 2);
  check("a caller who rang once says one", table.rows.find((row) => row.label === "spam")!.callsFromThisCaller === 1);

  const missed = table.rows.find((row) => row.label === "missed")!;
  check("a missed call has NO duration rather than 0:00", missed.duration === undefined);

  const noLine = buildCallTable([call(9, "good", { callerPhone: "+14805550109" })], PERIOD, NO_FILTERS, { everPulled: true });
  check("a call with no recorded line leaves the field absent", noLine.rows[0].calledNumber === undefined);
  check("and does not invent a name for it", noLine.rows[0].calledNumberName === undefined);

  const limited = buildCallTable(CALLS, PERIOD, NO_FILTERS, { everPulled: true, limit: 2 });
  check("a limit caps the rows", limited.rows.length === 2);
  check("but not the tab counts", limited.tabs[0].count === 5);
}

console.log("\nwhere a label came from");
{
  const leads: VerifiedLead[] = [
    {
      id: "c1-good-+14805550101",
      type: "call",
      channel: "gbp_call",
      status: "valid",
      category: "valid_new_lead",
      receivedAt: "2026-11-01T14:00:00.000Z",
      callDurationSec: 134,
      callStatus: "completed",
      recordingUrl: "https://example.com/r.mp3",
      topic: "Water heater",
      topicSummary: "Asked for a quote on a replacement water heater.",
    },
    {
      id: "c3-missed-+14805550102",
      type: "call",
      channel: "gbp_call",
      status: "valid",
      category: "valid_new_lead",
      receivedAt: "2026-11-03T14:00:00.000Z",
      callStatus: "voicemail",
      callLabel: "spam",
      labelSource: "manual",
      labelReason: "Same robocaller as last week.",
    },
  ];

  const table = withLabelProvenance(buildCallTable(CALLS, PERIOD, NO_FILTERS, { everPulled: true }), leads);
  const good = table.rows.find((row) => row.id === "c1-good-+14805550101")!;
  check("a rules-decided row is credited to the rule", good.source === "automatic");
  check("and says so in words", good.sourceName === "Automatic rule");
  check("and carries the reason", good.reason.length > 10);
  check("and its topic comes through", good.topic === "Water heater");
  check("and its recording, so Listen still works", good.recordingUrl === "https://example.com/r.mp3");
  check("and it is not marked overridden", !good.overridden);

  const byHand = table.rows.find((row) => row.id === "c3-missed-+14805550102")!;
  check("a hand-set label wins on the row", byHand.label === "spam");
  check("and is credited to the person, not the rule", byHand.source === "manual");
  check("shown as 'You'", byHand.sourceName === "You");
  check("with their own reason", byHand.reason === "Same robocaller as last week.");
  check("and the row offers to reset it", byHand.overridden);

  const unknown = withLabelProvenance(buildCallTable(CALLS, PERIOD, NO_FILTERS, { everPulled: true }), []);
  check("a row whose lead cannot be found keeps the automatic reading", unknown.rows[0].source === "automatic");
  check("and does not crash", unknown.rows.length === 5);

  // The gap found on live data: five calls had a hand-set VERDICT credited to the rule.
  const handVerdict = withLabelProvenance(
    buildCallTable([call(7, "good", { id: "hv", callerPhone: "+14805550107" })], PERIOD, NO_FILTERS, { everPulled: true }),
    [
      {
        id: "hv",
        type: "call",
        channel: "gbp_call",
        status: "flagged",
        category: "spam",
        receivedAt: "2026-11-07T14:00:00.000Z",
        callDurationSec: 300,
        callStatus: "completed",
        verdictSource: "manual",
      },
    ],
  );
  check(
    "a hand-set VERDICT also counts as overridden, so the person's work is not silently taken over",
    handVerdict.rows[0].overridden,
  );
  // And the who-decided-it column now agrees with the override flag. These two disagreeing is
  // what shipped until 9 November 2026: the row was flagged as overridden while the column read
  // "Automatic rule", which is the pair of readings most likely to get somebody's work reset.
  check(
    'the column credits the person rather than reading "Automatic rule"',
    handVerdict.rows[0].sourceName === "You" && handVerdict.rows[0].source === "manual",
  );
  check(
    "the override flag and the credit can no longer disagree",
    handVerdict.rows[0].overridden === (handVerdict.rows[0].source === "manual"),
  );
}

console.log("\nthe number filter's options");
{
  const options = numberFilterOptions(CALLS);
  check("one option per line that took a call", options.length === 2);
  check("busiest line first", options[0].count === 3);
  check("named from the CRM where there is a name", options[0].label.startsWith("Main line · "));
  check("and formatted for reading", options[0].label.includes("(480) 555-9001"));
  check("the value is the normalised number, so two spellings match", options[0].value === "4805559001");
  check("calls with no line produce no option", numberFilterOptions([call(1, "good")]).length === 0);
  check(
    "a line with no CRM name is shown by number alone, not as 'Unknown'",
    numberFilterOptions([call(1, "good", { calledNumber: "+14805559003" })])[0].label === "(480) 555-9003",
  );
}

console.log("\nformatting");
{
  check("42 seconds is 0:42", formatCallDuration(42) === "0:42");
  check("134 seconds is 2:14", formatCallDuration(134) === "2:14");
  check("an hour-long call keeps its hours", formatCallDuration(3930) === "1:05:30");
  check("60 seconds is 1:00, not 0:60", formatCallDuration(60) === "1:00");
  check("no duration is ABSENT, not 0:00", formatCallDuration(undefined) === undefined);
  check("and zero is too, because a missed call did not last no time", formatCallDuration(0) === undefined);
  check("a negative duration is absent as well", formatCallDuration(-5) === undefined);

  check("an instant reads as a date and a time", formatCallTime("2026-11-08T14:14:00.000Z") === "Nov 8, 2:14 PM");
  check("an unparseable instant says so rather than showing Invalid Date", formatCallTime("whenever") === "Date unavailable");

  check("a ten-digit number is bracketed", formatPhone("4805550101") === "(480) 555-0101");
  check("and so is one with a country code", formatPhone("+1 480 555 0101") === "(480) 555-0101");
  check("something that is not a phone number is left alone", formatPhone("ext. 4") === "ext. 4");
  check("nothing in, nothing out", formatPhone(undefined) === undefined);
}

console.log("\nthe callers note, which has to admit what it cannot know");
{
  const blind = callersNote(undefined, 0);
  check("with no earlier pull it says new and returning cannot be told apart", blind.includes("cannot be told apart"));
  check("and it always explains the 30-day rule", blind.includes("30 days"));
  const known = callersNote(12, 0);
  check("with an earlier pull it drops that caveat", !known.includes("cannot be told apart"));
  const orphans = callersNote(12, 3);
  check("and unattributable calls are owned up to", orphans.includes("3 call(s)"));
  check("saying they still count in the totals", orphans.includes("counted in the totals"));
}

console.log("\nsmall helpers");
{
  // The CRM stores the number as the name when it has no name for a caller, so a cell built from
  // `name || phone` with the phone underneath printed the same number twice.
  check("the number under the name is dropped when the name is that number", callerSubline("(415) 825-7214", "(415) 825-7214") === undefined);
  check("and when it is the same number spelled differently", callerSubline("+1 415-825-7214", "(415) 825-7214") === undefined);
  check("a real name keeps its number", callerSubline("Dana Reed", "(415) 825-7214") === "(415) 825-7214");
  check("no name, nothing underneath", callerSubline(undefined, "(415) 825-7214") === undefined);
  check("two unparseable names are not the same number", callerSubline("Mayfair", "Mayfair Ltd") === "Mayfair Ltd");
  check("no filters is no filters", !hasAnyFilter({}));
  check("a label counts as one", hasAnyFilter({ label: "good" }));
  check("a number counts as one", hasAnyFilter({ number: "4805559001" }));
}

console.log(
  [
    "",
    "Not covered by these checks: whether the screen is legible (a browser and a pair of eyes),",
    "whether the time zone shown is the one the AM wants (these format in UTC, matching the",
    "buckets, and nothing in MTOS stores a client's zone yet), and whether a label a person set is",
    "the right one -- that needs somebody listening to the recording.",
    "",
    `${passed} passed, ${failed} failed`,
  ].join("\n"),
);

if (failed) {
  process.exit(1);
}
