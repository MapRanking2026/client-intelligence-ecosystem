/**
 * The pop-up toast: which notifications get one, once each.
 *
 * Pure checks: nothing is read from or written to Firestore.
 *
 * The rule the whole suite protects: **once, ever.** A toast interrupts, so the cost of getting
 * this wrong is not a cosmetic repeat -- it is teaching people to dismiss the thing without
 * reading it. So the checks come at it from every side a bug could enter: a record already
 * toasted, one already read, one read on another device, more than three at once, and the stamp
 * that must not be confused with a read mark.
 */
import {
  TOAST_ACCENT,
  TOAST_CTA,
  TOAST_EYEBROW,
  TOAST_LIMIT,
  TOAST_MAX_AGE_HOURS,
  shouldToast,
  toastQueue,
} from "@/src/lib/contracts/notification-toasts";
import {
  NOTIFICATION_KINDS,
  type NotificationKind,
  type NotificationRecord,
} from "@/src/lib/contracts/notifications";

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

/*
  A fixed clock, passed to everything.

  The age limit makes these functions time-dependent, and a suite that let them read the real
  clock would pass today and fail in a month as its fixtures aged past the window -- which is
  exactly the bug the limit exists to cause on purpose.
*/
const NOW = new Date("2026-07-12T12:00:00.000Z");
function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 3_600_000).toISOString();
}

