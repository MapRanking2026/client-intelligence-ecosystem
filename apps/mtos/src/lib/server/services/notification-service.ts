import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import {
  tenantUserNotificationPath,
  tenantUserNotificationsCollectionPath,
} from "@/src/lib/server/firebase/collections";
import { withQuotaFallback } from "@/src/lib/server/firebase/quota";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { sendGmailText } from "@/src/lib/server/gmail";
import { isIntercomConnected, readClientInbox } from "@/src/lib/server/services/intercom-service";
import { listTenantUserContexts, listActiveTenantIds } from "@/src/lib/server/services/daily-sync-service";
import {
  getAccountManagerPreferences,
  getAccountManagerProfile,
} from "@/src/lib/server/services/user-service";
import { resolvePreferences } from "@/src/lib/contracts/user-preferences";
import { TOAST_LIMIT } from "@/src/lib/contracts/notification-toasts";
import {
  NOTIFICATION_CHANNEL,
  NOTIFICATION_TONE,
  digestBody,
  digestDetail,
  digestDue,
  digestKey,
  digestSubject,
  isNotificationEnabled,
  notificationKey,
  prepReminderDue,
  prunable,
  sortFeed,
  type DigestLine,
  type NotificationKind,
  type NotificationRecord,
} from "@/src/lib/contracts/notifications";

/**
 * The senders behind the notification preferences.
 *
 * The preferences existed and nothing acted on them. This is what acts on them: one pass per AM
 * that looks at their own real data, decides what needs them, writes it to their feed once, and
 * emails the digest they asked for.
 *
 * What it does NOT do is decide anything on the AM's behalf. Every notification is a statement
 * about a record that already exists -- a touch whose follow-through is past its deadline, a brief
 * that finished drafting, a client waiting in Intercom -- and every one links to that record.
 * Nothing is written to a client, nothing is created in ClickUp, and the only outward action is a
 * plain-text digest to the AM's own address.
 *
 * Idempotency is the whole correctness condition: the cron runs daily, and a touch stays overdue
 * for as long as it stays overdue. Each notification's dedupe key is its document id, so raising
 * one twice writes the same document twice and the AM sees one row.
 */

/** How many clients one run may check in Intercom. See `clientReplyCandidates`. */
const INTERCOM_CLIENT_CAP = 20;

/** How far either side of today a touch counts as "active" for the Intercom check. */
const ACTIVE_TOUCH_WINDOW_DAYS = 14;

interface Candidate {
  kind: NotificationKind;
  subjectId: string;
  title: string;
  detail: string;
  href?: string;
  /** Which digest heading this sits under when it reaches a digest. */
  group: string;
}

// ---------------------------------------------------------------------------
// Reading and writing the feed
// ---------------------------------------------------------------------------

function toRecord(id: string, data: Record<string, unknown>): NotificationRecord | null {
  const kind = data.kind;
  if (typeof kind !== "string") return null;
  return {
    id,
    kind: kind as NotificationKind,
    title: String(data.title || ""),
    detail: String(data.detail || ""),
    tone: (data.tone as NotificationRecord["tone"]) || "info",
    createdAt: String(data.createdAt || ""),
    ...(typeof data.href === "string" ? { href: data.href } : {}),
    ...(typeof data.readAt === "string" ? { readAt: data.readAt } : {}),
    ...(typeof data.toastedAt === "string" ? { toastedAt: data.toastedAt } : {}),
    ...(typeof data.emailedAt === "string" ? { emailedAt: data.emailedAt } : {}),
    ...(typeof data.emailSkippedReason === "string" ? { emailSkippedReason: data.emailSkippedReason } : {}),
    ...(typeof data.subjectId === "string" ? { subjectId: data.subjectId } : {}),
  };
}

/** The AM's feed, newest and unread first. Never throws: the bell must not break a page. */
export async function listNotifications(context: TenantContext): Promise<NotificationRecord[]> {
  const db = getFirebaseAdminDb();
  if (!db) return [];
  return withQuotaFallback("the notification feed", [], async () => {
    const snapshot = await db
      .collection(tenantUserNotificationsCollectionPath(context.tenantId, context.userId))
      .get();
    const rows = snapshot.docs
      .map((doc) => toRecord(doc.id, doc.data() as Record<string, unknown>))
      .filter((row): row is NotificationRecord => Boolean(row));
    return sortFeed(rows);
  }).catch(() => []);
}

