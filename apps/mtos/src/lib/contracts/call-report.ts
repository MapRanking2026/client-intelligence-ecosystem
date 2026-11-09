import {
  CALL_LABELS,
  CALL_LABEL_LABEL,
  CALL_LABEL_TONE,
  moreIsBetter,
  resolveCallLabel,
  type CallLabel,
} from "@/src/lib/contracts/call-labels";
import type { LeadWindowPreset, VerifiedLead } from "@/src/lib/mtos-data";

/**
 * Everything the call dashboard counts, with no React and no Firestore in sight.
 *
 * The owner's specification (8 November 2026) asks for six headline tiles against a comparison
 * period, a call-mix donut, calls over time, a callers section counted on a 30-day cycle, a
 * breakdown per tracking number, and a measures table comparing two windows. All of that is
 * arithmetic over a list of calls, so it lives here where it can be checked by
 * `scripts/check-call-report.ts` without a browser, a tenant or a network call.
 *
 * ## Three rules this file keeps, inherited from the briefs and the scorecard
 *
 * 1. **Direction is per metric.** More good calls is an improvement; more missed calls is not.
 *    `moreIsBetter` decides, never the sign of the number. Getting this backwards paints a green
 *    arrow on a month that got worse, which is the one number a client quotes back at you.
 * 2. **No comparison means no delta.** Where there is nothing to compare against, `change` is
 *    absent and the tile shows the figure alone. It never shows "+100%" against a zero it invented.
 * 3. **A thing we did not measure is absent, not zero.** A good-call rate over no calls is
 *    undefined, not 0%. A caller count we cannot judge without earlier data is undefined, not 0.
 *    The screen renders an em dash for these; it must never be able to render a confident zero.
 *
 * ## What is deliberately not here
 *
 * Nothing in this file reads the clock. Every function takes the period it is asked about, so a
 * test can pin a window and get the same answer forever. `resolvePeriod` takes `now` as an
 * argument for the same reason.
 *
 * Day, week and month buckets are cut on **UTC** boundaries. For a client in Phoenix a call just
 * before midnight local can land in the next UTC day, so a single day's column can be off by a
 * call or two at the edges. Period totals are unaffected (the window is the window); only the
 * bucketing moves. Worth fixing the day the dashboard grows a timezone setting, not worth
 * inventing one now.
 */

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

/** A half-open window `[start, end)` as ISO instants. Half-open so adjacent periods cannot overlap. */
export interface CallPeriod {
  start: string;
  end: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC at the start of the day this instant falls in. */
function startOfUtcDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/** The window a toolbar preset means, relative to `now`. */
export function resolvePeriod(
  preset: LeadWindowPreset,
  now: Date,
  custom?: { since?: string; until?: string },
): CallPeriod {
  const today = startOfUtcDay(now);
  const tomorrow = new Date(today.getTime() + DAY_MS);

  const lastDays = (days: number): CallPeriod => ({
    start: new Date(tomorrow.getTime() - days * DAY_MS).toISOString(),
    end: tomorrow.toISOString(),
  });

  switch (preset) {
    case "last_7_days":
      return lastDays(7);
    case "last_90_days":
      return lastDays(90);
    case "this_month":
      return {
        start: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString(),
        end: tomorrow.toISOString(),
      };
    case "last_month":
      return {
        start: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)).toISOString(),
        end: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString(),
      };
    case "custom": {
      // A custom range is given as inclusive calendar days, so the end day is pulled in whole.
      const since = custom?.since ? new Date(`${custom.since}T00:00:00.000Z`) : undefined;
      const until = custom?.until ? new Date(`${custom.until}T00:00:00.000Z`) : undefined;
      if (since && !Number.isNaN(since.getTime())) {
        const end =
          until && !Number.isNaN(until.getTime()) ? new Date(until.getTime() + DAY_MS) : tomorrow;
        if (end.getTime() > since.getTime()) {
          return { start: since.toISOString(), end: end.toISOString() };
        }
      }
      // An unusable custom range falls back to the default rather than throwing. A toolbar
      // half-filled by a person mid-edit must not take the page down.
      return lastDays(30);
    }
    case "last_30_days":
    default:
      return lastDays(30);
  }
}

