import type { TenantContext } from "@/src/lib/contracts/mtos";
import { followThroughChecklist } from "@/src/lib/contracts/follow-through-checklist";
import {
  callLengthMinutes,
  newQcRecord,
  type QcIndexRow,
  type TouchQc,
} from "@/src/lib/contracts/qc-record";
import { advanceProgress } from "@/src/lib/contracts/touch-progress";
import type { ClientRecord, MonthlyTouchRecord } from "@/src/lib/mtos-data";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { monthlyTouchPath, qcItemPath } from "@/src/lib/server/firebase/collections";
import { raiseNotificationForUser } from "@/src/lib/server/services/notification-service";
import { getAccountManagerIdentity } from "@/src/lib/server/services/user-service";
import { getQcReviewers } from "@/src/lib/server/services/qc-reviewers-service";

/**
 * Handing a finished touch to QC.
 *
 * This runs at the end of "Finish follow-through & process approved", whether every step passed or
 * some came back with warnings. A touch where the recap failed to send still gets scored -- the
 * failure is part of what QC is looking at, and holding it back would mean the touches most worth
 * reviewing were the ones that never arrived.
 *
 * ## Idempotent, and the transaction is why
 *
 * Finish can be pressed again. It is designed to be: every step checks what it already did and
 * skips it. So this must not create a second QC item, move an in-progress review back to `ready`,
 * or tell the reviewer twice. The check and the write happen in one transaction on the touch
 * document, so two Finishes racing each other cannot both decide the record is absent. The
 * notification is deduped separately, by its own document id, which makes a re-notify a no-op even
 * if this is somehow reached twice.
 *
 * ## The evidence snapshot is taken once and never recomputed
 *
 * `evidence` is the eight-row answer to "did the follow-through actually happen", frozen at the
 * moment the AM pressed Finish. It is the same derivation the AM's own checklist shows, from
 * `follow-through-checklist.ts`, so the two cannot disagree -- a reviewer marking down a step the
 * AM's screen had ticked is the failure this shares one function to avoid. Frozen, because it is
 * evidence: if it were recomputed when the reviewer opened the screen, an AM could fix a missing
 * recap after handing the touch over and the record would show it as always having been fine.
 */

export interface QcHandoffResult {
  /** True only on the run that created the record. A re-run reports false and changes nothing. */
  created: boolean;
  qc?: TouchQc;
  /** Who was told. Empty when no reviewer is configured, which the caller reports to the AM. */
  notified: string[];
  /** In the AM's own words, for the toast and the step summary. Always written. */
  message: string;
}

function evidenceSnapshot(touch: MonthlyTouchRecord) {
  return followThroughChecklist(touch).map((row) => ({
    label: row.label,
    detail: row.detail,
    ok: row.ok,
  }));
}