/**
 * Raise one notification, once.
 *
 * The id is the dedupe key, and an existing document is left exactly as it is -- including its
 * read state. Re-raising an overdue follow-through the AM has already read and chosen to leave
 * must not mark it unread again and nag them daily for the same thing they already know about.
 */
async function raise(context: TenantContext, candidate: Candidate, at: string): Promise<"created" | "existing"> {
  const db = getFirebaseAdminDb();
  if (!db) return "existing";
  const id = notificationKey(candidate.kind, candidate.subjectId);
  const ref = db.doc(tenantUserNotificationPath(context.tenantId, context.userId, id));
  const existing = await ref.get();
  if (existing.exists) return "existing";
  await ref.set({
    kind: candidate.kind,
    title: candidate.title,
    detail: candidate.detail,
    tone: NOTIFICATION_TONE[candidate.kind],
    createdAt: at,
    ...(candidate.href ? { href: candidate.href } : {}),
    subjectId: candidate.subjectId,
  });
  return "created";
}

/**
 * Raise one notification in somebody else's feed, once.
 *
 * Everything above this point writes into the feed of the user whose request it is. QC is the
 * first thing in MTOS where one person's action produces a notification for another: an AM
 * pressing Finish puts a touch in the reviewer's queue, a reviewer submitting a score tells the
 * AM. So the recipient is a parameter rather than taken from the context.
 *
 * The caller's `context` is still what supplies the tenant, which is the part that matters for
 * safety: this can only ever write inside the tenant the caller is already in.
 *
 * Preferences are honoured here rather than at the call site, so a kind somebody switched off
 * cannot reach them through a path that forgot to ask. The return value distinguishes the three
 * outcomes, because "nobody was told" and "they were already told" are different things to report
 * on the screen that follows.
 */
export async function raiseNotificationForUser(
  context: TenantContext,
  userId: string,
  candidate: {
    kind: NotificationKind;
    subjectId: string;
    title: string;
    detail: string;
    href?: string;
  },
  at: string = new Date().toISOString(),
): Promise<"created" | "existing" | "muted" | "unavailable"> {
  const db = getFirebaseAdminDb();
  if (!db) return "unavailable";

  const preferences = await getAccountManagerPreferences({ ...context, userId }).catch(() => ({}));
  if (!isNotificationEnabled(candidate.kind, preferences)) return "muted";

  const id = notificationKey(candidate.kind, candidate.subjectId);
  const ref = db.doc(tenantUserNotificationPath(context.tenantId, userId, id));
  const existing = await ref.get();
  if (existing.exists) return "existing";
  await ref.set({
    kind: candidate.kind,
    title: candidate.title,
    detail: candidate.detail,
    tone: NOTIFICATION_TONE[candidate.kind],
    createdAt: at,
    ...(candidate.href ? { href: candidate.href } : {}),
    subjectId: candidate.subjectId,
  });
  return "created";
}

export async function markNotificationsRead(
  context: TenantContext,
  ids: string[],
): Promise<number> {
  const db = getFirebaseAdminDb();
  if (!db || !ids.length) return 0;
  const at = new Date().toISOString();
  let marked = 0;
  for (const id of ids.slice(0, 100)) {
    try {
      await db
        .doc(tenantUserNotificationPath(context.tenantId, context.userId, id))
        // mergeFields so marking read can never rewrite the title or the link the cron wrote.
        .set({ readAt: at }, { mergeFields: ["readAt"] });
      marked += 1;
    } catch {
      // One row that will not take a read mark is not a reason to fail the rest.
    }
  }
  return marked;
}

/**
 * Record that a toast has been shown, so it is never shown again.
 *
 * Separate from `markNotificationsRead` on purpose: seeing a toast is not reading the thing. A
 * toast that marked its notification read would clear the bell for news nobody opened, and the
 * Command Center card beside it would be the only trace left.
 *
 * `mergeFields` so this can never rewrite the title, the detail or the link the run wrote. A
 * single row that will not take the stamp is not a reason to fail the rest -- the cost of that is
 * one toast shown twice, which is the lesser of the two failures available here.
 */