/** How many days long the window is. Fractional for an odd custom range, which is fine for labels. */
export function periodDays(period: CallPeriod): number {
  return (Date.parse(period.end) - Date.parse(period.start)) / DAY_MS;
}

/** How the dashboard compares the chosen window against an earlier one. */
export type ComparisonMode = "previous_period" | "same_period_last_year" | "custom" | "none";

export const COMPARISON_MODE_LABEL: Record<ComparisonMode, string> = {
  previous_period: "The period just before",
  same_period_last_year: "The same dates last year",
  custom: "A range I choose",
  none: "No comparison",
};

/**
 * The window to compare against, or undefined for no comparison.
 *
 * "The period just before" is an equal-length window ending exactly where this one starts, which
 * is the default because it is the only comparison that holds length constant -- comparing 30 days
 * against a 31-day month would move every tile by about 3% for no reason at all.
 */
export function comparisonPeriod(
  period: CallPeriod,
  mode: ComparisonMode,
  custom?: CallPeriod,
): CallPeriod | undefined {
  const start = Date.parse(period.start);
  const end = Date.parse(period.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;

  switch (mode) {
    case "previous_period":
      return { start: new Date(start - (end - start)).toISOString(), end: period.start };
    case "same_period_last_year": {
      const shift = (at: number) => {
        const date = new Date(at);
        date.setUTCFullYear(date.getUTCFullYear() - 1);
        return date.toISOString();
      };
      return { start: shift(start), end: shift(end) };
    }
    case "custom":
      return custom && Date.parse(custom.end) > Date.parse(custom.start) ? custom : undefined;
    case "none":
    default:
      return undefined;
  }
}

/** Whether an instant falls inside the window. */
export function isWithinPeriod(at: string | undefined, period: CallPeriod): boolean {
  if (!at) return false;
  const value = Date.parse(at);
  if (!Number.isFinite(value)) return false;
  return value >= Date.parse(period.start) && value < Date.parse(period.end);
}

// ---------------------------------------------------------------------------
// The one shape everything below counts
// ---------------------------------------------------------------------------

/**
 * A call, reduced to the facts the dashboard counts.
 *
 * Built from a stored `VerifiedLead` by `toCallRecords`, so the dashboard never has to care which
 * pull a call came from or which of the three layers set its label.
 */
export interface CallRecord {
  id: string;
  /** ISO instant. A call with no timestamp cannot be placed in a period and is dropped. */
  at: string;
  label: CallLabel;
  durationSec?: number;
  /** The CRM contact, where the call belongs to one. The unit of caller identity. */
  contactId?: string;
  callerName?: string;
  callerPhone?: string;
  /** The client's tracking number that received the call. Absent on pulls made before 8 Nov 2026. */
  calledNumber?: string;
  calledNumberName?: string;
}

/**
 * Whether a lead typed as a call carries any evidence that a call actually happened.
 *
 * ## Why this exists, measured on the live data (8 November 2026)
 *
 * Of 888 stored leads typed `call`, only **367** carry any call metadata at all. The other **521**
 * have no duration, no status, no direction and no recording, and not one of them has an id
 * beginning `call-` -- so none of them came from `mapGhlCall`. **253** of the 521 sit at the same
 * caller and the same minute as a real call, which is what they are: the contact/conversation
 * record that accompanies a call, not a second call.
 *
 * Counting them does real damage rather than cosmetic damage. With no duration and no status the
 * automatic rules read them as missed, so 303 of those 521 landed on "Missed" and inflated the
 * missed-call rate from about a third to about a half. A client told half their calls go
 * unanswered, when a third do, is a conversation nobody can walk back.
 *
 * So the dashboard counts a lead as a call only where something about the call was recorded. The
 * number set aside is reported, never hidden: see `skippedNoCallEvidence`.
 *
 * This is the dashboard's own counting and changes nothing about how leads are pulled, matched or
 * stored, and nothing on the existing lead & call verification page, which keeps reporting on all
 * 888 exactly as before.
 */
export function hasCallEvidence(lead: VerifiedLead): boolean {
  return Boolean(
    lead.callDurationSec ||
      lead.callStatus ||
      lead.callDirection ||
      lead.recordingUrl ||
      lead.transcript ||
      lead.calledNumber,
  );
}

/**
 * Turn stored leads into countable calls, dropping what cannot be counted.
 *
 * Dropped: anything that is not a call; anything typed as a call with no evidence a call happened
 * (see `hasCallEvidence`); and any call with no usable timestamp -- a call that cannot be placed in
 * a period would otherwise be counted in every period, comparisons included. Each count comes back
 * too, so the screen can say so instead of quietly reporting a smaller total than the pull.
 */
export function toCallRecords(leads: VerifiedLead[]): {
  calls: CallRecord[];
  skippedNotCalls: number;
  skippedNoTimestamp: number;
  skippedNoCallEvidence: number;
} {
  const calls: CallRecord[] = [];
  let skippedNotCalls = 0;
  let skippedNoTimestamp = 0;
  let skippedNoCallEvidence = 0;

  for (const lead of leads) {
    if (lead.type !== "call") {
      skippedNotCalls += 1;
      continue;
    }
    if (!hasCallEvidence(lead)) {
      skippedNoCallEvidence += 1;
      continue;
    }
    const at = lead.receivedAt ? Date.parse(lead.receivedAt) : NaN;
    if (!Number.isFinite(at)) {
      skippedNoTimestamp += 1;
      continue;
    }
    calls.push({
      id: lead.id,
      at: new Date(at).toISOString(),
      label: resolveCallLabel(lead).label,
      durationSec: lead.callDurationSec,
      contactId: lead.contactId,
      callerName: lead.name,
      callerPhone: lead.phone,
      calledNumber: lead.calledNumber,
      calledNumberName: lead.calledNumberName,
    });
  }

  return { calls, skippedNotCalls, skippedNoTimestamp, skippedNoCallEvidence };
}

/** The five labels, all at zero. A fresh object each time, so callers can add to it freely. */
export function zeroLabelCounts(): Record<CallLabel, number> {
  return { good: 0, missed: 0, spam: 0, job_seeker: 0, unrelated: 0 };
}

export function countByLabel(calls: CallRecord[]): Record<CallLabel, number> {
  const counts = zeroLabelCounts();
  for (const call of calls) counts[call.label] += 1;
  return counts;
}

export function callsInPeriod(calls: CallRecord[], period: CallPeriod): CallRecord[] {
  return calls.filter((call) => isWithinPeriod(call.at, period));
}

// ---------------------------------------------------------------------------
// Change, and the six headline tiles
// ---------------------------------------------------------------------------

export interface Change {
  absolute: number;
  /**
   * The change as a fraction, e.g. 0.25 for a quarter more.
   *
   * Absent when the earlier figure was zero: there is no percentage change from nothing, and
   * "+100%" against a zero is the kind of number that ends up in a client deck.
   */
  percent?: number;
  direction: "up" | "down" | "flat";
  /** Whether the movement is good news for this metric. Absent when nothing moved. */
  good?: boolean;
}

/**
 * The movement between two figures, read in the direction that is good for this metric.
 *
 * Returns undefined when there is nothing to compare against -- the caller then shows the figure
 * with no arrow at all.
 */
export function describeChange(
  value: number,
  previous: number | undefined,
  goodWhenRising: boolean,
): Change | undefined {
  if (previous === undefined || !Number.isFinite(previous)) return undefined;

  const absolute = value - previous;
  const direction = absolute > 0 ? "up" : absolute < 0 ? "down" : "flat";
  return {
    absolute,
    percent: previous === 0 ? undefined : absolute / previous,
    direction,
    good: direction === "flat" ? undefined : goodWhenRising === (direction === "up"),
  };
}

/** The key of a headline tile: total calls, then one per label. */
export type HeadlineKey = "total" | CallLabel;

export interface HeadlineTile {
  key: HeadlineKey;
  label: string;
  value: number;
  /** The comparison figure, where a comparison period was asked for. */
  previous?: number;
  change?: Change;
  /** Whether a rise in this tile is good news, so the screen can colour the arrow. */
  goodWhenRising: boolean;
  tone?: string;
}

/**
 * The six tiles across the top: total calls, then Good, Missed, Spam, Job seeker, Unrelated.
 *
 * `previous` is only ever filled from calls the caller actually handed over. Pass no previous
 * calls and every tile comes back with no delta, which is the honest rendering of "we have one
 * window of data".
 */
export function headlineTiles(current: CallRecord[], previous?: CallRecord[]): HeadlineTile[] {
  const now = countByLabel(current);
  const before = previous ? countByLabel(previous) : undefined;

  const total: HeadlineTile = {
    key: "total",
    label: "Calls",
    value: current.length,
    previous: previous?.length,
    change: describeChange(current.length, previous?.length, true),
    goodWhenRising: true,
  };

  return [
    total,
    ...CALL_LABELS.map((label): HeadlineTile => {
      const goodWhenRising = moreIsBetter(label);
      return {
        key: label,
        label: CALL_LABEL_LABEL[label],
        value: now[label],
        previous: before?.[label],
        change: describeChange(now[label], before?.[label], goodWhenRising),
        goodWhenRising,
        tone: CALL_LABEL_TONE[label],
      };
    }),
  ];
}

// ---------------------------------------------------------------------------
// The call-mix donut
// ---------------------------------------------------------------------------

export interface CallMixSlice {
  label: CallLabel;
  name: string;
  count: number;
  /** A fraction of the total, 0..1. The screen formats it; this stays exact so slices sum to 1. */
  share: number;
  tone: string;
}

export interface CallMix {
  total: number;
  slices: CallMixSlice[];
  /**
   * Good calls as a fraction of all calls, for the middle of the donut.
   *
   * Absent when there were no calls. A rate over nothing is not zero, and a donut reading "0%
   * good" on a quiet month reads as a failure rather than as silence.
   */
  goodCallRate?: number;
}

/** The donut: one slice per label that actually occurred, largest first. */
export function callMix(calls: CallRecord[]): CallMix {
  const counts = countByLabel(calls);
  const total = calls.length;

  const slices = CALL_LABELS.filter((label) => counts[label] > 0)
    .map(
      (label): CallMixSlice => ({
        label,
        name: CALL_LABEL_LABEL[label],
        count: counts[label],
        share: counts[label] / total,
        tone: CALL_LABEL_TONE[label],
      }),
    )
    .sort((a, b) => b.count - a.count);

  return {
    total,
    slices,
    goodCallRate: total === 0 ? undefined : counts.good / total,
  };
}

// ---------------------------------------------------------------------------
// Calls over time
// ---------------------------------------------------------------------------

export type TimeBucketSize = "day" | "week" | "month";

/**
 * How wide the columns should be for a window of this length.
 *
 * Ninety daily columns on a phone is a smear, and three monthly columns for a week is a joke, so
 * the width follows the window: up to ~5 weeks daily, up to ~6 months weekly, longer monthly.
 */
export function bucketSizeForPeriod(period: CallPeriod): TimeBucketSize {
  const days = periodDays(period);
  if (days <= 35) return "day";
  if (days <= 190) return "week";
  return "month";
}

export interface TimeBucket {
  /** Sortable key: `2026-11-08`, `2026-W45` or `2026-11`. */
  key: string;
  /** Short axis label. */
  label: string;
  start: string;
  end: string;
  counts: Record<CallLabel, number>;
  total: number;
}

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Monday 00:00 UTC of the week this instant falls in. */
function startOfUtcWeek(at: Date): Date {
  const day = startOfUtcDay(at);
  // getUTCDay: 0 = Sunday. Shift so Monday is the first day, which is how weeks read in reports.
  const offset = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - offset * DAY_MS);
}

