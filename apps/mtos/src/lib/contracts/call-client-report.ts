import type { CallLabel } from "@/src/lib/mtos-data";
import { CALL_LABEL_LABEL } from "@/src/lib/contracts/call-labels";
import { callerSubline, type CallTableRow } from "@/src/lib/contracts/call-dashboard";
import type { CallMix, CallPeriod, CallersSummary, Change, HeadlineTile } from "@/src/lib/contracts/call-report";

/**
 * The client report's own decisions: what a client may see, and how it reads in plain English.
 *
 * The dashboard is for us. This is for them, and the difference is not cosmetic -- it is the whole
 * reason this file exists instead of a print stylesheet over the dashboard.
 *
 * ## Three rules, and the third is the one that matters
 *
 * **1. A recording is not in the report unless somebody switched it on.** The switch lives in
 * Report Branding and is false until a human sets it. This file is where that decision is
 * *enforced*, not merely honoured: `toReportRows` deletes the recording URL when recordings are
 * off, so a component downstream cannot leak one by rendering a field it should have ignored. A
 * setting that only hides a player would still ship the authenticated URL into the markup of a
 * document that gets forwarded.
 *
 * **2. The provenance stays behind.** The dashboard tells us who decided each label -- you, the AI
 * review, or a rule -- because that is how we audit ourselves. The report does not. "A computer
 * decided this call was spam" turns a report into a row-by-row argument about the computer, and the
 * client's real question is the count, not the mechanism. The labels themselves are shown, and any
 * one of them can be challenged by asking us; what is not shown is a column inviting it.
 *
 * **3. Nothing is said that was not measured.** No comparison period means no comparison sentence,
 * not a sentence comparing against zero. No callers identified means we say so. The sentences in
 * `reportSummaryLines` are generated from the figures and only from the figures -- there is no
 * template here with a cheerful adjective waiting for a number to drop into it.
 *
 * Pure, like the rest of `contracts/`: no React, no Firestore, no clock of its own.
 */

/**
 * How many recordings a page of the report reveals at a time.
 *
 * Each player is an authenticated request through our own proxy, so a month with three hundred
 * calls would be three hundred requests the moment the page opened -- and `preload="none"` only
 * delays the audio, not the element. Twenty-five is a screenful and a half: enough that nobody
 * feels rationed, few enough that the page opens in one go.
 */
export const RECORDINGS_PER_BATCH = 25;

/**
 * A row as the client sees it.
 *
 * Deliberately NOT `CallTableRow`. The missing fields are the point: no `source`, no `sourceName`,
 * no `reason`, no `overridden`, and no `recordingUrl` unless recordings were switched on.
 */
export interface ReportRow {
  id: string;
  when: string;
  at: string;
  caller: string;
  /** The number under the name -- absent when there is no name, or the name IS the number. */
  callerPhone?: string;
  /** The line they rang. Absent where the pull did not capture one -- print an em dash, not a name. */
  calledNumber?: string;
  duration?: string;
  label: CallLabel;
  labelName: string;
  labelTone: string;
  topic?: string;
  topicSummary?: string;
  /** Present only when recordings are included AND this call has one. */
  recordingUrl?: string;
}

/**
 * Turn dashboard rows into client rows, stripping what is ours.
 *
 * `includeRecordings` is the stored setting. Pass it through honestly: `undefined` is off, because
 * an unset field means nobody ever turned it on.
 */
export function toReportRows(rows: CallTableRow[], includeRecordings: boolean | undefined): ReportRow[] {
  const allowed = includeRecordings === true;
  return rows.map((row) => ({
    id: row.id,
    when: row.when,
    at: row.at,
    // "Not recorded" rather than an empty cell: the call happened, we just have no name for it.
    caller: row.callerName || row.callerPhone || "Not recorded",
    callerPhone: callerSubline(row.callerName, row.callerPhone),
    calledNumber: row.calledNumberName || row.calledNumber,
    duration: row.duration,
    label: row.label,
    labelName: row.labelName,
    labelTone: row.labelTone,
    topic: row.topic,
    topicSummary: row.topicSummary,
    recordingUrl: allowed ? row.recordingUrl : undefined,
  }));
}

