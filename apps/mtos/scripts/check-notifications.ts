/**
 * The notification rules: what is gated, when it is due, and what a digest says.
 *
 * Pure checks: nothing is read from Firestore, no email is sent. Two things here are correctness
 * conditions rather than preferences -- a reminder must not fire for a call that has already
 * happened, and the same thing must not be raised twice -- and both are pinned below.
 */
import {
  FEED_LIMIT,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_KINDS,
  NOTIFICATION_TONE,
  dayKey,
  digestBody,
  digestDetail,
  digestDue,
  digestKey,
  digestSubject,
  isNotificationEnabled,
  notificationKey,
  prepReminderDue,
  prepReminderLeadMs,
  prunable,
  RUN_INTERVAL_MS,
  sortFeed,
  unreadCount,
  weekKey,
  weekdayInZone,
  type DigestLine,
  type NotificationKind,
  type NotificationRecord,
} from "@/src/lib/contracts/notifications";
import { DEFAULT_PREFERENCES, type UserPreferences } from "@/src/lib/contracts/user-preferences";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`FAILED: ${label}`);
}

function record(id: string, over: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id,
    kind: "overdue_follow_through",
    title: id,
    detail: "",
    tone: "critical",
    createdAt: "2026-11-01T00:00:00.000Z",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The kinds
// ---------------------------------------------------------------------------

check("there are eleven kinds", NOTIFICATION_KINDS.length === 11);
// A duplicate kind would make one of the two records silently win, and which one depends on
// declaration order rather than on anything anybody decided.
check("no kind is listed twice", new Set(NOTIFICATION_KINDS).size === NOTIFICATION_KINDS.length);
check(
  "the five QC kinds are all there",
  (["qc_ready", "qc_scored", "qc_appeal_submitted", "qc_appeal_decided", "qc_chat_requested"] as const).every(
    (kind) => NOTIFICATION_KINDS.includes(kind),
  ),
);
// A QC score is a coaching conversation. Emailing one unprompted turns it into a letter from
// management, so none of the five is on the email channel.
check(
  "no QC kind is emailed",
  NOTIFICATION_KINDS.filter((kind) => kind.startsWith("qc_")).every(
    (kind) => NOTIFICATION_CHANNEL[kind] === "in_app",
  ),
);
check("the AM's own score is the one positive QC kind", NOTIFICATION_TONE.qc_scored === "positive");
check("each has a channel", NOTIFICATION_KINDS.every((kind) => Boolean(NOTIFICATION_CHANNEL[kind])));
check("each has a tone", NOTIFICATION_KINDS.every((kind) => Boolean(NOTIFICATION_TONE[kind])));
// Emailing every event as it happens is five emails on a busy afternoon, which is how a
// notification system gets filtered into a folder nobody opens.
check(
  "only the two digests are emailed",
  NOTIFICATION_KINDS.filter((kind) => NOTIFICATION_CHANNEL[kind] === "in_app_and_email").join(",") ===
    "daily_digest,weekly_digest",
);
check("an overdue follow-through is the loudest tone", NOTIFICATION_TONE.overdue_follow_through === "critical");
check("prep finishing is good news, not a warning", NOTIFICATION_TONE.prep_finished === "positive");

// ---------------------------------------------------------------------------
// What the AM asked for
// ---------------------------------------------------------------------------

const allOff: UserPreferences = {
  notifications: {
    dailyDigest: false,
    weeklyDigest: false,
    overdueFollowThrough: false,
    clientRepliesInIntercom: false,
    prepFinished: false,
  },
  prepReviewReminder: "off",
};

check("an unset preference uses the default", isNotificationEnabled("overdue_follow_through", {}) === DEFAULT_PREFERENCES.notifications.overdueFollowThrough);
check("the digests are off until asked for", !isNotificationEnabled("daily_digest", {}));
check("turning one off turns it off", !isNotificationEnabled("overdue_follow_through", allOff));
check("turning one on turns it on", isNotificationEnabled("daily_digest", { notifications: { dailyDigest: true } }));
check("every kind can be answered", NOTIFICATION_KINDS.every((kind) => typeof isNotificationEnabled(kind, {}) === "boolean"));
// The reminder has four values and "off" is one of them, so it needs no second on/off switch.
check("the prep reminder is gated by its own interval", !isNotificationEnabled("prep_reminder", { prepReviewReminder: "off" }));
check("and is on at any real interval", isNotificationEnabled("prep_reminder", { prepReviewReminder: "2h" }));

// ---------------------------------------------------------------------------
// The prep reminder window
// ---------------------------------------------------------------------------

check("off has no lead time", prepReminderLeadMs("off") === null);
check("two hours is two hours", prepReminderLeadMs("2h") === 7_200_000);
check("one day is one day", prepReminderLeadMs("1d") === 86_400_000);
check("two days is two days", prepReminderLeadMs("2d") === 172_800_000);

const call = "2026-11-05T17:00:00.000Z";
const atCall = new Date(call);
const before = (hours: number) => new Date(atCall.getTime() - hours * 60 * 60 * 1000);

check("inside the window it is due", prepReminderDue(call, "1d", before(3), 0));
check("just inside the edge it is due", prepReminderDue(call, "2h", before(119 / 60), 0));
check("outside the window it is not", !prepReminderDue(call, "2h", before(3), 0));
// The upper bound is the one that matters: without it an AM is reminded to review the prep for a
// call they have already run.
check("after the call has started it is not", !prepReminderDue(call, "2d", new Date(atCall.getTime() + 60 * 1000), 0));
check("at the exact start it is not", !prepReminderDue(call, "1d", atCall, 0));
check("a touch with no time is never due", !prepReminderDue(undefined, "1d", atCall, 0));
check("an unparseable time is never due", !prepReminderDue("soon", "1d", atCall, 0));
check("off is never due", !prepReminderDue(call, "off", before(1 / 60), 0));

/*
  The slack, which is the price of running every two hours rather than every hour.

  A reminder must not fall in the gap between two runs, so the early edge is widened by one
  interval -- a "2 hours before" reminder can arrive up to four hours before. The late edge is
  never widened, because a reminder to review prep is useless once the call has started.
*/
check("the run interval is two hours", RUN_INTERVAL_MS === 7_200_000);
check("the default slack is one interval", prepReminderDue(call, "2h", before(3.5)));
check("and reaches a full interval early", prepReminderDue(call, "2h", before(3.9)));
check("but no further", !prepReminderDue(call, "2h", before(4.1)));
check("slack never pushes the window past the call", !prepReminderDue(call, "2h", new Date(atCall.getTime() + 1000)));
check("a negative slack is ignored rather than narrowing the window", prepReminderDue(call, "2h", before(1), -99999));

// ---------------------------------------------------------------------------
// The AM's own clock
// ---------------------------------------------------------------------------

// 2026-11-03T02:00Z is still 2 November in Phoenix and already 3 November in Madrid. "Once a day"
// has to mean once per the AM's own day, or two AMs on one tenant get each other's schedule.
const crossover = new Date("2026-11-03T02:00:00.000Z");
check("a day is the AM's day", dayKey(crossover, "America/Phoenix") === "2026-11-02");
check("and differs for another AM", dayKey(crossover, "Europe/Madrid") === "2026-11-03");
check("an impossible zone falls back to UTC rather than throwing", dayKey(crossover, "Mars/Olympus") === "2026-11-03");

// 2026-11-02 is a Monday.
check("Monday is 1", weekdayInZone(new Date("2026-11-02T18:00:00.000Z"), "UTC") === 1);
check("Sunday is 7", weekdayInZone(new Date("2026-11-01T18:00:00.000Z"), "UTC") === 7);
check("a week is keyed to its Monday", weekKey(new Date("2026-11-05T18:00:00.000Z"), "UTC") === "2026-11-02");
check("every day of a week shares one key", weekKey(new Date("2026-11-08T18:00:00.000Z"), "UTC") === weekKey(new Date("2026-11-02T18:00:00.000Z"), "UTC"));

check("a daily digest is due any day", digestDue("daily_digest", new Date("2026-11-05T18:00:00.000Z"), "UTC"));
check("a weekly digest is due on Monday", digestDue("weekly_digest", new Date("2026-11-02T18:00:00.000Z"), "UTC"));
check("and not on Thursday", !digestDue("weekly_digest", new Date("2026-11-05T18:00:00.000Z"), "UTC"));

// ---------------------------------------------------------------------------
// Raising it once
// ---------------------------------------------------------------------------

// The key is the document id, so "has this gone out already" is a document existence check and
// an hourly cron writing the same id twenty-four times writes one row.
check("a kind and a subject make one key", notificationKey("overdue_follow_through", "t1") === "overdue_follow_through:t1");
check("two subjects are two keys", notificationKey("prep_finished", "t1") !== notificationKey("prep_finished", "t2"));
check("two kinds on one subject are two keys", notificationKey("prep_finished", "t1") !== notificationKey("prep_reminder", "t1"));
check(
  "a daily digest is keyed to the day",
  digestKey("daily_digest", new Date("2026-11-05T18:00:00.000Z"), "UTC") === "daily_digest:2026-11-05",
);
check(
  "twice in one day is the same key",
  digestKey("daily_digest", new Date("2026-11-05T06:00:00.000Z"), "UTC") ===
    digestKey("daily_digest", new Date("2026-11-05T22:00:00.000Z"), "UTC"),
);
check(
  "a weekly digest is keyed to its Monday",
  digestKey("weekly_digest", new Date("2026-11-05T18:00:00.000Z"), "UTC") === "weekly_digest:2026-11-02",
);

// ---------------------------------------------------------------------------
// What a digest says
// ---------------------------------------------------------------------------

const lines: DigestLine[] = [
  { group: "Follow-through overdue", text: "Oakline Dental — the deadline passed on Mon, Nov 2.", href: "/monthly-touch/t1/follow-through" },
  { group: "Follow-through overdue", text: "Riverside Plumbing — the deadline passed on Tue, Nov 3.", href: "/monthly-touch/t2/follow-through" },
  { group: "Clients waiting on us", text: "Tempe Auto is waiting on a reply.", href: "https://app.intercom.com/a/1" },
];

check("the subject counts what needs the AM", digestSubject("daily_digest", lines, "Tue, Nov 3").includes("3 things need you"));
check("one thing reads as one thing", digestSubject("daily_digest", lines.slice(0, 1), "Tue, Nov 3").includes("1 thing needs you"));
check("a quiet day says so in the subject", digestSubject("daily_digest", [], "Tue, Nov 3").includes("nothing needs you"));
check("a weekly digest says so", digestSubject("weekly_digest", lines, "Mon, Nov 2").includes("This week"));

const body = digestBody({ kind: "daily_digest", lines, dateLabel: "Tue, Nov 3", name: "Ana Ruiz", baseUrl: "https://mtos.example.com" });
check("the body opens with their first name only", body.startsWith("Ana, here"));
check("every line is in it", lines.every((line) => body.includes(line.text)));
check("the groups are headed", body.includes("FOLLOW-THROUGH OVERDUE") && body.includes("CLIENTS WAITING ON US"));
// A digest read on a phone is only useful if each line can be opened from the inbox.
check("a relative link is made absolute", body.includes("https://mtos.example.com/monthly-touch/t1/follow-through"));
check("an absolute link is left alone", body.includes("https://app.intercom.com/a/1"));
check("it says where the digest was switched on", body.includes("Settings"));
check("and how to turn it off", body.includes("Turn it off"));
check("a quiet digest still says what it checked", digestBody({ kind: "daily_digest", lines: [], dateLabel: "Tue, Nov 3" }).includes("no overdue follow-through"));
check(
  "the sign-off is appended when they have one",
  digestBody({ kind: "daily_digest", lines: [], dateLabel: "Tue", signoff: "Ana\nMap Ranking" }).includes("Ana\nMap Ranking"),
);
check("a relative link with no base url is left as it is", digestBody({ kind: "daily_digest", lines, dateLabel: "Tue" }).includes("/monthly-touch/t1/follow-through"));

check("the in-app line counts by group", digestDetail(lines) === "2 follow-through overdue · 1 clients waiting on us");
check("a quiet one says so", digestDetail([]) === "Nothing needs you right now.");

// ---------------------------------------------------------------------------
// The feed
// ---------------------------------------------------------------------------

const feed = [
  record("a", { createdAt: "2026-11-01T00:00:00.000Z", readAt: "2026-11-02T00:00:00.000Z" }),
  record("b", { createdAt: "2026-11-02T00:00:00.000Z" }),
  record("c", { createdAt: "2026-11-03T00:00:00.000Z" }),
];
check("unread are counted", unreadCount(feed) === 2);
check("nothing unread counts zero", unreadCount([record("a", { readAt: "x" })]) === 0);
check("unread come first", sortFeed(feed).map((row) => row.id).join("") === "cba");
check("and newest first within that", sortFeed(feed)[0].id === "c");

const long = Array.from({ length: FEED_LIMIT + 5 }, (_, index) =>
  record(`r${index}`, {
    createdAt: `2026-10-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    ...(index < 10 ? { readAt: "2026-11-01T00:00:00.000Z" } : {}),
  }),
);
check("an over-long feed is pruned", prunable(long).length === 5);
// An unread notification is the only thing in the feed that still has a job to do.
check("and only read rows are ever pruned", prunable(long).every((row) => Boolean(row.readAt)));
check("the oldest read rows go first", prunable(long).every((row) => row.createdAt <= "2026-10-10T00:00:00.000Z"));
check("a feed inside its limit is not pruned", prunable(feed).length === 0);
check(
  "a feed over the limit with nothing read prunes nothing",
  prunable(Array.from({ length: FEED_LIMIT + 3 }, (_, index) => record(`u${index}`))).length === 0,
);

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - the Firestore writes, which need a real tenant and are what makes dedupe real");
console.log("  - the Gmail send, which needs a connection authorized for sending");
console.log("  - the Intercom lookup per client, and the cap on how many are checked per run");
if (failed) process.exit(1);

// Keeps the kind union honest if a kind is ever added without a channel or a tone.
const _exhaustive: Record<NotificationKind, true> = {
  overdue_follow_through: true,
  prep_finished: true,
  prep_reminder: true,
  client_reply: true,
  daily_digest: true,
  weekly_digest: true,
  qc_ready: true,
  qc_scored: true,
  qc_appeal_submitted: true,
  qc_appeal_decided: true,
  qc_chat_requested: true,
};
void _exhaustive;