/** ISO week number, for a key that sorts and does not collide across years. */
function isoWeekKey(at: Date): string {
  const thursday = new Date(startOfUtcWeek(at).getTime() + 3 * DAY_MS);
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstWeekMonday = startOfUtcWeek(firstThursday);
  const week = Math.round((thursday.getTime() - firstWeekMonday.getTime()) / (7 * DAY_MS)) + 1;
  return `${thursday.getUTCFullYear()}-W${pad(week)}`;
}

/**
 * The stacked columns, one bucket per day / week / month across the whole window.
 *
 * Empty buckets are kept. A gap in the middle of a chart is information -- the phone did not ring
 * that week -- and dropping it would quietly compress the axis and make a dead fortnight look like
 * a busy one.
 */
export function callsOverTime(
  calls: CallRecord[],
  period: CallPeriod,
  size?: TimeBucketSize,
): { size: TimeBucketSize; buckets: TimeBucket[] } {
  const bucketSize = size ?? bucketSizeForPeriod(period);
  const periodStart = Date.parse(period.start);
  const periodEnd = Date.parse(period.end);
  const buckets: TimeBucket[] = [];
  const index = new Map<string, TimeBucket>();

  if (!Number.isFinite(periodStart) || !Number.isFinite(periodEnd) || periodEnd <= periodStart) {
    return { size: bucketSize, buckets };
  }

  const describe = (at: Date): { key: string; label: string; start: Date; end: Date } => {
    if (bucketSize === "day") {
      const start = startOfUtcDay(at);
      return {
        key: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-${pad(start.getUTCDate())}`,
        label: `${start.getUTCDate()} ${MONTH_SHORT[start.getUTCMonth()]}`,
        start,
        end: new Date(start.getTime() + DAY_MS),
      };
    }
    if (bucketSize === "week") {
      const start = startOfUtcWeek(at);
      return {
        key: isoWeekKey(start),
        label: `${start.getUTCDate()} ${MONTH_SHORT[start.getUTCMonth()]}`,
        start,
        end: new Date(start.getTime() + 7 * DAY_MS),
      };
    }
    const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
    return {
      key: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}`,
      label: `${MONTH_SHORT[start.getUTCMonth()]} ${String(start.getUTCFullYear()).slice(2)}`,
      start,
      end: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)),
    };
  };

  // Walk the window and lay every bucket down first, so gaps survive.
  let cursor = describe(new Date(periodStart));
  // A guard, not a limit anybody should reach: 3000 daily columns is already nonsense, and an
  // unbounded while over a malformed period would hang the request.
  for (let guard = 0; guard < 3000 && cursor.start.getTime() < periodEnd; guard += 1) {
    const bucket: TimeBucket = {
      key: cursor.key,
      label: cursor.label,
      start: cursor.start.toISOString(),
      end: cursor.end.toISOString(),
      counts: zeroLabelCounts(),
      total: 0,
    };
    buckets.push(bucket);
    index.set(bucket.key, bucket);
    cursor = describe(cursor.end);
  }

  for (const call of calls) {
    if (!isWithinPeriod(call.at, period)) continue;
    const bucket = index.get(describe(new Date(call.at)).key);
    if (!bucket) continue;
    bucket.counts[call.label] += 1;
    bucket.total += 1;
  }

  return { size: bucketSize, buckets };
}