export interface ReportRecordings {
  /** Whether the report carries players at all. */
  included: boolean;
  /** How many of the rows have a recording behind them, whether or not it is included. */
  available: number;
  /** Rows with a recording, in the report's order. Empty when recordings are off. */
  rows: ReportRow[];
  batchSize: number;
  /**
   * What to print about recordings, or nothing when there is nothing worth saying.
   *
   * A report for a month with no recordings at all says nothing -- announcing the absence of
   * something the client never asked for only raises the question.
   */
  note?: string;
}

/**
 * The recordings section.
 *
 * Note the asymmetry: when recordings are OFF but exist, we say so. Silently dropping twenty-eight
 * recordings from a report about twenty-eight calls is the kind of omission that looks like
 * concealment the first time a client hears one on a call with us.
 */
export function reportRecordings(
  rows: ReportRow[],
  includeRecordings: boolean | undefined,
  totalWithRecording: number,
): ReportRecordings {
  const included = includeRecordings === true;
  const withRecording = rows.filter((row) => Boolean(row.recordingUrl));
  const available = included ? withRecording.length : totalWithRecording;

  if (available === 0) {
    return { included, available: 0, rows: [], batchSize: RECORDINGS_PER_BATCH };
  }

  return {
    included,
    available,
    rows: included ? withRecording : [],
    batchSize: RECORDINGS_PER_BATCH,
    note: included
      ? `${available.toLocaleString("en-US")} of these calls were recorded. They load ${RECORDINGS_PER_BATCH} at a time so the page opens quickly.`
      : `${available.toLocaleString("en-US")} of these calls were recorded. The recordings are held in our own system and are not part of this report.`,
  };
}

/** How many calls carry a recording, counted before the setting has had a chance to strip them. */
export function countRecordings(rows: CallTableRow[]): number {
  return rows.filter((row) => Boolean(row.recordingUrl)).length;
}

/**
 * A movement in words, in the direction that is good for the thing being counted.
 *
 * Words rather than an arrow, because a printed page has no tooltip to explain a red triangle --
 * and because "7 fewer missed calls than last month" cannot be misread the way a red ▼ can.
 * Returns nothing when there was no comparison, which is how a report ends up with no sentence
 * rather than a sentence about nothing.
 */
export function describeChangeInWords(
  change: Change | undefined,
  noun: string,
  comparisonLabel: string,
): string | undefined {
  if (!change) return undefined;
  if (change.direction === "flat") {
    return `The same number of ${noun} as ${comparisonLabel.toLowerCase()}.`;
  }
  const size = Math.abs(change.absolute).toLocaleString("en-US");
  const word = change.direction === "up" ? "more" : "fewer";
  return `${size} ${word} ${noun} than ${comparisonLabel.toLowerCase()}.`;
}

/** A share as a whole percent, e.g. 0.7489 -> "75%". */
export function formatShare(share: number | undefined): string | undefined {
  if (share === undefined || !Number.isFinite(share)) return undefined;
  return `${Math.round(share * 100)}%`;
}

export interface ReportSummary {
  /** The big number at the top. */
  headline: string;
  /** Short sentences under it, in reading order. Never more than five. */
  lines: string[];
  /** The good-call rate as a percentage string, for the ring. Absent on a month with no calls. */
  goodCallRate?: string;
}

/**
 * The paragraph at the top of the report, written from the figures.
 *
 * Every sentence here is conditional on having measured the thing it describes. Read the omissions:
 * a quiet month gets one sentence and no percentages, a month with no comparison gets no comparison
 * sentence, and a month where nobody could be identified says that instead of implying one caller.
 */
