import {
  CALL_LABELS,
  CALL_LABEL_LABEL,
  CALL_LABEL_SOURCE_LABEL,
  CALL_LABEL_TONE,
  resolveCallLabel,
  type CallLabel,
  type CallLabelSource,
} from "@/src/lib/contracts/call-labels";
import {
  CALLER_CYCLE_DAYS,
  callsInPeriod,
  normalisePhone,
  type CallPeriod,
  type CallRecord,
} from "@/src/lib/contracts/call-report";
import type { VerifiedLead } from "@/src/lib/mtos-data";

/**
 * What the call dashboard's screen shows, decided here rather than in the components.
 *
 * `call-report.ts` does the counting. This does the *presenting*: which filter tabs exist and what
 * each one would show, how a row reads, and -- the part most worth having in one place -- which of
 * four different kinds of "nothing" the table is looking at.
 *
 * ## The four empty states are four different sentences
 *
 * They are identical on screen if nobody separates them, and each one asks the reader to do
 * something different:
 *
 * 1. **Never pulled.** We have never asked GoHighLevel about this client. → Run a pull.
 * 2. **Pulled, no calls in the window.** We asked and the phone did not ring. → Widen the period.
 * 3. **Calls exist, the filter hides them all.** → Clear the filters.
 * 4. **Rows.** Not empty at all.
 *
 * Collapsing 1 and 2 is the expensive one: "no calls this month" is a fact about the client, and
 * "we never looked" is a fact about us. Telling an AM the first when the second is true sends them
 * into a meeting to explain a quiet month that may not have been quiet.
 */

export type CallTableState = "never_pulled" | "no_calls_in_period" | "filtered_to_nothing" | "rows";

/** A filter tab above the table: everything, then one per label, each with its own count. */
export interface CallFilterTab {
  key: "all" | CallLabel;
  label: string;
  count: number;
  active: boolean;
  /** The tab's colour, so the tabs read as the same vocabulary as the tiles and the donut. */
  tone?: string;
}

/**
 * One row of the calls table.
 *
 * Every field is already a string the screen can print, except where absence has to stay visible:
 * an absent `calledNumber` renders as an em dash and must not be allowed to become "Unknown line",
 * which reads like a line that exists.
 */
export interface CallTableRow {
  id: string;
  /** "8 Nov, 2:14 pm" -- the local reading of the instant. */
  when: string;
  /** The raw instant, for sorting and for the row's `dateTime`. */
  at: string;
  callerName?: string;
  callerPhone?: string;
  /** How many times this caller rang inside the period. 1 means once. */
  callsFromThisCaller: number;
  calledNumber?: string;
  calledNumberName?: string;
  /** "2:14", or absent where no duration was recorded. */
  duration?: string;
  label: CallLabel;
  labelName: string;
  labelTone: string;
  source: CallLabelSource;
  sourceName: string;
  reason: string;
  topic?: string;
  topicSummary?: string;
  /** Present only where a recording exists. The screen plays it exactly as it always has. */
  recordingUrl?: string;
  /** True where somebody set this label by hand, so the row can offer to reset it. */
  overridden: boolean;
}

/** One option in the toolbar's number filter. */
export interface NumberFilterOption {
  /** The normalised value the filter matches on. */
  value: string;
  /** "Main line · (480) 555-0101", or just the number where the CRM gave no name. */
  label: string;
  count: number;
}