export async function markNotificationsToasted(
  context: TenantContext,
  ids: string[],
): Promise<number> {
  const db = getFirebaseAdminDb();
  if (!db || !ids.length) return 0;
  const at = new Date().toISOString();
  let marked = 0;
  for (const id of ids.slice(0, TOAST_LIMIT * 4)) {
    try {
      await db
        .doc(tenantUserNotificationPath(context.tenantId, context.userId, id))
        .set({ toastedAt: at }, { mergeFields: ["toastedAt"] });
      marked += 1;
    } catch {
      // See the note above.
    }
  }
  return marked;
}

/** Keep the feed to its limit by deleting the oldest read rows. Unread rows are never dropped. */
async function prune(context: TenantContext, records: NotificationRecord[]) {
  const db = getFirebaseAdminDb();
  if (!db) return;
  for (const record of prunable(records)) {
    try {
      await db.doc(tenantUserNotificationPath(context.tenantId, context.userId, record.id)).delete();
    } catch {
      // Nothing depends on the prune succeeding.
    }
  }
}

// ---------------------------------------------------------------------------
// What needs the AM
// ---------------------------------------------------------------------------

function dayLabel(iso: string | undefined, timeZone: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Everything outstanding for this AM right now, as candidates.
 *
 * Derived from the same data source every screen reads, so a notification can never describe a
 * state the AM would not see on the touch itself. `unavailable` names anything that could not be
 * read, which is what keeps a quiet run distinguishable from an empty one.
 */
export async function deriveCandidates(
  context: TenantContext,
  options: { now: Date; timeZone: string; prepReviewReminder: ReturnType<typeof resolvePreferences>["prepReviewReminder"] },
): Promise<{ candidates: Candidate[]; unavailable: string[] }> {
  const dataSource = getMtosDataSource(context);
  const unavailable: string[] = [];

  const [clients, touches] = await Promise.all([
    dataSource.getClients().catch(() => {
      unavailable.push("clients");
      return [];
    }),
    dataSource.getMonthlyTouches().catch(() => {
      unavailable.push("Monthly Touches");
      return [];
    }),
  ]);

  const clientNames = new Map(clients.map((client) => [client.id, client.name]));
  const candidates: Candidate[] = [];
  const now = options.now;

  for (const touch of touches) {
    const clientName = clientNames.get(touch.clientId) || "a client";

    // 1. Follow-through past its 24-hour deadline and not finished.
    const dueAt = touch.followThrough?.dueAt;
    if (dueAt && !touch.followThrough?.finishedAt) {
      const due = new Date(dueAt).getTime();
      if (!Number.isNaN(due) && due < now.getTime()) {
        candidates.push({
          kind: "overdue_follow_through",
          subjectId: touch.id,
          title: `Follow-through overdue — ${clientName}`,
          detail: `The 24-hour deadline passed on ${dayLabel(dueAt, options.timeZone)} and the follow-through has not been processed.`,
          href: `/monthly-touch/${touch.id}/follow-through`,
          group: "Follow-through overdue",
        });
      }
    }

    // 2. A brief that finished drafting and has not been approved.
    const preparedAt = touch.prepPack?.preparedAt;
    if (preparedAt && !touch.review?.approvedAt) {
      candidates.push({
        kind: "prep_finished",
        subjectId: touch.id,
        title: `Prep ready to review — ${clientName}`,
        detail: `The brief finished drafting on ${dayLabel(preparedAt, options.timeZone)}. Nothing goes to the client until you approve it.`,
        href: `/monthly-touch/${touch.id}?view=review`,
        group: "Prep ready to review",
      });
    }

    // 3. The call is inside the AM's chosen reminder window and the prep is still unapproved.
    if (!touch.review?.approvedAt && prepReminderDue(touch.scheduledAt, options.prepReviewReminder, now)) {
      candidates.push({
        kind: "prep_reminder",
        subjectId: touch.id,
        title: `Review the prep before ${clientName}`,
        detail: `The call is on ${dayLabel(touch.scheduledAt, options.timeZone)} and the brief is not approved yet.`,
        href: `/monthly-touch/${touch.id}?view=review`,
        group: "Calls coming up",
      });
    }
  }

  /*
    4. Clients left waiting in Intercom.

    Asked once, before the loop: Intercom has no OAuth app registered yet, and until somebody
    registers one there is nothing to look in. That is a configuration state, not a failure, so it
    is skipped in silence rather than reported -- a run that says "could not read Intercom" every
    two hours for a connection nobody has made yet is noise that teaches people to ignore the
    line. Once it is connected, a refused or failed read is reported as before, because then it IS
    a fault and the reason tells you which one.

    Checking it here rather than per client also stops twenty reads of the same absent connection.
  */
  if (!(await isIntercomConnected(context))) {
    return { candidates, unavailable };
  }

  const active = clientReplyCandidates(clients, touches, now);
  for (const client of active) {
    const inbox = await readClientInbox(context, {
      clientName: client.name,
      ...(client.contact ? { clientEmail: client.contact } : {}),
      windowDays: ACTIVE_TOUCH_WINDOW_DAYS,
    });
    if (inbox.status !== "checked") {
      // One honest note rather than one per client: the reason is the same for all of them, and it
      // is worth carrying, because "Intercom refused the search" and "no address for this client"
      // are different problems with different fixes. `not_connected` is not reported even here --
      // it can only mean the connection went away mid-run, which the next run will say plainly
      // enough by finding nothing to look in.
      if (inbox.status === "not_connected") continue;
      const note = `Intercom (${inbox.status}${inbox.detail ? `: ${inbox.detail}` : ""})`;
      if (!unavailable.includes(note)) unavailable.push(note);
      continue;
    }
    for (const conversation of inbox.conversations.filter((entry) => entry.awaitingUs)) {
      candidates.push({
        kind: "client_reply",
        subjectId: conversation.id,
        title: `${client.name} is waiting on a reply`,
        detail: `They wrote${conversation.lastClientReplyAt ? ` on ${dayLabel(conversation.lastClientReplyAt, options.timeZone)}` : ""} and nobody has answered: ${conversation.title || "no subject"}.`,
        href: conversation.url,
        group: "Clients waiting on us",
      });
    }
  }

  return { candidates, unavailable };
}

/**
 * Which clients are worth an Intercom lookup this run.
 *
 * Each one is a search against Intercom, so checking a book of 235 clients daily would be 235 API
 * calls for an answer about clients nobody is mid-cycle with. Only clients with a touch inside the
 * active window are checked, and at most twenty of them -- the nearest touches first.
 */
function clientReplyCandidates(
  clients: { id: string; name: string; contact: string }[],
  touches: { clientId: string; scheduledAt?: string }[],
  now: Date,
) {
  const window = ACTIVE_TOUCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const nearest = new Map<string, number>();
  for (const touch of touches) {
    if (!touch.scheduledAt) continue;
    const at = new Date(touch.scheduledAt).getTime();
    if (Number.isNaN(at)) continue;
    const distance = Math.abs(at - now.getTime());
    if (distance > window) continue;
    const held = nearest.get(touch.clientId);
    if (held === undefined || distance < held) nearest.set(touch.clientId, distance);
  }
  return clients
    .filter((client) => nearest.has(client.id) && client.contact)
    .sort((a, b) => (nearest.get(a.id) || 0) - (nearest.get(b.id) || 0))
    .slice(0, INTERCOM_CLIENT_CAP);
}

// ---------------------------------------------------------------------------
// One pass for one AM
// ---------------------------------------------------------------------------

export interface NotificationRunReport {
  userId: string;
  /** Raised for the first time this run. */
  created: number;
  /** Already in the feed, so left alone -- including its read state. */
  existing: number;
  digests: { kind: NotificationKind; emailed: boolean; detail: string }[];
  skipped: string[];
  unavailable: string[];
}

export async function runNotificationsForUser(
  context: TenantContext,
  options: { now?: Date; baseUrl?: string } = {},
): Promise<NotificationRunReport> {
  const now = options.now || new Date();
  const [storedPreferences, profile] = await Promise.all([
    getAccountManagerPreferences(context),
    getAccountManagerProfile(context),
  ]);
  const preferences = resolvePreferences(storedPreferences);
  const report: NotificationRunReport = {
    userId: context.userId,
    created: 0,
    existing: 0,
    digests: [],
    skipped: [],
    unavailable: [],
  };

  const { candidates, unavailable } = await deriveCandidates(context, {
    now,
    timeZone: preferences.timeZone,
    prepReviewReminder: preferences.prepReviewReminder,
  });
  report.unavailable = unavailable;

  const at = now.toISOString();
  for (const candidate of candidates) {
    if (!isNotificationEnabled(candidate.kind, storedPreferences)) {
      // Turned off is a choice, not a failure. Recorded so a run can be explained.
      if (!report.skipped.includes(candidate.kind)) report.skipped.push(candidate.kind);
      continue;
    }
    const outcome = await raise(context, candidate, at);
    if (outcome === "created") report.created += 1;
    else report.existing += 1;
  }

  /*
    The digests.

    They summarise everything outstanding, whether or not the per-event switches are on: an AM who
    turned the individual pings off and the digest on wants a complete digest, not one with the
    same three categories missing from it.
  */
  const lines: DigestLine[] = candidates.map((candidate) => ({
    group: candidate.group,
    text: `${candidate.title} — ${candidate.detail}`,
    ...(candidate.href ? { href: candidate.href } : {}),
  }));

  for (const kind of ["daily_digest", "weekly_digest"] as const) {
    if (!isNotificationEnabled(kind, storedPreferences)) continue;
    if (!digestDue(kind, now, preferences.timeZone)) continue;

    const db = getFirebaseAdminDb();
    if (!db) break;
    const id = digestKey(kind, now, preferences.timeZone);
    const ref = db.doc(tenantUserNotificationPath(context.tenantId, context.userId, id));
    const existing = await ref.get();
    if (existing.exists) {
      report.existing += 1;
      continue;
    }

    const label = dayLabel(at, preferences.timeZone);
    const subject = digestSubject(kind, lines, label);
    let emailed = false;
    let detail = "Gmail is not connected in MTOS, so nothing was emailed.";

    if (profile.email) {
      const outcome = await sendGmailText(context, {
        to: profile.email,
        subject,
        body: digestBody({
          kind,
          lines,
          dateLabel: label,
          ...(profile.name ? { name: profile.name } : {}),
          ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
          ...(preferences.emailSignoff ? { signoff: preferences.emailSignoff } : {}),
        }),
      });
      emailed = outcome.sent;
      detail = outcome.detail;
    } else {
      detail = "MTOS does not know your email address, so the digest is in your feed only.";
    }

    await ref.set({
      kind,
      title: subject.replace(/^MTOS · /, ""),
      detail: digestDetail(lines),
      tone: NOTIFICATION_TONE[kind],
      createdAt: at,
      href: "/command-center",
      subjectId: id.split(":")[1] || id,
      ...(emailed ? { emailedAt: at } : { emailSkippedReason: detail }),
    });
    report.created += 1;
    report.digests.push({ kind, emailed, detail });
  }

  await prune(context, await listNotifications(context));
  return report;
}

/** Every AM in a tenant. One failing user never stops the rest. */
export async function runNotificationsForTenant(
  tenantId: string,
  options: { now?: Date; baseUrl?: string } = {},
): Promise<NotificationRunReport[]> {
  const reports: NotificationRunReport[] = [];
  for (const context of await listTenantUserContexts(tenantId)) {
    try {
      reports.push(await runNotificationsForUser(context, options));
    } catch (error) {
      reports.push({
        userId: context.userId,
        created: 0,
        existing: 0,
        digests: [],
        skipped: [],
        unavailable: [error instanceof Error ? error.message : "unknown error"],
      });
    }
  }
  return reports;
}

export async function runNotificationsAllTenants(
  options: { now?: Date; baseUrl?: string } = {},
): Promise<Record<string, NotificationRunReport[]>> {
  const out: Record<string, NotificationRunReport[]> = {};
  for (const tenantId of await listActiveTenantIds()) {
    out[tenantId] = await runNotificationsForTenant(tenantId, options);
  }
  return out;
}

/** Only the kinds that are delivered by email, for the Settings screen to be able to say so. */
export function emailedKinds(): NotificationKind[] {
  return (Object.keys(NOTIFICATION_CHANNEL) as NotificationKind[]).filter(
    (kind) => NOTIFICATION_CHANNEL[kind] === "in_app_and_email",
  );
}
