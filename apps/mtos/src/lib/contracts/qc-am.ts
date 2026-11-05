import {
  isGraded,
  qcRating,
  qcScore,
  type QcAppeal,
  type QcCriterionNote,
  type QcIndexRow,
  type QcScoreValue,
  type QcStatus,
  type QcRating,
} from "@/src/lib/contracts/qc-record";
import {
  QC_POST_TOUCH_CRITERION,
  QC_PREP_CRITERION,
  QC_RUBRIC,
  criterionByNumber,
} from "@/src/lib/contracts/qc-rubric";
import { isQueued, isScored } from "@/src/lib/contracts/qc-queue";
import { qcDateLabel } from "@/src/lib/contracts/qc-dates";

/**
 * What the Account Manager's own QA & Coaching page works out from their QC history.
 *
 * Pure, and every function here is about one person reading their own performance record. That is
 * what makes the edge cases matter more than usual: an AM with one scored touch, an AM whose
 * criterion was marked N/A, an AM whose score went down. Each of those has an honest answer and a
 * misleading one, and the misleading one is almost always the arithmetically convenient default.
 *
 * ## Three rules this file keeps
 *
 * **A missing number is a dash, never a zero and never an average of nothing.** `null` travels all
 * the way to the screen. An AM told their meeting-prep KPI is "0.0" when it has simply never been
 * graded has been handed a number about themselves that is not true.
 *
 * **A comparison needs something to compare with.** The delta against the previous touch, the
 * "where you improved" list and the "since {date}" line all require a second data point, and they
 * are absent rather than zero when there is only one. "▲ 0 vs last" on a first score invents a
 * history the AM does not have.
 *
 * **The stored score wins over a recomputed one.** `row.score` is the number that was sent to the
 * AM and argued about in an appeal; `qcScore(row.crit)` is only the fallback for a row written
 * before the score was copied onto it. If a later rubric change made the two disagree, the one the
 * AM was actually told is the true one.
 */

/** The KPI tiles and the chart read the last five scored touches. */
export const AM_WINDOW = 5;
/** "Where you improved" compares the latest touch against the average of the three before it. */
export const IMPROVED_BASELINE = 3;
/** Half a point. Below that it is noise, and listing it would be flattery. */
export const IMPROVED_MIN_DELTA = 0.5;
/** "Focus next" averages the last three touches. */
export const FOCUS_WINDOW = 3;
/** Three items in each of the improved and focus lists. */
export const LIST_COUNT = 3;

// ---------------------------------------------------------------------------
// Small arithmetic, shared
// ---------------------------------------------------------------------------

