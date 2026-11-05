import {
  type QcIndexRow,
  type QcStatus,
  type QcTone,
  qcWaitingHours,
} from "@/src/lib/contracts/qc-record";

/**
 * The QC queue's view model: which rows go in which tab, in what order, and what each one says.
 *
 * Pure. The queue is four lists over the same index collection, and every decision about it is one
 * a test can make without Firestore: what counts as waiting, what counts as late, what order a
 * reviewer sees work in, and what the page says when there is nothing to do.
 *
 * ## Oldest first is a fairness rule, not a default
 *
 * The queue sorts ascending by `readyAt` while every other list in this app sorts newest first.
 * That is deliberate: a reviewer works down the list, so newest-first would mean the touch that
 * has been waiting longest is the one at the bottom that never gets reached. The AM waiting on it
 * is the one who finished their follow-through first.
 *
 * ## Twenty-four hours is the promise
 *
 * `LATE_AFTER_HOURS` is why the wait turns red. The AM was told "you'll get a notification when
 * it's scored" when they pressed Finish, and a day is the point at which that stops being true
 * enough. The threshold lives here rather than in the component so the Command Center cards and
 * the queue cannot disagree about which touches are late.
 */

/** Past this many hours a waiting touch is shown in red. */
export const LATE_AFTER_HOURS = 24;

export type QcQueueTab = "queue" | "appeals" | "scored" | "team";

export const QC_QUEUE_TABS: QcQueueTab[] = ["queue", "appeals", "scored", "team"];

export const QC_TAB_LABEL: Record<QcQueueTab, string> = {
  queue: "Queue",
  appeals: "Appeals",
  scored: "Scored",
  team: "Team",
};

/** A tab name from a URL, or the default. Anything unrecognised falls back rather than 404s. */
export function parseQueueTab(raw: string | undefined): QcQueueTab {
  return QC_QUEUE_TABS.find((tab) => tab === raw) || "queue";
}

// ---------------------------------------------------------------------------
// Which rows belong where
// ---------------------------------------------------------------------------

/** Waiting to be scored, or part-scored. The work. */
export const QC_QUEUE_STATUSES: QcStatus[] = ["ready", "in_progress"];

/**
 * Statuses that belong in the Scored tab.
 *
 * `appealed` is in both Appeals and Scored on purpose: the appeal is work to do, and the score is
 * still a score that happened. Leaving it out of Scored would make a touch disappear from the
 * history the moment its AM questioned it.
 */
export const QC_SCORED_STATUSES: QcStatus[] = ["scored", "reviewed", "appealed", "appeal_resolved"];

export function isQueued(status: QcStatus): boolean {
  return QC_QUEUE_STATUSES.includes(status);
}

export function isScored(status: QcStatus): boolean {
  return QC_SCORED_STATUSES.includes(status);
}

/** Oldest first -- see the note above. Rows with an unreadable `readyAt` sort last. */
export function sortQueueOldestFirst<T extends { readyAt: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => {
    const a = Date.parse(left.readyAt);
    const b = Date.parse(right.readyAt);
    if (Number.isNaN(a) && Number.isNaN(b)) return 0;
    if (Number.isNaN(a)) return 1;
    if (Number.isNaN(b)) return -1;
    return a - b;
  });
}

/** Newest first, by when it was scored where that is known and by `readyAt` otherwise. */
export function sortScoredNewestFirst<T extends { readyAt: string; scoredAt?: string }>(
  rows: readonly T[],
): T[] {
  const key = (row: T) => {
    const at = Date.parse(row.scoredAt || row.readyAt);
    return Number.isNaN(at) ? -Infinity : at;
  };
  return [...rows].sort((left, right) => key(right) - key(left));
}

// ---------------------------------------------------------------------------
// What each row says
// ---------------------------------------------------------------------------