function record(partial: Partial<NotificationRecord> & { id: string }): NotificationRecord {
  return {
    kind: "qc_scored",
    title: "Your QC score is ready",
    detail: "Oakline Dental Group · Jul 3, 2026 · 84 (B)",
    tone: "positive",
    createdAt: hoursAgo(3),
    href: "/qa?touch=t1",
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Which records are due a toast
// ---------------------------------------------------------------------------

check("a fresh unread notification is toasted", shouldToast(record({ id: "a" }), NOW));
// Its one turn has been taken. This is the condition the whole feature rests on.
check(
  "an already toasted notification is not toasted again",
  !shouldToast(record({ id: "b", toastedAt: hoursAgo(2) }), NOW),
);
// Already acted on somewhere else: a pop-up afterwards is news about something done.
check(
  "an already read notification is not toasted",
  !shouldToast(record({ id: "c", readAt: hoursAgo(2) }), NOW),
);
check(
  "read and toasted is not toasted",
  !shouldToast(record({ id: "d", readAt: "x", toastedAt: "y" }), NOW),
);

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

const queue = toastQueue(
  [
    record({ id: "old", createdAt: hoursAgo(20) }),
    record({ id: "new", createdAt: hoursAgo(1) }),
    record({ id: "mid", createdAt: hoursAgo(10) }),
  ],
  NOW,
);
check("newest first", queue.map((toast) => toast.id).join() === "new,mid,old");
check("an empty feed toasts nothing", toastQueue([], NOW).length === 0);

const five = toastQueue(
  [
    record({ id: "1", createdAt: hoursAgo(20) }),
    record({ id: "2", createdAt: hoursAgo(16) }),
    record({ id: "3", createdAt: hoursAgo(12) }),
    record({ id: "4", createdAt: hoursAgo(8) }),
    record({ id: "5", createdAt: hoursAgo(4) }),
  ],
  NOW,
);
check(`at most ${TOAST_LIMIT} at a time`, five.length === TOAST_LIMIT);
// The limit spreads them out. It must take the newest, not the first three it happened to see.
check("the limit keeps the newest", five.map((toast) => toast.id).join() === "5,4,3");

const mixed = toastQueue(
  [
    record({ id: "fresh" }),
    record({ id: "seen", toastedAt: hoursAgo(2) }),
    record({ id: "read", readAt: hoursAgo(2) }),
    record({ id: "stale", createdAt: hoursAgo(TOAST_MAX_AGE_HOURS + 1) }),
  ],
  NOW,
);
check("only the eligible ones are queued", mixed.map((toast) => toast.id).join() === "fresh");

// ---------------------------------------------------------------------------
// Age
//
// The reason this limit exists: on the day it shipped one account manager had eighteen unread
// notifications, which without it would have popped up three at a time over six page loads
// announcing briefs that finished weeks earlier.
// ---------------------------------------------------------------------------

check(
  `nothing older than ${TOAST_MAX_AGE_HOURS} h pops up`,
  !shouldToast(record({ id: "stale", createdAt: hoursAgo(TOAST_MAX_AGE_HOURS + 1) }), NOW),
);
check(
  "something just inside the window still pops up",
  shouldToast(record({ id: "edge", createdAt: hoursAgo(TOAST_MAX_AGE_HOURS - 0.5) }), NOW),
);
check(
  "exactly at the limit still pops up",
  shouldToast(record({ id: "exact", createdAt: hoursAgo(TOAST_MAX_AGE_HOURS) }), NOW),
);
// A backfill of old unread rows must produce nothing at all, not a trickle.
const backfill = toastQueue(
  Array.from({ length: 18 }, (_, index) =>
    record({ id: `old-${index}`, createdAt: hoursAgo(72 + index) }),
  ),
  NOW,
);
check("eighteen weeks-old unread rows pop up nothing", backfill.length === 0);
// A date nothing can parse could be any age, and the safe reading of that is "too old".
check(
  "an unreadable date does not pop up",
  !shouldToast(record({ id: "bad", createdAt: "nope" }), NOW),
);

// ---------------------------------------------------------------------------
// What each card says
// ---------------------------------------------------------------------------

const scored = toastQueue([record({ id: "s", kind: "qc_scored" })], NOW)[0];
check("an AM's score is teal", scored.accent === "am");
check("an AM's eyebrow says it is theirs", scored.eyebrow === "Your QC");
check("the CTA is the next action, not a destination", scored.cta === "See my score");
check("the title comes from the record", scored.title === "Your QC score is ready");
check("the detail comes from the record", scored.detail.includes("84 (B)"));
check("the link comes from the record", scored.href === "/qa?touch=t1");

const ready = toastQueue([record({ id: "r", kind: "qc_ready", href: "/qa?qc=t1" })], NOW)[0];
check("work arriving for a reviewer is violet", ready.accent === "qc");
check("a reviewer's eyebrow says QC", ready.eyebrow === "QC");
check("the reviewer's CTA starts the work", ready.cta === "Start QC");

const appeal = toastQueue([record({ id: "ap", kind: "qc_appeal_submitted" })], NOW)[0];
check("an appeal arriving is violet", appeal.accent === "qc");
check("an appeal's CTA is to review it", appeal.cta === "Review appeal");
check(
  "an appeal decision is the AM's news",
  toastQueue([record({ id: "ad", kind: "qc_appeal_decided" })], NOW)[0].accent === "am",
);
check(
  "a chat request is the reviewer's",
  toastQueue([record({ id: "ch", kind: "qc_chat_requested" })], NOW)[0].accent === "qc",
);
check(
  "an older kind is neutral",
  toastQueue([record({ id: "o", kind: "overdue_follow_through" })], NOW)[0].accent === "neutral",
);
check(
  "a neutral eyebrow says MTOS",
  toastQueue([record({ id: "o2", kind: "daily_digest" })], NOW)[0].eyebrow === "MTOS",
);

const noHref = toastQueue([record({ id: "n", href: undefined })], NOW)[0];
// A card with no link renders no button rather than a button that goes nowhere.
check("a record with no link carries none", noHref.href === undefined);

// ---------------------------------------------------------------------------
// Every kind is covered
//
// A kind added without an entry here would fall back to "neutral" and "Open" silently, which is
// how a new QC notification would quietly arrive looking like a digest.
// ---------------------------------------------------------------------------

for (const kind of NOTIFICATION_KINDS as readonly NotificationKind[]) {
  check(`${kind} has an accent`, Boolean(TOAST_ACCENT[kind]));
  check(`${kind} has a CTA`, Boolean(TOAST_CTA[kind]) && TOAST_CTA[kind].length > 1);
}
check("every accent has an eyebrow", ["qc", "am", "neutral"].every((accent) => Boolean(TOAST_EYEBROW[accent as "qc"])));

console.log(`\n${passed} passed, ${failed} failed`);
console.log("Not covered by these checks:");
console.log("  - the `toastedAt` write, which needs a database");
console.log("  - how a card looks, and that dismissing one leaves the bell row unread");
if (failed) process.exit(1);