export interface CallDashboardTable {
  state: CallTableState;
  tabs: CallFilterTab[];
  rows: CallTableRow[];
  /** What to say above the table when there are no rows. Absent when there are. */
  emptyTitle?: string;
  emptyBody?: string;
  /** True when a filter is doing the hiding, so the screen can offer "Clear filters". */
  clearable: boolean;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** A duration as a reader says it: "0:42", "2:14", "1:05:30". Absent where none was recorded. */
export function formatCallDuration(seconds: number | undefined): string | undefined {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

/**
 * An instant as "8 Nov, 2:14 pm".
 *
 * Fixed to en-US and given an explicit time zone so the string is the same wherever it is
 * rendered. A server-rendered row that then disagrees with the browser's own formatting is the
 * hydration mismatch that makes a table flicker on load.
 */
export function formatCallTime(at: string, timeZone = "UTC"): string {
  const value = Date.parse(at);
  if (!Number.isFinite(value)) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}

/** A phone number as "(480) 555-0101", or unchanged when it is not ten digits. */
export function formatPhone(phone: string | undefined): string | undefined {
  if (!phone) return undefined;
  const digits = normalisePhone(phone);
  if (!digits || digits.length !== 10) return phone;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * The number to print UNDER the caller's name, or nothing.
 *
 * Where the CRM has no name for a caller it stores the number as the name, so a cell built from
 * `name || phone` with the phone repeated beneath prints "(415) 825-7214" twice, one above the
 * other. Live data on 9 November 2026: most callers on most clients have no CRM name, so this was
 * the usual row rather than an edge case.
 *
 * Only a pair of real, parseable numbers counts as a repeat. Two names that both fail to parse
 * are not equal just because neither is a phone number.
 */
export function callerSubline(name: string | undefined, phone: string | undefined): string | undefined {
  if (!name || !phone) return undefined;
  const a = normalisePhone(name);
  const b = normalisePhone(phone);
  if (a && b && a === b) return undefined;
  return phone;
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/** What the toolbar is currently filtering by. */
export interface CallTableFilters {
  label?: CallLabel;
  /** A normalised tracking number, as `NumberFilterOption.value`. */
  number?: string;
}

export function hasAnyFilter(filters: CallTableFilters): boolean {
  return Boolean(filters.label || filters.number);
}

/** Build the number filter's options from the calls themselves, busiest first. */
export function numberFilterOptions(calls: CallRecord[]): NumberFilterOption[] {
  const grouped = new Map<string, { label: string; count: number }>();
  for (const call of calls) {
    if (!call.calledNumber) continue;
    const value = normalisePhone(call.calledNumber) || call.calledNumber;
    const existing = grouped.get(value);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const pretty = formatPhone(call.calledNumber) || call.calledNumber;
    grouped.set(value, {
      label: call.calledNumberName ? `${call.calledNumberName} · ${pretty}` : pretty,
      count: 1,
    });
  }
  return [...grouped]
    .map(([value, entry]) => ({ value, ...entry }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * The whole table: its tabs, its rows, and which kind of nothing it is showing.
 *
 * ## The tab counts are deliberately not affected by the label filter
 *
 * A tab reading "Spam 48" has to keep reading 48 after you click it. Counting the labels *after*
 * applying the label filter would leave every other tab at zero the moment one was chosen, so the
 * tabs would stop being a way back. The number filter DOES narrow them, because that one is a
 * change of subject -- "this line's calls" -- rather than a view of the same set.
 *
 * `everPulled` is the one thing this cannot work out for itself: a client with no stored review and
 * a client whose stored review covers a silent month both arrive here as an empty array.
 */
export function buildCallTable(
  calls: CallRecord[],
  period: CallPeriod,
  filters: CallTableFilters,
  options: { everPulled: boolean; timeZone?: string; limit?: number } = { everPulled: true },
): CallDashboardTable {
  const inPeriod = callsInPeriod(calls, period);

  // The number filter changes the subject, so it applies before the counts.
  const subject = filters.number
    ? inPeriod.filter(
        (call) =>
          call.calledNumber && (normalisePhone(call.calledNumber) || call.calledNumber) === filters.number,
      )
    : inPeriod;

  const counts = subject.reduce<Record<string, number>>((acc, call) => {
    acc[call.label] = (acc[call.label] || 0) + 1;
    return acc;
  }, {});

  const tabs: CallFilterTab[] = [
    { key: "all", label: "All", count: subject.length, active: !filters.label },
    ...CALL_LABELS.map((label) => ({
      key: label,
      label: CALL_LABEL_LABEL[label],
      count: counts[label] || 0,
      active: filters.label === label,
      tone: CALL_LABEL_TONE[label],
    })),
  ];

  const shown = filters.label ? subject.filter((call) => call.label === filters.label) : subject;

  // How many times each caller rang inside the period, so a row can say "rang 3 times".
  const perCaller = new Map<string, number>();
  for (const call of subject) {
    const key = callerKey(call);
    if (!key) continue;
    perCaller.set(key, (perCaller.get(key) || 0) + 1);
  }

  const ordered = [...shown].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const limited = options.limit ? ordered.slice(0, options.limit) : ordered;

  const rows: CallTableRow[] = limited.map((call) => {
    const key = callerKey(call);
    return {
      id: call.id,
      at: call.at,
      when: formatCallTime(call.at, options.timeZone),
      callerName: call.callerName,
      callerPhone: formatPhone(call.callerPhone),
      callsFromThisCaller: (key && perCaller.get(key)) || 1,
      calledNumber: formatPhone(call.calledNumber),
      calledNumberName: call.calledNumberName,
      duration: formatCallDuration(call.durationSec),
      label: call.label,
      labelName: CALL_LABEL_LABEL[call.label],
      labelTone: CALL_LABEL_TONE[call.label],
      source: "automatic",
      sourceName: CALL_LABEL_SOURCE_LABEL.automatic,
      reason: "",
      overridden: false,
    };
  });

  const state: CallTableState = rows.length
    ? "rows"
    : !options.everPulled
      ? "never_pulled"
      : inPeriod.length === 0
        ? "no_calls_in_period"
        : "filtered_to_nothing";

  return {
    state,
    tabs,
    rows,
    clearable: state === "filtered_to_nothing",
    ...emptyCopy(state, filters),
  };
}

/** Everything that identifies a caller, same rule as the callers section. */
function callerKey(call: CallRecord): string | undefined {
  if (call.contactId) return `contact:${call.contactId}`;
  const phone = normalisePhone(call.callerPhone);
  return phone ? `phone:${phone}` : undefined;
}

function emptyCopy(
  state: CallTableState,
  filters: CallTableFilters,
): { emptyTitle?: string; emptyBody?: string } {
  switch (state) {
    case "never_pulled":
      return {
        emptyTitle: "No calls have been pulled for this client yet",
        emptyBody:
          "Nothing has been fetched from GoHighLevel, so this is not a quiet month — it is a client nobody has looked at. Run a pull to fill the dashboard.",
      };
    case "no_calls_in_period":
      return {
        emptyTitle: "No calls in this period",
        emptyBody:
          "The pull covered this window and found no calls. Try a longer period, or refresh if you were expecting some.",
      };
    case "filtered_to_nothing":
      return {
        emptyTitle: "No calls match these filters",
        emptyBody: filters.label
          ? `There are calls in this period, but none of them are ${CALL_LABEL_LABEL[filters.label].toLowerCase()}${filters.number ? " on this line" : ""}.`
          : "There are calls in this period, but none on this line.",
      };
    case "rows":
    default:
      return {};
  }
}

/**
 * Build the rows with their real label, source and reason.
 *
 * `buildCallTable` works on `CallRecord`, which has already lost the lead it came from -- and the
 * reason and the source live on the lead. Rather than widen `CallRecord` for the benefit of one
 * table, this takes the leads alongside and fills in what only they know. A row whose lead cannot
 * be found keeps the automatic reading, which is what it would have shown anyway.
 */
export function withLabelProvenance(
  table: CallDashboardTable,
  leads: VerifiedLead[],
): CallDashboardTable {
  const byId = new Map(leads.map((lead) => [lead.id, lead]));
  return {
    ...table,
    rows: table.rows.map((row) => {
      const lead = byId.get(row.id);
      if (!lead) return row;
      const resolved = resolveCallLabel(lead);
      return {
        ...row,
        label: resolved.label,
        labelName: CALL_LABEL_LABEL[resolved.label],
        labelTone: CALL_LABEL_TONE[resolved.label],
        source: resolved.source,
        sourceName: CALL_LABEL_SOURCE_LABEL[resolved.source],
        reason: resolved.reason,
        topic: lead.topic,
        topicSummary: lead.topicSummary,
        recordingUrl: lead.recordingUrl,
        overridden: lead.labelSource === "manual" || lead.verdictSource === "manual",
      };
    }),
  };
}

/** The sentence under the callers section, which has to admit what it cannot know. */
export function callersNote(newCallers: number | undefined, unidentifiedCalls: number): string {
  const parts = [
    `A caller counts once per ${CALLER_CYCLE_DAYS} days, so somebody ringing three times about one job is one caller.`,
  ];
  if (newCallers === undefined) {
    parts.push(
      "New and returning cannot be told apart here, because no pull covers the period before this one.",
    );
  }
  if (unidentifiedCalls > 0) {
    parts.push(
      `${unidentifiedCalls} call(s) carried neither a contact nor a number, so they are counted in the totals but belong to no caller.`,
    );
  }
  return parts.join(" ");
}