// ---------------------------------------------------------------------------
// Callers, on a 30-day cycle
// ---------------------------------------------------------------------------

/**
 * The owner's counting rule: a caller counts once per 30-day cycle.
 *
 * Their first call opens a cycle. Every call within the next 30 days folds into that same cycle,
 * so a client who rings four times about one job is one caller, not four. The first call after the
 * 30 days opens a fresh cycle, because somebody coming back two months later is a new enquiry.
 */
export const CALLER_CYCLE_DAYS = 30;

/** Last ten digits, which is what matches two spellings of the same US number. */
export function normalisePhone(phone: string | undefined): string | undefined {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length < 7) return undefined;
  return digits.slice(-10);
}

/**
 * How a caller was identified.
 *
 * "contact" means the CRM knows them -- this is what the specification calls a saved caller.
 * "phone" means we only have a number. "unknown" means neither, and those calls are counted in the
 * totals but cannot be grouped, so they are reported separately rather than lumped together into
 * one enormous fake caller.
 */
export type CallerIdentity = "contact" | "phone" | "unknown";

export interface CallerCycle {
  start: string;
  end: string;
  calls: number;
}

export interface CallerRow {
  key: string;
  identifiedBy: CallerIdentity;
  name?: string;
  phone?: string;
  calls: number;
  /** Counted caller-cycles inside the period. This is what "unique callers" sums. */
  cycles: CallerCycle[];
  firstCallAt: string;
  lastCallAt: string;
  counts: Record<CallLabel, number>;
  /**
   * True when this caller had rung before the period.
   *
   * Absent when no earlier calls were supplied -- there is then nothing to judge it against.
   */
  returning?: boolean;
}

