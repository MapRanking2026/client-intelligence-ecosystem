import type { PrepReviewReminder, UserPreferences } from "@/src/lib/contracts/user-preferences";
import { resolvePreferences } from "@/src/lib/contracts/user-preferences";

/**
 * The notifications MTOS raises, what gates each one, and when it is due.
 *
 * This is the half of the Settings notification switches that was missing: the switches were
 * recorded and nothing acted on them. The rules for *whether* something is due live here, pure,
 * because they are the part worth testing without a tenant -- and because a reminder that fires at
 * the wrong hour, or twice, is worse than one that does not fire at all.
 *
 * Four decisions shape it:
 *
 *  - **Two channels, and they are not interchangeable.** The three event notifications go to the
 *    bell in the header. The two digests go to the bell *and*, when the AM's Gmail can send, to
 *    their inbox. Emailing every event as it happens would mean five emails on a busy afternoon,
 *    which is how a notification system gets filtered to a folder nobody opens.
 *  - **Every notification has a dedupe key and that key is its document id.** A cron that runs
 *    daily and a touch that stays overdue for three days must produce one notification, not three.
 *    Idempotency is not a feature here, it is the whole correctness condition.
 *  - **Due-ness is measured on the AM's own clock.** "Once a day" means once per calendar day in
 *    their time zone, because an AM in Phoenix and one in Madrid do not share a morning.
 *  - **A notification always names its subject and links to it.** A notification that tells you
 *    something is wrong without saying which client is a notification you have to go and research.
 */

// ---------------------------------------------------------------------------
// The kinds
// ---------------------------------------------------------------------------

