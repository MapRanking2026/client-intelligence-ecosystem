import type { NotificationKind, NotificationRecord } from "@/src/lib/contracts/notifications";

/**
 * The pop-up toast: which notifications get one, once each, and what its button says.
 *
 * Pure. The rule that makes this worth its own file is **once, ever** -- a toast is shown the first
 * time the person loads any page after the notification was created, and then never again. That is
 * recorded as `toastedAt` on the notification itself rather than in the browser, because the
 * alternative is a toast that reappears on a second device, or after a cache clear, announcing
 * news that is a week old. A score "just arrived" three times is worse than not being toasted at
 * all: it teaches people to dismiss the thing without reading it.
 *
 * ## A toast is not the bell
 *
 * The bell is a list you go and look at. A toast interrupts. So the two are gated differently: the
 * bell shows everything in the feed, and a toast is only for a notification that is **both unread
 * and not yet toasted**. Something the person has already read elsewhere -- clicked through from
 * the queue, say -- never pops up to tell them about it afterwards.
 *
 * ## Three at a time
 *
 * A reviewer who opens MTOS after a busy afternoon may have eight notifications. Eight stacked
 * cards is a wall, and the ninth would be off-screen anyway. The newest three are shown; the rest
 * stay unread in the bell, which is where a list belongs. They are *not* marked as toasted, so
 * they will pop up on the next page load -- the limit spreads them out rather than swallowing
 * them.
 */

/** At most this many toasts on screen at once. */
export const TOAST_LIMIT = 3;

/**
 * Nothing older than this ever pops up.
 *
 * A toast says "this just happened". Without an age limit, two things break it. The first time
 * this ships, everybody's existing unread notifications become toast-worthy -- measured on
 * 2026-11-05, one account manager had eighteen unread rows, which would have popped up three at a
 * time over six page loads announcing briefs finished weeks ago. And anybody back from a week away
 * would get the same treatment.
 *
 * So age is a condition, not just order. Something older than a day is still unread in the bell,
 * where a list belongs; it just stops interrupting. There is no migration and no cutoff date to
 * maintain -- old rows age out on their own.
 */
export const TOAST_MAX_AGE_HOURS = 24;

/** The coloured eyebrow at the top of the card, and what it means. */
export type ToastAccent = "qc" | "am" | "neutral";

/**
 * Which side of the QC conversation this notification is.
 *
 * Violet is QC's own colour, used on the queue and the scoring screen; teal is the AM's, used on
 * their coaching page. A reviewer therefore learns that violet means work has arrived for them,
 * and an AM that teal means something of theirs has been looked at. Everything that is not QC is
 * neutral, because the five older kinds have no second party.
 */
export const TOAST_ACCENT: Record<NotificationKind, ToastAccent> = {
  overdue_follow_through: "neutral",
  prep_finished: "neutral",
  prep_reminder: "neutral",
  client_reply: "neutral",
  daily_digest: "neutral",
  weekly_digest: "neutral",
  // Raised for the reviewer: work has arrived.
  qc_ready: "qc",
  qc_appeal_submitted: "qc",
  qc_chat_requested: "qc",
  // Raised for the AM: something of theirs has been looked at.
  qc_scored: "am",
  qc_appeal_decided: "am",
};

/** The small label on the eyebrow. Says who the card is from, not what it is about. */
export const TOAST_EYEBROW: Record<ToastAccent, string> = {
  qc: "QC",
  am: "Your QC",
  neutral: "MTOS",
};

/**
 * What the button says.
 *
 * Each one is the next action rather than a destination: "Start QC" rather than "Open queue",
 * "See my score" rather than "Open QA & Coaching". A button named after a screen makes the reader
 * work out what they are supposed to do when they get there.
 */
export const TOAST_CTA: Record<NotificationKind, string> = {
  overdue_follow_through: "Open",
  prep_finished: "Review the brief",
  prep_reminder: "Review the brief",
  client_reply: "Open",
  daily_digest: "Open",
  weekly_digest: "Open",
  qc_ready: "Start QC",
  qc_scored: "See my score",
  qc_appeal_submitted: "Review appeal",
  qc_appeal_decided: "See my score",
  qc_chat_requested: "Open",
};

export interface ToastView {
  id: string;
  kind: NotificationKind;
  accent: ToastAccent;
  eyebrow: string;
  title: string;
  detail: string;
  cta: string;
  href?: string;
}

/**
 * Whether one record is due a toast.
 *
 * Three conditions: never toasted, still unread, and recent. A record with `toastedAt` has had its
 * one turn. A record the person has already read needs no interruption. A record older than
 * `TOAST_MAX_AGE_HOURS` has missed its moment -- see that constant for the two ways an age limit
 * earns its place.
 *
 * An unreadable `createdAt` does not toast. A date nothing can parse could be any age, and the
 * safe reading of "any age" here is "too old".
 */
export function shouldToast(record: NotificationRecord, now: Date = new Date()): boolean {
  if (record.toastedAt || record.readAt) return false;
  const created = new Date(record.createdAt).getTime();
  if (Number.isNaN(created)) return false;
  const ageHours = (now.getTime() - created) / 3_600_000;
  return ageHours <= TOAST_MAX_AGE_HOURS;
}

/**
 * The toasts to show now, newest first, at most three.
 *
 * The caller marks exactly these as toasted. Anything beyond the limit is deliberately left
 * unmarked so it gets its turn on the next load.
 */
export function toastQueue(
  records: readonly NotificationRecord[],
  now: Date = new Date(),
): ToastView[] {
  return [...records]
    .filter((record) => shouldToast(record, now))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, TOAST_LIMIT)
    .map((record) => {
      const accent = TOAST_ACCENT[record.kind] || "neutral";
      return {
        id: record.id,
        kind: record.kind,
        accent,
        eyebrow: TOAST_EYEBROW[accent],
        title: record.title,
        detail: record.detail,
        cta: TOAST_CTA[record.kind] || "Open",
        ...(record.href ? { href: record.href } : {}),
      };
    });
}