export interface CallersSummary {
  /** Counted caller-cycles in the period: the headline "unique callers". */
  uniqueCallers: number;
  /** Cycles holding more than one call -- somebody who rang again about the same thing. */
  repeatCallers: number;
  /** Callers the CRM has a contact record for. */
  savedCallers: number;
  /**
   * Callers with no call before this period.
   *
   * Absent when the caller passed no earlier calls: "new" is unanswerable without history, and a
   * dashboard that answered it anyway would call every caller new on its first run.
   */
  newCallers?: number;
  /** Calls we could not attribute to any caller, because neither a contact nor a number was stored. */
  unidentifiedCalls: number;
  rows: CallerRow[];
}

/**
 * The callers section: four figures and a sortable table.
 *
 * `history` is calls from before the period. Pass them and `newCallers` / `returning` are filled;
 * leave them out and both are absent, which is the honest answer rather than a guess.
 *
 * ## The trap in `history`, and it is a real one
 *
 * An empty array is NOT the same as omitting it. `[]` means "we looked at the earlier window and
 * nobody rang", so every caller is correctly new. `undefined` means "we never looked". Pass `[]`
 * when there was simply no earlier pull to look at and the screen will announce that every single
 * caller is new, every month, for ever -- which is exactly what the first live run of this file
 * did before this note was written. Only pass an array when a pull really does cover that window.
 */