export const NOTIFICATION_KINDS = [
  "overdue_follow_through",
  "prep_finished",
  "prep_reminder",
  "client_reply",
  "daily_digest",
  "weekly_digest",
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type NotificationTone = "critical" | "important" | "positive" | "info";

/** Where each kind is delivered. See the note above on why the events are not emailed. */
export const NOTIFICATION_CHANNEL: Record<NotificationKind, "in_app" | "in_app_and_email"> = {
  overdue_follow_through: "in_app",
  prep_finished: "in_app",
  prep_reminder: "in_app",
  client_reply: "in_app",
  daily_digest: "in_app_and_email",
  weekly_digest: "in_app_and_email",
};

export const NOTIFICATION_TONE: Record<NotificationKind, NotificationTone> = {
  overdue_follow_through: "critical",
  prep_finished: "positive",
  prep_reminder: "important",
  client_reply: "important",
  daily_digest: "info",
  weekly_digest: "info",
};

export interface NotificationRecord {
  /** The dedupe key, which is also the document id. */
  id: string;
  kind: NotificationKind;
  title: string;
  detail: string;
  href?: string;
  tone: NotificationTone;
  createdAt: string;
  readAt?: string;
  /** When it was emailed. Absent on an in-app-only kind, and on a digest MTOS could not send. */
  emailedAt?: string;
  /** Why no email went out, in the AM's words. Written instead of failing quietly. */
  emailSkippedReason?: string;
  /** The touch, client or conversation this is about, so the feed can be deduped and audited. */
  subjectId?: string;
}

/** At most this many rows are kept per user; older read ones are dropped first. */
export const FEED_LIMIT = 50;

// ---------------------------------------------------------------------------
// What gates each kind
// ---------------------------------------------------------------------------

/**
 * Whether this AM wants this kind at all.
 *
 * The prep reminder is gated by its own interval preference rather than a switch -- "off" is one of
 * the four values -- so it is asked separately instead of being given a redundant on/off flag.
 */
export function isNotificationEnabled(kind: NotificationKind, preferences: UserPreferences): boolean {
  const resolved = resolvePreferences(preferences);
  if (kind === "prep_reminder") return resolved.prepReviewReminder !== "off";
  if (kind === "overdue_follow_through") return resolved.notifications.overdueFollowThrough;
  if (kind === "prep_finished") return resolved.notifications.prepFinished;
  if (kind === "client_reply") return resolved.notifications.clientRepliesInIntercom;
  if (kind === "daily_digest") return resolved.notifications.dailyDigest;
  return resolved.notifications.weeklyDigest;
}

/** How far ahead of the call the prep reminder is due. `off` has no lead time. */
export function prepReminderLeadMs(choice: PrepReviewReminder): number | null {
  if (choice === "2h") return 2 * 60 * 60 * 1000;
  if (choice === "1d") return 24 * 60 * 60 * 1000;
  if (choice === "2d") return 2 * 24 * 60 * 60 * 1000;
  return null;
}

/**
 * How often the notification run comes round, and so how much slack the reminder window needs.
 *
 * The run is not hourly, and that is a cost decision rather than a preference. Each pass reads one
 * AM's clients and touches, so an hourly run over a book of a couple of hundred clients is tens of
 * thousands of Firestore reads a day per tenant -- and this app has already had production deploys
 * fail on the daily read quota. Every two hours is twelve passes instead of twenty-four.
 *
 * The cost of that is precision, stated here rather than hidden: a reminder cannot be delivered
 * closer to the call than the gap between runs, so `prepReminderDue` widens the window by one
 * interval. A "2 hours before" reminder therefore arrives between two and four hours before the
 * call. Early is the right direction to be wrong in -- a reminder to review prep is useless after
 * the call has started, and the window is still closed at the moment it does.
 */
export const RUN_INTERVAL_MS = 2 * 60 * 60 * 1000;

/**
 * Whether a touch is inside its reminder window right now.
 *
 * Bounded on both sides on purpose. Without the upper bound a touch that has already happened
 * would still be "within a day of starting" and the AM would be reminded to review prep for a call
 * they have finished. Without the lower bound a cron that runs after the call would reach back
 * through every past touch.
 *
 * `slackMs` widens only the early edge, by one run interval, so a reminder is never missed in the
 * gap between two runs. It deliberately does not widen the late edge: the point of the reminder is
 * to arrive before the call.
 */
export function prepReminderDue(
  scheduledAt: string | undefined,
  choice: PrepReviewReminder,
  now: Date,
  slackMs: number = RUN_INTERVAL_MS,
): boolean {
  const lead = prepReminderLeadMs(choice);
  if (!lead || !scheduledAt) return false;
  const start = new Date(scheduledAt).getTime();
  if (Number.isNaN(start)) return false;
  const at = now.getTime();
  return at >= start - lead - Math.max(0, slackMs) && at < start;
}

// ---------------------------------------------------------------------------
// When a digest is due
// ---------------------------------------------------------------------------

/** The AM's own calendar day, as `2026-11-03`. Falls back to UTC for a zone Intl rejects. */
export function dayKey(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      // 2-digit on both, or `en-CA` returns "2026-11-2" and two days of one month sort wrongly
      // against each other -- and the key is also the document id a digest is deduped by.
      day: "2-digit",
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** The AM's own weekday, 1 = Monday. */
export function weekdayInZone(at: Date, timeZone: string): number {
  let label: string;
  try {
    label = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(at);
  } catch {
    label = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(at);
  }
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const index = days.indexOf(label);
  return index < 0 ? 1 : index + 1;
}

/** The Monday of the AM's current week, as a key, so a weekly digest is sent once per week. */
export function weekKey(at: Date, timeZone: string): string {
  const offsetDays = weekdayInZone(at, timeZone) - 1;
  const monday = new Date(at.getTime() - offsetDays * 24 * 60 * 60 * 1000);
  return dayKey(monday, timeZone);
}

/**
 * The dedupe key for a digest: the day for a daily one, the week's Monday for a weekly one.
 *
 * Because the key is the document id, "has today's digest already gone out" is answered by whether
 * the document exists -- there is no "last sent" timestamp to drift, and a cron that runs twice in
 * an hour writes the same id twice.
 */
export function digestKey(kind: "daily_digest" | "weekly_digest", at: Date, timeZone: string): string {
  return kind === "daily_digest"
    ? `daily_digest:${dayKey(at, timeZone)}`
    : `weekly_digest:${weekKey(at, timeZone)}`;
}

/** A weekly digest is only due on the AM's Monday. A daily one is due every day. */
export function digestDue(kind: "daily_digest" | "weekly_digest", at: Date, timeZone: string): boolean {
  return kind === "daily_digest" || weekdayInZone(at, timeZone) === 1;
}

export function notificationKey(kind: NotificationKind, subjectId: string): string {
  return `${kind}:${subjectId}`;
}

// ---------------------------------------------------------------------------
// What a digest says
// ---------------------------------------------------------------------------

export interface DigestLine {
  /** The heading this line sits under, e.g. "Follow-through overdue". */
  group: string;
  text: string;
  href?: string;
}

export function digestSubject(
  kind: "daily_digest" | "weekly_digest",
  lines: DigestLine[],
  dateLabel: string,
): string {
  const span = kind === "daily_digest" ? "Today" : "This week";
  if (!lines.length) return `MTOS · ${span}: nothing needs you — ${dateLabel}`;
  return `MTOS · ${span}: ${lines.length} ${lines.length === 1 ? "thing needs" : "things need"} you — ${dateLabel}`;
}

/**
 * The digest as plain text.
 *
 * Plain text rather than HTML because the Gmail sender MTOS already has sends `text/plain`, and
 * because this is a working list an AM scans on a phone, not a designed email. A line always
 * carries its link, so the digest is actionable from the inbox.
 */
export function digestBody(options: {
  kind: "daily_digest" | "weekly_digest";
  lines: DigestLine[];
  dateLabel: string;
  name?: string;
  baseUrl?: string;
  signoff?: string;
}): string {
  const { kind, lines, dateLabel, name, baseUrl, signoff } = options;
  const out: string[] = [];
  out.push(`${name ? `${name.split(" ")[0]}, here` : "Here"} is your ${kind === "daily_digest" ? "daily" : "weekly"} MTOS digest for ${dateLabel}.`);
  out.push("");

  if (!lines.length) {
    out.push("Nothing needs you right now: no overdue follow-through, no prep waiting on a review, and no client left waiting in Intercom.");
  } else {
    const groups = Array.from(new Set(lines.map((line) => line.group)));
    for (const group of groups) {
      out.push(`${group.toUpperCase()}`);
      for (const line of lines.filter((entry) => entry.group === group)) {
        out.push(`  - ${line.text}${line.href ? ` — ${absolute(line.href, baseUrl)}` : ""}`);
      }
      out.push("");
    }
  }

  out.push("This digest is on because you asked for it in MTOS → Settings → My profile & preferences. Turn it off there.");
  if (signoff?.trim()) {
    out.push("");
    out.push(signoff.trim());
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function absolute(href: string, baseUrl?: string): string {
  if (/^https?:\/\//.test(href)) return href;
  if (!baseUrl) return href;
  return `${baseUrl.replace(/\/$/, "")}${href}`;
}

/** The one-line summary the in-app digest row shows. */
export function digestDetail(lines: DigestLine[]): string {
  if (!lines.length) return "Nothing needs you right now.";
  const groups = Array.from(new Set(lines.map((line) => line.group)));
  return groups
    .map((group) => `${lines.filter((line) => line.group === group).length} ${group.toLowerCase()}`)
    .join(" · ");
}

// ---------------------------------------------------------------------------
// The feed
// ---------------------------------------------------------------------------

export function unreadCount(records: NotificationRecord[]): number {
  return records.filter((record) => !record.readAt).length;
}

/** Newest first, unread before read, so the bell opens on what has not been seen. */
export function sortFeed(records: NotificationRecord[]): NotificationRecord[] {
  return [...records].sort((a, b) => {
    if (Boolean(a.readAt) !== Boolean(b.readAt)) return a.readAt ? 1 : -1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/** Which rows to delete once the feed is over its limit: the oldest read ones, never an unread one. */
export function prunable(records: NotificationRecord[]): NotificationRecord[] {
  if (records.length <= FEED_LIMIT) return [];
  const read = records.filter((record) => record.readAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return read.slice(0, Math.min(read.length, records.length - FEED_LIMIT));
}