export interface QcWaitLabel {
  /** "Waiting 7 h", or undefined when `readyAt` cannot be read. */
  text?: string;
  /** True past `LATE_AFTER_HOURS`, which is what turns it red. */
  late: boolean;
  hours: number | null;
}

export function waitLabel(readyAt: string | undefined, now: Date = new Date()): QcWaitLabel {
  const hours = qcWaitingHours(readyAt, now);
  if (hours === null) return { late: false, hours: null };
  return { text: `Waiting ${hours} h`, late: hours > LATE_AFTER_HOURS, hours };
}

/** The queue row's status chip. Violet for untouched work, amber for work someone has opened. */
export function queueStatusChip(status: QcStatus): { label: string; tone: "qc" | "watch" } {
  return status === "in_progress"
    ? { label: "In progress", tone: "watch" }
    : { label: "Ready", tone: "qc" };
}

/** The queue row's button: a reviewer either begins or resumes. */
export function queueActionLabel(status: QcStatus): string {
  return status === "in_progress" ? "Continue QC" : "Start QC";
}

/**
 * The Scored row's status chip.
 *
 * `reviewerName` is a parameter rather than a constant because the reviewer is tenant data
 * (`qcReviewerUserIds`), not a name to compile in. Without one the chip says "Appeal open", which
 * is true in every tenant.
 */
export function scoredStatusLabel(status: QcStatus, reviewerName?: string): string {
  if (status === "reviewed") return "Reviewed";
  if (status === "appealed") return reviewerName ? `Appeal with ${reviewerName}` : "Appeal open";
  if (status === "appeal_resolved") return "Appeal decided";
  return "Waiting for AM";
}

/** "{ok} of {total} follow-through checks", green only when every one passed. */
export function evidenceSummary(evidence: readonly { ok: boolean }[] | undefined): {
  text: string;
  tone: QcTone;
  ok: number;
  total: number;
} {
  const total = evidence?.length || 0;
  const ok = (evidence || []).filter((row) => row.ok).length;
  return {
    text: `${ok} of ${total} follow-through checks`,
    // Amber rather than red: a skipped step is information for the reviewer, not a failure of the
    // touch. The reviewer is the one who decides what it cost.
    tone: total > 0 && ok === total ? "good" : "watch",
    ok,
    total,
  };
}

/** "48 min", or a dash. A call that was never clocked has no length; see `TouchQc.callLengthMin`. */
export function callLengthLabel(minutes: number | undefined): string {
  return typeof minutes === "number" && minutes > 0 ? `${minutes} min` : "—";
}

/** Initials for a row avatar. Empty string in, empty string out -- never a crash on a blank name. */
export function rowInitials(name: string | undefined): string {
  return (name || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

// ---------------------------------------------------------------------------
// The header
// ---------------------------------------------------------------------------

export interface QcQueueCounts {
  queue: number;
  appeals: number;
  scored: number;
  team: number;
}

export function queueCounts(rows: readonly QcIndexRow[], amCount: number): QcQueueCounts {
  return {
    queue: rows.filter((row) => isQueued(row.status)).length,
    appeals: rows.filter((row) => row.status === "appealed").length,
    scored: rows.filter((row) => isScored(row.status)).length,
    team: amCount,
  };
}

/**
 * The page title.
 *
 * Plural handled explicitly because this line is the first thing a reviewer reads, and "1 monthly
 * touches" is the kind of detail that makes a tool feel unfinished. A clear queue gets its own
 * sentence rather than "0 monthly touches are ready".
 */
export function queueTitle(queue: number, appeals: number): string {
  if (!queue && !appeals) return "Your QC queue is clear.";
  const parts: string[] = [];
  if (queue) {
    parts.push(`${queue} monthly ${queue === 1 ? "touch is" : "touches are"} ready for QC.`);
  }
  if (appeals) {
    parts.push(`${appeals} ${appeals === 1 ? "appeal" : "appeals"} to review.`);
  }
  return parts.join(" ");
}