export function summariseCallers(calls: CallRecord[], history?: CallRecord[]): CallersSummary {
  const groups = new Map<string, { identity: CallerIdentity; calls: CallRecord[] }>();
  let unidentifiedCalls = 0;

  for (const call of calls) {
    const phone = normalisePhone(call.callerPhone);
    const key = call.contactId ? `contact:${call.contactId}` : phone ? `phone:${phone}` : undefined;
    if (!key) {
      unidentifiedCalls += 1;
      continue;
    }
    const identity: CallerIdentity = call.contactId ? "contact" : "phone";
    const group = groups.get(key);
    if (group) group.calls.push(call);
    else groups.set(key, { identity, calls: [call] });
  }

  const seenBefore = history ? new Set<string>() : undefined;
  if (history && seenBefore) {
    for (const call of history) {
      const phone = normalisePhone(call.callerPhone);
      if (call.contactId) seenBefore.add(`contact:${call.contactId}`);
      if (phone) seenBefore.add(`phone:${phone}`);
    }
  }

  const rows: CallerRow[] = [];
  for (const [key, group] of groups) {
    const ordered = [...group.calls].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const cycles: CallerCycle[] = [];
    let open: { start: number; end: number; calls: number } | undefined;

    for (const call of ordered) {
      const at = Date.parse(call.at);
      if (!open || at >= open.end) {
        open = { start: at, end: at + CALLER_CYCLE_DAYS * DAY_MS, calls: 0 };
        cycles.push({
          start: new Date(open.start).toISOString(),
          end: new Date(open.end).toISOString(),
          calls: 0,
        });
      }
      open.calls += 1;
      cycles[cycles.length - 1].calls = open.calls;
    }

    const counts = zeroLabelCounts();
    for (const call of ordered) counts[call.label] += 1;

    const phone = normalisePhone(ordered.find((call) => call.callerPhone)?.callerPhone);
    rows.push({
      key,
      identifiedBy: group.identity,
      name: ordered.find((call) => call.callerName)?.callerName,
      phone: ordered.find((call) => call.callerPhone)?.callerPhone,
      calls: ordered.length,
      cycles,
      firstCallAt: ordered[0].at,
      lastCallAt: ordered[ordered.length - 1].at,
      counts,
      returning: seenBefore
        ? seenBefore.has(key) || (phone ? seenBefore.has(`phone:${phone}`) : false)
        : undefined,
    });
  }

  rows.sort((a, b) => b.calls - a.calls || Date.parse(b.lastCallAt) - Date.parse(a.lastCallAt));

  const uniqueCallers = rows.reduce((sum, row) => sum + row.cycles.length, 0);
  const repeatCallers = rows.reduce(
    (sum, row) => sum + row.cycles.filter((cycle) => cycle.calls > 1).length,
    0,
  );

  return {
    uniqueCallers,
    repeatCallers,
    savedCallers: rows.filter((row) => row.identifiedBy === "contact").length,
    newCallers: seenBefore ? rows.filter((row) => row.returning === false).length : undefined,
    unidentifiedCalls,
    rows,
  };
}

// ---------------------------------------------------------------------------
// By tracking number
// ---------------------------------------------------------------------------

