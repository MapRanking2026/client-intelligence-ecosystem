import { isUnreadScore, rowScore } from "@/src/lib/contracts/qc-am";
import { LATE_AFTER_HOURS, sortQueueOldestFirst, waitLabel } from "@/src/lib/contracts/qc-queue";
import { qcDateLabel } from "@/src/lib/contracts/qc-dates";
import type { QcIndexRow } from "@/src/lib/contracts/qc-record";

/**
 * The Command Center's QC cards (handoff §6.9).
 *
 * Pure, and built only from index rows -- the same hundred-byte documents the queue reads. The
 * Command Center is the first screen everybody opens in the morning, so a card that cost a touch
 * read each would put the most-loaded page in the app on the read pattern that failed the deploys
 * of 2026-11-02.
 *
 * ## Two different readers, two different questions
 *
 * A **reviewer** wants to know what has arrived and how long it has been sitting there, oldest
 * first, because that is the order they will work it. A card for them is a piece of work.
 *
 * An **account manager** wants to know what has happened to something of theirs. A card for them
 * is news, and it disappears once they have read the score -- not once they have seen the card.
 * Those are different moments: dismissing a card is not the same as having read what it was about,
 * and a card that cleared on sight would let a score go unseen with nothing left to say so.
 *
 * ## The only alarm is the wait
 *
 * A touch past twenty-four hours is the one thing on these cards that turns red, because that is
 * the promise made to the AM when they pressed Finish. Everything else is neutral: a Command
 * Center where four cards shout has no way to say which one matters.
 */

export type QcCardTone = "qc" | "watch" | "risk" | "good";

export interface QcCommandCard {
  /** The touch id. Stable, so React keys and the links agree. */
  id: string;
  /** What sort of card this is, for the heading above the group. */
  kind: "ready" | "in_progress" | "appeal" | "score_ready" | "appeal_decided";
  label: string;
  client: string;
  detail: string;
  href: string;
  cta: string;
  tone: QcCardTone;
  /** Only on a reviewer's card: how long it has waited, and whether that is late. */
  wait?: { text: string; late: boolean };
}

/**
 * What is waiting for the reviewer, oldest first.
 *
 * Appeals come first within the list regardless of age: an appeal is somebody waiting on an answer
 * about a score they have already been given, which is a worse thing to leave than an unscored
 * touch. Within each group the order is by wait, longest first.
 */
export function reviewerQcCards(
  rows: readonly QcIndexRow[],
  now: Date = new Date(),
): QcCommandCard[] {
  const appeals = sortQueueOldestFirst(rows.filter((row) => row.status === "appealed"));
  const queued = sortQueueOldestFirst(
    rows.filter((row) => row.status === "ready" || row.status === "in_progress"),
  );

  const appealCards: QcCommandCard[] = appeals.map((row) => {
    const count = row.appealCount;
    return {
      id: row.touchId,
      kind: "appeal",
      label: "Appeal to review",
      client: row.client,
      detail: [
        row.am || "An account manager",
        // Only claimed when the appeal recorded one. A row saying "0 criteria" would be describing
        // an appeal that could not exist.
        ...(typeof count === "number" ? [`${count} ${count === 1 ? "criterion" : "criteria"}`] : []),
        typeof row.score === "number" ? `score ${row.score}` : "score —",
      ].join(" · "),
      href: `/qa?appeal=${row.touchId}`,
      cta: "Review appeal",
      tone: "qc",
    };
  });

  const queueCards: QcCommandCard[] = queued.map((row) => {
    const wait = waitLabel(row.readyAt, now);
    return {
      id: row.touchId,
      kind: row.status === "in_progress" ? "in_progress" : "ready",
      label: row.status === "in_progress" ? "QC in progress" : "Ready for QC",
      client: row.client,
      detail: `${row.am || "An account manager"} · Monthly Touch · ${qcDateLabel(row.date)}`,
      href: `/qa?qc=${row.touchId}`,
      cta: row.status === "in_progress" ? "Continue QC" : "Start QC",
      // Red only past the promise. See the file note.
      tone: wait.late ? "risk" : row.status === "in_progress" ? "watch" : "qc",
      ...(wait.text ? { wait: { text: wait.text, late: wait.late } } : {}),
    };
  });

  return [...appealCards, ...queueCards];
}

/**
 * What has happened to this AM's own touches that they have not read yet.
 *
 * `scored` and `appeal_resolved` only. `reviewed` means they opened it, and an `appealed` touch is
 * their own open question rather than news for them -- a card telling an AM their appeal exists
 * would be the app reminding them of something they did.
 */
export function amQcCards(rows: readonly QcIndexRow[]): QcCommandCard[] {
  return rows
    .filter((row) => isUnreadScore(row.status))
    .sort((a, b) => (b.scoredAt || b.readyAt).localeCompare(a.scoredAt || a.readyAt))
    .map((row) => {
      const score = rowScore(row);
      const decided = row.status === "appeal_resolved";
      return {
        id: row.touchId,
        kind: decided ? ("appeal_decided" as const) : ("score_ready" as const),
        label: decided ? "Appeal decided" : "QC score ready",
        client: row.client,
        detail: [
          qcDateLabel(row.date),
          // A dash, never a zero: an unscored touch shown as 0 reads as a catastrophic review.
          score === null ? "no criterion applied" : `${score}${row.rating ? ` (${row.rating})` : ""}`,
        ].join(" · "),
        href: `/qa?touch=${row.touchId}`,
        cta: decided ? "See the decision" : "See my score",
        tone: decided ? ("qc" as const) : ("good" as const),
      };
    });
}

/**
 * The heading for a group of cards, and the count beside it.
 *
 * Plural handled rather than "1 touches". It reads as carelessness in the one place where the app
 * is telling somebody their work is late.
 */
export function qcCardsHeading(cards: readonly QcCommandCard[], forReviewer: boolean): string {
  if (!cards.length) return forReviewer ? "Nothing is waiting for QC" : "No new QC scores";
  const late = cards.filter((card) => card.wait?.late).length;
  if (forReviewer) {
    const base = `${cards.length} ${cards.length === 1 ? "touch needs" : "touches need"} QC`;
    return late ? `${base} · ${late} over ${LATE_AFTER_HOURS} h` : base;
  }
  return `${cards.length} new QC ${cards.length === 1 ? "result" : "results"}`;
}