export function reportSummaryLines({
  mix,
  tiles,
  callers,
  periodLabel,
  comparisonLabel,
}: {
  mix: CallMix;
  tiles: HeadlineTile[];
  callers: CallersSummary;
  periodLabel: string;
  comparisonLabel?: string;
}): ReportSummary {
  const window = periodLabel.toLowerCase();
  const total = mix.total;

  if (total === 0) {
    return {
      headline: "No calls recorded",
      lines: [
        `We have no calls on record for ${window}. That is either a quiet period or a tracking number that has stopped passing calls through, and we check the second before we accept the first.`,
      ],
    };
  }

  const counts = new Map<CallLabel, number>();
  for (const slice of mix.slices) counts.set(slice.label, slice.count);
  const count = (label: CallLabel) => counts.get(label) || 0;

  const lines: string[] = [];

  const good = count("good");
  if (good > 0) {
    lines.push(
      `${good.toLocaleString("en-US")} of them — ${formatShare(mix.goodCallRate)} — were answered and lasted long enough to be a real conversation.`,
    );
  } else {
    lines.push("None of them were answered and lasted long enough to count as a real conversation.");
  }

  const missed = count("missed");
  if (missed > 0) {
    lines.push(
      `${missed.toLocaleString("en-US")} rang out without being answered. Each one is somebody who wanted to reach you and did not.`,
    );
  }

  const noise = count("spam") + count("job_seeker") + count("unrelated");
  if (noise > 0) {
    const parts = (["spam", "job_seeker", "unrelated"] as CallLabel[])
      .filter((label) => count(label) > 0)
      .map((label) => `${count(label).toLocaleString("en-US")} ${CALL_LABEL_LABEL[label].toLowerCase()}`);
    lines.push(
      `${noise.toLocaleString("en-US")} were not enquiries at all — ${parts.join(", ")} — and we have marked them so they are not counted as leads.`,
    );
  }

  if (callers.uniqueCallers > 0) {
    const repeat =
      callers.repeatCallers > 0
        ? ` ${callers.repeatCallers.toLocaleString("en-US")} of them rang more than once.`
        : "";
    lines.push(`The calls came from ${callers.uniqueCallers.toLocaleString("en-US")} different callers.${repeat}`);
  } else if (callers.unidentifiedCalls > 0) {
    lines.push(
      `We could not tell who was calling on ${callers.unidentifiedCalls.toLocaleString("en-US")} of these — no number or contact was captured — so they are counted in the total but not grouped by caller.`,
    );
  }

  if (comparisonLabel) {
    const totalTile = tiles.find((tile) => tile.key === "total");
    const sentence = describeChangeInWords(totalTile?.change, "calls", comparisonLabel);
    if (sentence) lines.push(sentence);
  }

  return {
    headline: `${total.toLocaleString("en-US")} ${total === 1 ? "call" : "calls"} in ${window}`,
    lines: lines.slice(0, 5),
    goodCallRate: formatShare(mix.goodCallRate),
  };
}

/**
 * The line under the title that says exactly which days this covers.
 *
 * A report that says "last 30 days" and nothing else is unfalsifiable six weeks later, when
 * somebody is holding it next to a different report and asking why the numbers disagree.
 *
 * `CallPeriod` is half-open -- `end` is the instant after the window -- so the last day printed is
 * `end` minus a millisecond. Printing `end` itself would claim a day the figures do not cover, and
 * a report overlapping the next one by a day is a report nobody can reconcile.
 */
export function reportDateline(period: CallPeriod, timeZone = "UTC"): string {
  const format = (at: Date) =>
    new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone,
    }).format(at);
  const lastDay = new Date(Date.parse(period.end) - 1);
  return `${format(new Date(period.start))} to ${format(lastDay)}`;
}

/** "Prepared by MapRanking on 9 November 2026" -- who made it and when, on every page. */
export function reportFooter(companyName: string, generatedAt: string, timeZone = "UTC"): string {
  const when = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(new Date(generatedAt));
  return `Prepared by ${companyName} on ${when}`;
}

/**
 * What to print where a figure is absent, with the reason attached.
 *
 * Returns the em dash and a title for it. Never "0": a thing we did not measure and a thing that
 * measured zero are different answers, and only one of them is the client's fault.
 */
export function absentFigure(reason: string): { text: string; title: string } {
  return { text: "—", title: reason };
}