export interface NumberBlock {
  phoneNumber: string;
  /** The CRM's friendly name, e.g. "Main line". Absent when the CRM gave no list. */
  friendlyName?: string;
  total: number;
  /** Caller-cycles on this line, by the same 30-day rule. */
  uniqueCallers: number;
  goodCalls: number;
  counts: Record<CallLabel, number>;
}

export interface NumbersBreakdown {
  blocks: NumberBlock[];
  /** Calls with no tracking number stored. Present on every pull made before 8 November 2026. */
  callsWithoutNumber: number;
  /**
   * What to put in the banner above the section, or nothing when all is well.
   *
   * Three different kinds of nothing look identical on screen and must not: the CRM gave no list
   * of numbers, the stored calls carry no number, or there simply were no calls.
   */
  warning?: string;
}

/**
 * One block per tracking number.
 *
 * `knownNumbers` is the list from the CRM. Numbers that took calls are reported whether or not the
 * CRM listed them; numbers the CRM listed that took no calls are reported too, at zero, because
 * "this line rang nobody this month" is a real answer a client wants.
 */
export function callsByNumber(
  calls: CallRecord[],
  knownNumbers: Array<{ phoneNumber: string; friendlyName?: string }> = [],
): NumbersBreakdown {
  const names = new Map<string, string | undefined>();
  for (const entry of knownNumbers) {
    const key = normalisePhone(entry.phoneNumber) || entry.phoneNumber;
    names.set(key, entry.friendlyName);
  }

  const grouped = new Map<string, { display: string; calls: CallRecord[] }>();
  let callsWithoutNumber = 0;

  for (const call of calls) {
    if (!call.calledNumber) {
      callsWithoutNumber += 1;
      continue;
    }
    const key = normalisePhone(call.calledNumber) || call.calledNumber;
    const group = grouped.get(key);
    if (group) group.calls.push(call);
    else grouped.set(key, { display: call.calledNumber, calls: [call] });
    if (!names.get(key) && call.calledNumberName) names.set(key, call.calledNumberName);
  }

  const blocks: NumberBlock[] = [];
  for (const [key, group] of grouped) {
    const counts = zeroLabelCounts();
    for (const call of group.calls) counts[call.label] += 1;
    blocks.push({
      phoneNumber: group.display,
      friendlyName: names.get(key),
      total: group.calls.length,
      uniqueCallers: summariseCallers(group.calls).uniqueCallers,
      goodCalls: counts.good,
      counts,
    });
  }

  // Lines the CRM knows about that took no calls this period.
  for (const entry of knownNumbers) {
    const key = normalisePhone(entry.phoneNumber) || entry.phoneNumber;
    if (grouped.has(key)) continue;
    blocks.push({
      phoneNumber: entry.phoneNumber,
      friendlyName: entry.friendlyName,
      total: 0,
      uniqueCallers: 0,
      goodCalls: 0,
      counts: zeroLabelCounts(),
    });
  }

  blocks.sort((a, b) => b.total - a.total || a.phoneNumber.localeCompare(b.phoneNumber));

  let warning: string | undefined;
  if (knownNumbers.length === 0 && blocks.length === 0 && calls.length > 0) {
    warning =
      "GoHighLevel returned no list of tracking numbers, and none of these calls recorded which line they came in on. Reconnect GoHighLevel to grant the phone-numbers permission, then refresh the calls.";
  } else if (knownNumbers.length === 0 && blocks.length > 0) {
    warning =
      "GoHighLevel returned no list of tracking numbers, so these lines are shown by number without their names. Reconnect GoHighLevel to grant the phone-numbers permission.";
  } else if (callsWithoutNumber > 0) {
    warning = `${callsWithoutNumber} of these calls did not record which line they came in on, so they are counted in the totals above but not in any block below. Only a fresh refresh captures the line.`;
  }

  return { blocks, callsWithoutNumber, warning };
}

// ---------------------------------------------------------------------------
// The comparison measures table
// ---------------------------------------------------------------------------

export interface MeasureRow {
  key: string;
  label: string;
  value: number;
  previous?: number;
  change?: Change;
  goodWhenRising: boolean;
  /** "count" or "percent", so the screen knows how to format it. */
  format: "count" | "percent";
}