function mean(values: readonly number[]): number | null {
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** One decimal place, or null straight through. A KPI average of "4" reads as unrounded. */
function toOneDecimal(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

/**
 * The score of one row: what was stored, or computed from the criteria when it was not.
 *
 * See the file note. Never zero for an unscored row -- it returns null and the caller shows a dash.
 */
export function rowScore(row: Pick<QcIndexRow, "score" | "crit"> | undefined): number | null {
  if (!row) return null;
  if (typeof row.score === "number") return row.score;
  return qcScore(row.crit);
}

/** The criterion's value on a row, or null when it was N/A, never graded, or the row has no crit. */
function critAt(row: Pick<QcIndexRow, "crit"> | undefined, n: number): number | null {
  const value = row?.crit?.[n - 1];
  return isGraded(value) ? value : null;
}

/** The first word of a client's name, which is how the AM's own copy refers to a touch. */
export function clientFirstWord(client: string | undefined): string {
  return (client || "").trim().split(" ").filter(Boolean)[0] || "";
}

/**
 * Re-exported so this file stays the one import the AM page needs.
 *
 * The implementation is in `qc-dates.ts`, which is where the reason it is not a two-line
 * `Intl.DateTimeFormat` call is written down: a bare calendar day formatted in the viewer's own
 * zone comes out a day early for everyone west of UTC.
 */
export const amDateLabel = qcDateLabel;

// ---------------------------------------------------------------------------
// Splitting the history
// ---------------------------------------------------------------------------

/**
 * Oldest first, by the touch's own date rather than when QC got to it.
 *
 * The chart, the deltas and "your last five touches" are all about the order the calls happened
 * in, which is not the order they were scored in -- a reviewer working through a backlog can score
 * a June touch after a July one, and a chart that showed June to the right of July would be
 * telling the AM their performance moved in a direction it did not.
 *
 * A row with no readable date falls back to `readyAt`, and sorts last when it has neither.
 */
export function sortAmOldestFirst<T extends Pick<QcIndexRow, "date" | "readyAt">>(
  rows: readonly T[],
): T[] {
  const key = (row: T) => {
    const value = row.date || row.readyAt || "";
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
  };
  return [...rows].sort((a, b) => key(a) - key(b));
}

export interface QcAmSplit {
  /** With QC now: `ready` or `in_progress`. No score to show, so they are chips, not history. */
  pending: QcIndexRow[];
  /** Scored, oldest first. Every one of these has a score the AM has been told. */
  done: QcIndexRow[];
}

/**
 * Split one AM's rows into "being scored" and "scored".
 *
 * A scored row with no criteria is left out of both. It would otherwise land in the history with a
 * dash for a score and a blank breakdown, which reads as a review that went wrong rather than as
 * one of the legacy A-F touches that genuinely has no 17-point record (those get their own
 * treatment in a later phase).
 */
export function splitAmRows(rows: readonly QcIndexRow[]): QcAmSplit {
  const ordered = sortAmOldestFirst(rows);
  return {
    pending: ordered.filter((row) => isQueued(row.status)),
    done: ordered.filter((row) => isScored(row.status) && Boolean(row.crit?.length)),
  };
}

/** "{client} · {date}", with "· being scored" once a reviewer has opened it. */
export function pendingChipLabel(row: Pick<QcIndexRow, "client" | "date" | "status">): string {
  const base = `${row.client} · ${amDateLabel(row.date)}`;
  return row.status === "in_progress" ? `${base} · being scored` : base;
}

/** A score the AM has not opened yet. `reviewed` means they have; an appeal is still unread news. */
export function isUnreadScore(status: QcStatus): boolean {
  return status === "scored" || status === "appeal_resolved";
}

/** The violet badge on the sidebar: how many scores are waiting to be read. */
export function unreadScoreCount(rows: readonly QcIndexRow[]): number {
  return rows.filter((row) => isScored(row.status) && isUnreadScore(row.status)).length;
}

// ---------------------------------------------------------------------------
// The header
// ---------------------------------------------------------------------------

export interface QcAmLatest {
  touchId: string;
  client: string;
  dateLabel: string;
  score: number | null;
  rating: QcRating | null;
  /** The change against the touch before it, or null when there is no touch before it. */
  delta: number | null;
  deltaLabel: string;
  /** The client the delta is measured against, for "Up 4 from Oakline (Jun 5)". */
  previousClient: string;
  previousDateLabel: string;
  /** True while the score has not been marked as read. Drives the "New" badge. */
  isNew: boolean;
  scoredAtLabel: string;
  scoredBy: string;
}

/** The latest scored touch, with its delta against the one before it. */
export function latestCard(
  done: readonly QcIndexRow[],
  reviewerName?: string,
): QcAmLatest | undefined {
  const latest = done[done.length - 1];
  if (!latest) return undefined;
  const previous = done[done.length - 2];
  const score = rowScore(latest);
  const previousScore = rowScore(previous);
  const delta = score === null || previousScore === null ? null : score - previousScore;
  return {
    touchId: latest.touchId,
    client: latest.client,
    dateLabel: amDateLabel(latest.date),
    score,
    rating: score === null ? null : qcRating(score),
    delta,
    deltaLabel: delta === null ? "" : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)} vs last`,
    previousClient: clientFirstWord(previous?.client),
    previousDateLabel: amDateLabel(previous?.date),
    isNew: isUnreadScore(latest.status),
    scoredAtLabel: amDateLabel(latest.scoredAt),
    // The reviewer's name is tenant data, so it is passed in. Never compiled into the copy.
    scoredBy: reviewerName || "QC",
  };
}

/**
 * The page's headline.
 *
 * A new score leads with that score, because it is the thing the AM came to the page to read.
 * Otherwise it leads with the average, which is the thing worth knowing when there is no news.
 */
export function amHeadline(done: readonly QcIndexRow[]): string {
  const latest = done[done.length - 1];
  if (!latest) return "No QC scores yet.";
  const score = rowScore(latest);
  if (isUnreadScore(latest.status) && score !== null) {
    const name = clientFirstWord(latest.client) || latest.client;
    return `Your ${name} score is ready: ${score}.`;
  }
  const window = done.slice(-AM_WINDOW);
  const average = mean(window.map(rowScore).filter((value): value is number => value !== null));
  if (average === null) return "No QC scores yet.";
  const touches = window.length === 1 ? "touch" : "touches";
  return `You're averaging ${Math.round(average)} across your last ${window.length} ${touches}.`;
}

/** The sentence under the headline: the direction of travel, then what a score comes with. */
export function amSubtitle(done: readonly QcIndexRow[]): string {
  const explainer =
    "Every score comes with what went well, what to work on and coaching ideas. If QC missed context, you can appeal any touch.";
  if (!done.length) {
    return "Your first score appears here after QC grades a finished monthly touch.";
  }
  const card = latestCard(done);
  if (!card || card.delta === null) return explainer;
  const direction = card.delta >= 0 ? "Up" : "Down";
  const from = card.previousClient
    ? ` from ${card.previousClient} (${card.previousDateLabel})`
    : " from your previous touch";
  return `${direction} ${Math.abs(card.delta)}${from}. ${explainer}`;
}

// ---------------------------------------------------------------------------
// The four KPI tiles
// ---------------------------------------------------------------------------

export interface QcAmKpi {
  label: string;
  /** Null renders as a dash. See the file note. */
  value: number | null;
  /** One decimal for the KPI averages, none for the overall score. */
  decimals: 0 | 1;
  sub: string;
  /** Only the average-score tile carries a direction; the others are neutral. */
  tone?: "good" | "risk";
  /** For the "Client goal set" tile, which is a fraction rather than a number. */
  text?: string;
}

/**
 * Average score · meeting prep · post-touch actions · client goal, over the last five scored touches.
 *
 * The prep and post-touch tiles count how many of those five were at 4+, and the denominator is
 * the number of touches in the window rather than five, so an AM with two scored touches reads
 * "1 of 2 at 4+" and not "1 of 5". The goal tile's denominator excludes N/A: a month with no goal
 * to set is not a month the AM failed to set one.
 */
export function amKpis(done: readonly QcIndexRow[]): QcAmKpi[] {
  const window = done.slice(-AM_WINDOW);
  const scores = window.map(rowScore).filter((value): value is number => value !== null);
  const average = mean(scores);
  const first = scores[0];
  const last = scores[scores.length - 1];
  const since = scores.length > 1 && first !== undefined && last !== undefined ? last - first : null;

  const kpiTile = (label: string, n: number): QcAmKpi => {
    const values = window.map((row) => critAt(row, n)).filter((v): v is number => v !== null);
    const met = values.filter((value) => value >= 4).length;
    return {
      label,
      value: toOneDecimal(mean(values)),
      decimals: 1,
      sub: values.length
        ? `${met} of ${values.length} at 4+ · target 4+`
        : "not graded on these touches",
    };
  };

  const applicable = window.filter((row) => row.goal && row.goal !== "N/A");
  const set = applicable.filter((row) => row.goal === "Yes").length;
  const partial = applicable.filter((row) => row.goal === "Partial").length;

  return [
    {
      label: `Average score · last ${window.length || 0}`,
      value: average === null ? null : Math.round(average),
      decimals: 0,
      sub:
        since === null
          ? "Target 80"
          : `${since >= 0 ? "▲" : "▼"} ${Math.abs(since)} since ${amDateLabel(window[0]?.date)}`,
      ...(since === null ? {} : { tone: since >= 0 ? ("good" as const) : ("risk" as const) }),
    },
    kpiTile("Meeting prep KPI", QC_PREP_CRITERION),
    kpiTile("Post-touch actions KPI", QC_POST_TOUCH_CRITERION),
    {
      label: "Client goal set",
      value: null,
      decimals: 0,
      text: applicable.length ? `${set} / ${applicable.length}` : "—",
      sub: applicable.length
        ? `${partial} partial`
        : "no touch in this window had a goal to set",
    },
  ];
}

// ---------------------------------------------------------------------------
// The chart
// ---------------------------------------------------------------------------

export interface QcAmTrendPoint {
  touchId: string;
  score: number;
  client: string;
  clientShort: string;
  dateLabel: string;
  selected: boolean;
  /** At or above the target. Below it the bar is amber -- the only colour on the chart. */
  onTarget: boolean;
  /** 0-100, the bar's height as a share of the plot. */
  heightPercent: number;
}

/**
 * One bar per scored touch, in call order.
 *
 * The plot starts at 50 rather than 0, deliberately and visibly: with a dashed target line at 80
 * and real scores between 60 and 100, a zero-based axis squeezes every bar into the top fifth and
 * the differences the AM is looking for disappear. A score at or below 50 still draws a stub, so a
 * bad month is visible as a bar rather than as nothing at all.
 */
export const TREND_FLOOR = 50;

export function trendPoints(
  done: readonly QcIndexRow[],
  selectedTouchId: string | undefined,
): QcAmTrendPoint[] {
  const out: QcAmTrendPoint[] = [];
  for (const row of done) {
    const score = rowScore(row);
    if (score === null) continue;
    const ratio = (score - TREND_FLOOR) / (100 - TREND_FLOOR);
    out.push({
      touchId: row.touchId,
      score,
      client: row.client,
      clientShort: clientFirstWord(row.client) || row.client,
      dateLabel: amDateLabel(row.date),
      selected: row.touchId === selectedTouchId,
      onTarget: score >= 80,
      heightPercent: Math.max(4, Math.min(100, Math.round(ratio * 100))),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Where you improved, and what to focus on
// ---------------------------------------------------------------------------

export interface QcAmImproved {
  n: number;
  name: string;
  /** The average of the baseline touches, to one decimal. */
  from: number;
  to: number;
}

/**
 * Criteria where the latest touch beat the average of the three before it by half a point or more.
 *
 * Needs a baseline, so it is empty when the AM has only one scored touch -- the screen then says
 * "Steady across the board" rather than claiming an improvement measured against nothing. A
 * criterion that was N/A on the latest touch is skipped: not applying is not improving.
 */
export function improvedRows(done: readonly QcIndexRow[]): QcAmImproved[] {
  const latest = done[done.length - 1];
  if (!latest) return [];
  const baseline = done.slice(-(IMPROVED_BASELINE + 1), -1);
  if (!baseline.length) return [];

  const rows: { row: QcAmImproved; gain: number }[] = [];
  for (const criterion of QC_RUBRIC) {
    const now = critAt(latest, criterion.n);
    if (now === null) continue;
    const before = mean(
      baseline.map((row) => critAt(row, criterion.n)).filter((v): v is number => v !== null),
    );
    if (before === null) continue;
    const gain = now - before;
    if (gain < IMPROVED_MIN_DELTA) continue;
    rows.push({
      row: { n: criterion.n, name: criterion.name, from: toOneDecimal(before) as number, to: now },
      gain,
    });
  }
  // Biggest gain first; ties break on the lower criterion number so the list is deterministic.
  rows.sort((a, b) => b.gain - a.gain || a.row.n - b.row.n);
  return rows.slice(0, LIST_COUNT).map((entry) => entry.row);
}

export interface QcAmFocus {
  n: number;
  name: string;
  average: number;
  /** The most recent "Next time" note, or the criterion's own description when there is none. */
  advice: string;
  /** True when the advice is the rubric's description rather than something QC wrote. */
  fromRubric: boolean;
}

/**
 * The three lowest-averaging criteria across the last three scored touches.
 *
 * `notesByTouch` is only as deep as the caller could afford to read; a criterion with no note in
 * it falls back to the rubric's description, which is at least a true statement of what the
 * criterion asks for. Inventing advice would be worse, and leaving the line blank would make the
 * lowest criterion look like the one nobody had anything to say about.
 */
export function focusRows(
  done: readonly QcIndexRow[],
  notesByTouch: Readonly<Record<string, Record<number, QcCriterionNote>>> = {},
): QcAmFocus[] {
  const window = done.slice(-FOCUS_WINDOW);
  if (!window.length) return [];
  // Newest first: the most recent note about a criterion is the one worth repeating.
  const newestFirst = [...window].reverse();

  const rows: QcAmFocus[] = [];
  for (const criterion of QC_RUBRIC) {
    const average = mean(
      window.map((row) => critAt(row, criterion.n)).filter((v): v is number => v !== null),
    );
    if (average === null) continue;
    const note = newestFirst
      .map((row) => notesByTouch[row.touchId]?.[criterion.n]?.next?.trim())
      .find((value): value is string => Boolean(value));
    rows.push({
      n: criterion.n,
      name: criterion.name,
      average: toOneDecimal(average) as number,
      advice: note || criterion.description,
      fromRubric: !note,
    });
  }
  rows.sort((a, b) => a.average - b.average || a.n - b.n);
  return rows.slice(0, LIST_COUNT);
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface QcAmHistoryRow {
  touchId: string;
  client: string;
  dateLabel: string;
  score: number | null;
  status: QcStatus;
  statusLabel: string;
  /** Against the touch before it in call order, or null for the first one. */
  delta: number | null;
  selected: boolean;
}

/** What the AM's own history calls each status. Their words, not the reviewer's. */
export function amStatusLabel(status: QcStatus, reviewerName?: string): string {
  if (status === "scored") return "New — not read yet";
  if (status === "reviewed") return "Read";
  if (status === "appealed") return reviewerName ? `Appeal with ${reviewerName}` : "Appeal open";
  if (status === "appeal_resolved") return "Appeal decided";
  if (status === "in_progress") return "Being scored";
  return "With QC";
}

/** Newest first, each row carrying its change against the touch before it. */
export function historyRows(
  done: readonly QcIndexRow[],
  selectedTouchId: string | undefined,
  reviewerName?: string,
): QcAmHistoryRow[] {
  return done
    .map((row, index) => {
      const score = rowScore(row);
      const previous = index > 0 ? rowScore(done[index - 1]) : null;
      return {
        touchId: row.touchId,
        client: row.client,
        dateLabel: amDateLabel(row.date),
        score,
        status: row.status,
        statusLabel: amStatusLabel(row.status, reviewerName),
        delta: score === null || previous === null ? null : score - previous,
        selected: row.touchId === selectedTouchId,
      };
    })
    .reverse();
}

// ---------------------------------------------------------------------------
// The 17-point breakdown
// ---------------------------------------------------------------------------

export type QcAppealTag = "Under appeal" | "Raised on appeal" | "Appeal declined";

/**
 * Which criteria carry an appeal tag, and which one.
 *
 * Before a decision every appealed criterion is "Under appeal". After it, each is the decision that
 * was made -- including "Appeal declined", which is shown rather than hidden: an AM who appealed
 * and lost is owed the record of having been answered.
 */
export function appealTags(appeal: QcAppeal | undefined): Record<number, QcAppealTag> {
  const tags: Record<number, QcAppealTag> = {};
  if (!appeal) return tags;
  if (appeal.decisions?.length) {
    for (const decision of appeal.decisions) {
      tags[decision.n] = decision.accept ? "Raised on appeal" : "Appeal declined";
    }
    return tags;
  }
  for (const item of appeal.items) tags[item.n] = "Under appeal";
  return tags;
}

export interface QcAmBreakdownRow {
  n: number;
  name: string;
  /** Null for N/A, which the screen writes as "N/A" rather than as a value out of five. */
  value: QcScoreValue;
  /** Against the same criterion on the previous touch; null when either is missing. */
  change: number | null;
  found?: string;
  next?: string;
  tag?: QcAppealTag;
  /** Five segments: filled up to the value, coloured by the band the value is in. */
  filled: number;
  tone: "good" | "watch" | "risk" | "none";
}

/**
 * The 17 rows of the detail panel, each with its change against the previous touch.
 *
 * The comparison is per criterion against the previous *touch*, not against the AM's average: the
 * question the panel answers is "did this call go better than my last one on this point", and an
 * average would blur the answer across months the AM has already acted on.
 */
export function breakdownRows(input: {
  crit: readonly QcScoreValue[] | undefined;
  previousCrit?: readonly QcScoreValue[] | undefined;
  notes?: Record<number, QcCriterionNote> | undefined;
  appeal?: QcAppeal | undefined;
}): QcAmBreakdownRow[] {
  const tags = appealTags(input.appeal);
  return QC_RUBRIC.map((criterion) => {
    const raw = input.crit?.[criterion.n - 1];
    const value: QcScoreValue = raw === undefined ? null : raw;
    const previousRaw = input.previousCrit?.[criterion.n - 1];
    const previous = isGraded(previousRaw) ? previousRaw : null;
    const note = input.notes?.[criterion.n];
    const graded = isGraded(value) ? value : null;
    return {
      n: criterion.n,
      name: criterion.name,
      value,
      change: graded === null || previous === null ? null : graded - previous,
      ...(note?.found ? { found: note.found } : {}),
      ...(note?.next ? { next: note.next } : {}),
      ...(tags[criterion.n] ? { tag: tags[criterion.n] } : {}),
      filled: graded === null ? 0 : graded,
      tone:
        graded === null ? "none" : graded >= 4 ? "good" : graded === 3 ? "watch" : "risk",
    };
  });
}

/** "▲ 2" / "▼ 1" / "=" / "—". A dash when there is nothing to compare against. */
export function changeLabel(change: number | null): string {
  if (change === null) return "—";
  if (change > 0) return `▲ ${change}`;
  if (change < 0) return `▼ ${Math.abs(change)}`;
  return "=";
}

/** "{v}/5", or "N/A". Never "0/5" for a criterion that did not apply. */
export function valueLabel(value: QcScoreValue): string {
  return value === null ? "N/A" : `${value}/5`;
}

// ---------------------------------------------------------------------------
// The appeal banner
// ---------------------------------------------------------------------------

/**
 * What the detail panel says about an appeal on this touch, in the AM's own terms.
 *
 * An open appeal says when it was sent and that they will be told; a resolved one says what
 * happened to the score and how many points were accepted. "Score stays {n}" rather than
 * "0 change": the AM asked a question and the answer is that the score is unchanged, which is a
 * different thing from nothing having happened.
 */
export function appealBanner(appeal: QcAppeal | undefined): string | undefined {
  if (!appeal) return undefined;
  const criteria = `${appeal.items.length} ${appeal.items.length === 1 ? "criterion" : "criteria"}`;
  if (appeal.status === "open") {
    return `Appeal sent ${amDateLabel(appeal.submittedAt)} · ${criteria}. You'll be notified when it's decided.`;
  }
  const accepted = appeal.decisions?.filter((decision) => decision.accept).length ?? 0;
  const total = appeal.decisions?.length ?? appeal.items.length;
  const movement =
    typeof appeal.to === "number" && appeal.to !== appeal.from
      ? `score ${appeal.from} → ${appeal.to}`
      : `score stays ${appeal.from}`;
  return `Appeal decided ${amDateLabel(appeal.resolvedAt)} · ${movement} · ${accepted} of ${total} accepted`;
}

/** The name of a criterion, for an appeal row. Falls back to its number rather than to nothing. */
export function criterionLabel(n: number): string {
  return criterionByNumber(n)?.name || `Criterion ${n}`;
}