function dateLabel(iso: string | undefined): string {
  if (!iso) return "no date";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "no date";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

/**
 * Create the QC record, the index row and the reviewer's notification.
 *
 * `touch` must be the record as it stands *after* processing -- with the processing steps, the
 * created ticket ids and the finish time on it -- because that is what the evidence is read from.
 * The caller builds it; this does not re-read the document for it, which keeps the handoff at one
 * transaction rather than a read plus a transaction.
 */
export async function handTouchToQc(
  context: TenantContext,
  touch: MonthlyTouchRecord,
  client: Pick<ClientRecord, "id" | "name">,
): Promise<QcHandoffResult> {
  const db = getFirebaseAdminDb();
  if (!db) {
    return {
      created: false,
      notified: [],
      message: "This deployment has no database connection, so the touch could not be sent to QC.",
    };
  }

  const at = new Date().toISOString();
  const record = newQcRecord({
    readyAt: at,
    evidence: evidenceSnapshot(touch),
    tickets: Object.keys(touch.followThrough?.ticketIds || {}).length,
    callLengthMin: callLengthMinutes(touch.live?.callStartedAt, touch.live?.callEndedAt),
  });

  // Read before the transaction, not after, so the index row carries the AM's name from the moment
  // it exists. One extra document read on a press of Finish -- which already does dozens of writes
  // -- against one read per *queue row* forever afterwards if the queue had to resolve names itself.
  const amName =
    (await getAccountManagerIdentity(context).catch(() => ({ name: "" }))).name ||
    "An account manager";

  const indexRow: QcIndexRow = {
    touchId: touch.id,
    status: "ready",
    amId: context.userId,
    clientId: client.id,
    client: client.name,
    // Denormalised for the same reason `client` is: see the field's note on `QcIndexRow`.
    am: amName,
    ...(touch.scheduledAt ? { date: touch.scheduledAt } : {}),
    readyAt: at,
    // The queue row's chips, taken from the record just built so the two cannot disagree.
    tickets: record.tickets,
    evidenceOk: record.evidence.filter((row) => row.ok).length,
    evidenceTotal: record.evidence.length,
    ...(typeof record.callLengthMin === "number" ? { callLengthMin: record.callLengthMin } : {}),
  };

  const touchRef = db.doc(monthlyTouchPath(context.tenantId, touch.id));
  const itemRef = db.doc(qcItemPath(context.tenantId, touch.id));

  const outcome = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(touchRef);
    if (!snapshot.exists) {
      return { created: false as const, qc: undefined };
    }
    const current = snapshot.data() as Partial<MonthlyTouchRecord>;
    if (current.qc) {
      // Already with QC, possibly already being scored. Leave every field exactly as it is.
      return { created: false as const, qc: current.qc };
    }
    tx.set(
      touchRef,
      { qc: record, progress: advanceProgress(current.progress, "qa"), progressUpdatedAt: at },
      { mergeFields: ["qc", "progress", "progressUpdatedAt"] },
    );
    tx.set(itemRef, indexRow);
    return { created: true as const, qc: record };
  });

  if (!outcome.created) {
    return {
      created: false,
      ...(outcome.qc ? { qc: outcome.qc } : {}),
      notified: [],
      message: outcome.qc
        ? "This touch is already with QC, so nothing was sent again."
        : "The touch could not be found, so it was not sent to QC.",
    };
  }

  const reviewers = await getQcReviewers(context.tenantId);
  if (!reviewers.userIds.length) {
    // §0.7: no reviewer configured is not a crash and not a silence. The record is made, the queue
    // will show it to anyone who opens QC, and the AM is told plainly that nobody was pinged.
    return {
      created: true,
      qc: outcome.qc,
      notified: [],
      message:
        "Sent to QC. No QC reviewer is set up yet, so nobody was notified — the touch is in the queue and will be picked up when a reviewer opens it.",
    };
  }

  const notified: string[] = [];
  for (const userId of reviewers.userIds) {
    const result = await raiseNotificationForUser(
      context,
      userId,
      {
        kind: "qc_ready",
        subjectId: touch.id,
        title: "Monthly touch ready for QC",
        detail: `${amName} · ${client.name} · ${dateLabel(touch.scheduledAt)}`,
        // `?qc=` rather than `/qa/review/{id}`, which the handoff offers as the alternative form.
        // The dedicated scoring route arrives with the QC screens; `/qa` exists today and ignores
        // a query parameter it does not know, so this link opens a working page now and the right
        // touch later. A notification raised this week must not become a 404 next week.
        href: `/qa?qc=${touch.id}`,
      },
      at,
    ).catch(() => "unavailable" as const);
    if (result === "created" || result === "existing") notified.push(userId);
  }

  return {
    created: true,
    qc: outcome.qc,
    notified,
    message: notified.length
      ? `Sent to QC — ${notified.length === 1 ? "the reviewer has" : `${notified.length} reviewers have`} been notified. ${client.name} · ${dateLabel(touch.scheduledAt)} is in the QC queue. You'll get a notification when it's scored.`
      : "Sent to QC. The notification could not be delivered, so the reviewer will see it when they open the QC queue.",
  };
}