/**
 * The measures table under the Comparison section.
 *
 * Deliberately a superset of the tiles: it adds the good-call rate and the caller figures, which
 * are the two things a client argues about and the two a tile has no room to explain.
 */
export function comparisonMeasures(current: CallRecord[], previous?: CallRecord[]): MeasureRow[] {
  const nowCounts = countByLabel(current);
  const beforeCounts = previous ? countByLabel(previous) : undefined;
  const nowCallers = summariseCallers(current);
  const beforeCallers = previous ? summariseCallers(previous) : undefined;

  const rows: MeasureRow[] = [
    {
      key: "total",
      label: "Calls",
      value: current.length,
      previous: previous?.length,
      change: describeChange(current.length, previous?.length, true),
      goodWhenRising: true,
      format: "count",
    },
    ...CALL_LABELS.map((label): MeasureRow => {
      const goodWhenRising = moreIsBetter(label);
      return {
        key: label,
        label: CALL_LABEL_LABEL[label],
        value: nowCounts[label],
        previous: beforeCounts?.[label],
        change: describeChange(nowCounts[label], beforeCounts?.[label], goodWhenRising),
        goodWhenRising,
        format: "count",
      };
    }),
  ];

  // The good-call rate only exists where there were calls. A rate over nothing is not zero.
  if (current.length > 0) {
    const value = nowCounts.good / current.length;
    const before =
      beforeCounts && previous && previous.length > 0 ? beforeCounts.good / previous.length : undefined;
    rows.push({
      key: "good_rate",
      label: "Good-call rate",
      value,
      previous: before,
      change: describeChange(value, before, true),
      goodWhenRising: true,
      format: "percent",
    });
  }

  rows.push(
    {
      key: "unique_callers",
      label: "Unique callers",
      value: nowCallers.uniqueCallers,
      previous: beforeCallers?.uniqueCallers,
      change: describeChange(nowCallers.uniqueCallers, beforeCallers?.uniqueCallers, true),
      goodWhenRising: true,
      format: "count",
    },
    {
      key: "repeat_callers",
      label: "Callers who rang again",
      value: nowCallers.repeatCallers,
      previous: beforeCallers?.repeatCallers,
      change: describeChange(nowCallers.repeatCallers, beforeCallers?.repeatCallers, true),
      goodWhenRising: true,
      format: "count",
    },
  );

  return rows;
}

/** Per-number comparison: the same blocks for both windows, lined up by number. */
export interface NumberComparisonRow {
  phoneNumber: string;
  friendlyName?: string;
  value: number;
  previous?: number;
  change?: Change;
  goodCalls: number;
  previousGoodCalls?: number;
}

export function compareNumbers(
  current: NumbersBreakdown,
  previous?: NumbersBreakdown,
): NumberComparisonRow[] {
  const before = new Map<string, NumberBlock>();
  for (const block of previous?.blocks ?? []) {
    before.set(normalisePhone(block.phoneNumber) || block.phoneNumber, block);
  }

  const rows = current.blocks.map((block): NumberComparisonRow => {
    const match = before.get(normalisePhone(block.phoneNumber) || block.phoneNumber);
    return {
      phoneNumber: block.phoneNumber,
      friendlyName: block.friendlyName,
      value: block.total,
      previous: previous ? (match?.total ?? 0) : undefined,
      change: describeChange(block.total, previous ? (match?.total ?? 0) : undefined, true),
      goodCalls: block.goodCalls,
      previousGoodCalls: previous ? (match?.goodCalls ?? 0) : undefined,
    };
  });

  // A line that rang last period and not this one must still appear, or a drop to zero vanishes.
  if (previous) {
    const shown = new Set(
      current.blocks.map((block) => normalisePhone(block.phoneNumber) || block.phoneNumber),
    );
    for (const [key, block] of before) {
      if (shown.has(key) || block.total === 0) continue;
      rows.push({
        phoneNumber: block.phoneNumber,
        friendlyName: block.friendlyName,
        value: 0,
        previous: block.total,
        change: describeChange(0, block.total, true),
        goodCalls: 0,
        previousGoodCalls: block.goodCalls,
      });
    }
  }

  return rows.sort((a, b) => b.value - a.value || (b.previous ?? 0) - (a.previous ?? 0));
}
