import type { TenantContext } from "@/src/lib/contracts/mtos";
import {
  isGraded,
  qcScore,
  type QcAppeal,
  type QcAppealItem,
  type QcCriterionNote,
  type QcIndexRow,
  type TouchQc,
} from "@/src/lib/contracts/qc-record";
import { FOCUS_WINDOW, splitAmRows, type QcAmSplit } from "@/src/lib/contracts/qc-am";
import { qcDateLabel as label } from "@/src/lib/contracts/qc-dates";
import {
  qcToBriefCoaching,
  type QcBriefCoaching,
} from "@/src/lib/contracts/qc-coaching";
import type { MonthlyTouchRecord } from "@/src/lib/mtos-data";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { monthlyTouchPath, qcItemPath, qcItemsCollectionPath } from "@/src/lib/server/firebase/collections";
import { withQuotaFallback } from "@/src/lib/server/firebase/quota";
import { raiseNotificationForUser } from "@/src/lib/server/services/notification-service";
import { getQcReviewers } from "@/src/lib/server/services/qc-reviewers-service";
import { getUserDisplayNames } from "@/src/lib/server/services/user-service";
import type { QcWriteOutcome } from "@/src/lib/server/services/qc-review-service";

/**
 * The Account Manager's own side of QC: reading their scores, and the three things they can do.
 *
 * ## Reading is one query plus a few touch reads, and the few is deliberate
 *
 * The index collection answers almost everything: the chart, the KPI tiles, the history and the
 * deltas are all computed from `crit`, `score` and `goal` on the rows (see `QcIndexRow` for why
 * those are copied there). What the rows cannot carry is the prose -- the per-criterion notes, the
 * coaching plan, what went well, the appeal. That lives on the touch document, and the page needs
 * it for the touch being shown and for the last three, which is where "Focus next" gets the most
 * recent "Next time" note.
 *
 * So: one indexed query, then at most four small touch reads. Not one read per row. This app has
 * had production deploys fail on the Firestore daily read limit, and the pattern that did it was a
 * page opening every touch it listed.
 *
 * ## The three writes all refuse rather than overwrite
 *
 * Marking a score as read, appealing it and asking for a coaching chat are each a one-way move the
 * AM makes once. Each transaction re-reads the record and declines if the move has already been
 * made or no longer applies -- a second appeal would leave the record carrying two "from" scores
 * with no way to say which came first, and a second chat request would notify the reviewer again
 * for a conversation they have already been asked for.
 */

/**
 * How many of an AM's QC rows are read.
 *
 * Generous: at roughly a touch a month per client, this is years of history for a full book, and
 * the chart and KPIs only use the last five. The cap exists so one AM's page can never turn into
 * an unbounded scan, not because anyone is expected to reach it.
 */
const AM_ROW_LIMIT = 120;

function fail(reason: string, status = 409): QcWriteOutcome {
  return { ok: false, reason, status };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface QcAmSelection {
  row: QcIndexRow;
  qc: TouchQc;
  /** The criteria of the touch before this one, for the breakdown's change column. */
  previousCrit?: TouchQc["crit"];
  clientName: string;
}

export interface QcAmView extends QcAmSplit {
  /** The touch whose detail panel is open: the one asked for, or the latest scored. */
  selected?: QcAmSelection;
  /** Per-criterion notes for the last few touches, keyed by touch id. Feeds "Focus next". */
  notesByTouch: Record<string, Record<number, QcCriterionNote>>;
  /** The reviewer's name, for "Appeal with {name}" and "Ask {name} for a coaching chat". */
  reviewerName?: string;
}

const EMPTY_VIEW: QcAmView = { pending: [], done: [], notesByTouch: {} };

/**
 * Everything the AM's QA & Coaching page shows.
 *
 * Returns an empty view rather than throwing when there is no database or the daily quota is
 * spent. An AM opening their own page and reading "no scores yet" is a readable screen; a 500 is
 * not, and the page is also where a notification lands.
 */
export async function getQcAmView(
  context: TenantContext,
  selectedTouchId?: string,
): Promise<QcAmView> {
  const db = getFirebaseAdminDb();
  if (!db) return EMPTY_VIEW;

  const rows = await withQuotaFallback("your QC history", [] as QcIndexRow[], async () => {
    // Equality on one field, no ordering: the automatic single-field index covers it, and this
    // repository manages no composite indexes. The order is applied in memory by `splitAmRows`.
    const snapshot = await db
      .collection(qcItemsCollectionPath(context.tenantId))
      .where("amId", "==", context.userId)
      .limit(AM_ROW_LIMIT)
      .get();
    return snapshot.docs.map((doc) => doc.data() as QcIndexRow);
  });

  const split = splitAmRows(rows);
  const { done } = split;

  // The touches worth opening: the last few (for the focus notes) plus the selected one.
  const recent = done.slice(-FOCUS_WINDOW);
  const selectedRow =
    (selectedTouchId ? done.find((row) => row.touchId === selectedTouchId) : undefined) ||
    done[done.length - 1];
  const wanted = new Map<string, QcIndexRow>();
  for (const row of recent) wanted.set(row.touchId, row);
  if (selectedRow) wanted.set(selectedRow.touchId, selectedRow);

  const source = getMtosDataSource(context);
  const touches = await Promise.all(
    [...wanted.keys()].map(async (touchId) => {
      const touch = await source.getMonthlyTouchById(touchId).catch(() => undefined);
      return touch ? ([touchId, touch] as const) : undefined;
    }),
  );
  const byTouchId = new Map<string, MonthlyTouchRecord>();
  for (const entry of touches) {
    if (entry) byTouchId.set(entry[0], entry[1]);
  }

  const notesByTouch: Record<string, Record<number, QcCriterionNote>> = {};
  for (const [touchId, touch] of byTouchId) {
    if (touch.qc?.notes) notesByTouch[touchId] = touch.qc.notes;
  }

  const reviewers = await getQcReviewers(context.tenantId).catch(() => ({ userIds: [] as string[] }));
  const reviewerNames = await getUserDisplayNames(context.tenantId, reviewers.userIds).catch(
    () => ({}) as Record<string, string>,
  );
  const reviewerName = reviewers.userIds.map((id) => reviewerNames[id]).find(Boolean);

  let selected: QcAmSelection | undefined;
  if (selectedRow) {
    const touch = byTouchId.get(selectedRow.touchId);
    const qc = touch?.qc;
    if (qc) {
      const index = done.findIndex((row) => row.touchId === selectedRow.touchId);
      const previous = index > 0 ? done[index - 1] : undefined;
      const client = await source.getClientById(selectedRow.clientId).catch(() => undefined);
      selected = {
        row: selectedRow,
        qc,
        // Read off the index row, not the previous touch document: the row carries `crit` for
        // exactly this kind of comparison, and opening a second touch to draw a change column
        // would double the page's reads for one arrow per line.
        ...(previous?.crit ? { previousCrit: previous.crit } : {}),
        clientName: client?.name || selectedRow.client,
      };
    }
  }

  return {
    ...split,
    ...(selected ? { selected } : {}),
    notesByTouch,
    ...(reviewerName ? { reviewerName } : {}),
  };
}

// ---------------------------------------------------------------------------
// Marking a score as read
// ---------------------------------------------------------------------------

/**
 * The AM has read their score.
 *
 * Moves `scored` or `appeal_resolved` to `reviewed` and stamps `acknowledgedAt`. Anything else is
 * left alone and reported as already done, including a touch under appeal -- an open appeal is an
 * unfinished conversation, and marking it read would clear the badge on something still waiting.
 */
export async function acknowledgeQcScore(
  context: TenantContext,
  touchId: string,
): Promise<QcWriteOutcome> {
  const db = getFirebaseAdminDb();
  if (!db) return fail("This deployment has no database connection.", 503);
  const at = new Date().toISOString();
  const touchRef = db.doc(monthlyTouchPath(context.tenantId, touchId));
  const itemRef = db.doc(qcItemPath(context.tenantId, touchId));

  return db.runTransaction(async (tx): Promise<QcWriteOutcome> => {
    const snapshot = await tx.get(touchRef);
    const current = snapshot.data() as Partial<MonthlyTouchRecord> | undefined;
    const qcNow = current?.qc;
    if (!qcNow) return fail("This touch is not with QC.", 404);
    if (qcNow.status !== "scored" && qcNow.status !== "appeal_resolved") {
      // Not an error: the button is gone on a reload either way.
      return { ok: true, qc: qcNow };
    }
    const qc: TouchQc = { ...qcNow, status: "reviewed", acknowledgedAt: at };
    tx.set(touchRef, { qc }, { mergeFields: ["qc"] });
    tx.set(itemRef, { status: "reviewed" }, { merge: true });
    return { ok: true, qc };
  });
}

// ---------------------------------------------------------------------------
// Asking for a coaching chat
// ---------------------------------------------------------------------------

/**
 * Ask the reviewer for a conversation about this score.
 *
 * Once per touch. The stamp is the whole state: the button reads "Coaching chat requested"
 * afterwards and stays that way, because a second request would notify a reviewer again about a
 * conversation they have already been asked for and have perhaps already had.
 */
export async function requestQcChat(
  context: TenantContext,
  touchId: string,
): Promise<QcWriteOutcome> {
  const db = getFirebaseAdminDb();
  if (!db) return fail("This deployment has no database connection.", 503);
  const at = new Date().toISOString();
  const touchRef = db.doc(monthlyTouchPath(context.tenantId, touchId));

  const outcome = await db.runTransaction(async (tx): Promise<QcWriteOutcome> => {
    const snapshot = await tx.get(touchRef);
    const current = snapshot.data() as Partial<MonthlyTouchRecord> | undefined;
    const qcNow = current?.qc;
    if (!qcNow) return fail("This touch is not with QC.", 404);
    if (qcNow.chatRequestedAt) {
      return { ok: true, qc: qcNow, notified: true };
    }
    const qc: TouchQc = { ...qcNow, chatRequestedAt: at };
    tx.set(touchRef, { qc }, { mergeFields: ["qc"] });
    return { ok: true, qc };
  });

  if (!outcome.ok || outcome.notified) return outcome;

  const row = await readRow(context, touchId);
  const notified = await notifyReviewers(context, {
    kind: "qc_chat_requested",
    subjectId: touchId,
    title: "Coaching chat requested",
    detail: `${row?.am || "An account manager"} · ${row?.client || "a client"} · ${label(row?.date)}`,
    href: `/qa?qc=${touchId}`,
  });
  return { ...outcome, notified };
}

// ---------------------------------------------------------------------------
// Appealing
// ---------------------------------------------------------------------------

/**
 * Open an appeal on a scored touch.
 *
 * Every item is re-checked against the stored criteria, not against what the form sent: the
 * criterion has to be graded, below five, and the score asked for has to be above the one given.
 * The screen enforces the same three rules, and this enforces them again because an appeal is read
 * by a person who has to be able to answer it -- an item asking to raise a 5, or to raise an N/A,
 * is one a reviewer can only decline, and declining a request the AM never meant to make reads as
 * their appeal having been dismissed.
 *
 * `from` is the score as it stands right now, written once. It is never recomputed, which is what
 * keeps "80 → 84" true in the AM's history after a later rubric change.
 */
export async function submitQcAppeal(
  context: TenantContext,
  touchId: string,
  items: QcAppealItem[],
  note: string | undefined,
): Promise<QcWriteOutcome> {
  const db = getFirebaseAdminDb();
  if (!db) return fail("This deployment has no database connection.", 503);
  if (!items.length) return fail("An appeal needs at least one criterion.", 400);

  const at = new Date().toISOString();
  const touchRef = db.doc(monthlyTouchPath(context.tenantId, touchId));
  const itemRef = db.doc(qcItemPath(context.tenantId, touchId));

  const outcome = await db.runTransaction(async (tx): Promise<QcWriteOutcome> => {
    const snapshot = await tx.get(touchRef);
    const current = snapshot.data() as Partial<MonthlyTouchRecord> | undefined;
    const qcNow = current?.qc;
    if (!qcNow) return fail("This touch is not with QC.", 404);
    if (qcNow.appeal) return fail("This touch has already been appealed once.");
    if (qcNow.status === "ready" || qcNow.status === "in_progress") {
      return fail("This touch has not been scored yet.");
    }

    const from = typeof qcNow.score === "number" ? qcNow.score : qcScore(qcNow.crit);
    if (from === null) {
      return fail("This touch has no score to appeal.");
    }

    const checked: QcAppealItem[] = [];
    const rejected: number[] = [];
    for (const item of items) {
      const value = qcNow.crit?.[item.n - 1];
      if (!isGraded(value) || value >= 5 || item.to <= value || item.to > 5) {
        rejected.push(item.n);
        continue;
      }
      checked.push(item);
    }
    if (!checked.length) {
      return fail(
        "None of those criteria can be appealed: a criterion has to be graded below 5, and the score asked for has to be above the one given.",
        400,
      );
    }
    if (rejected.length) {
      return fail(
        `${rejected.length === 1 ? "Criterion" : "Criteria"} ${rejected.join(", ")} cannot be appealed. Nothing was sent.`,
        400,
      );
    }

    const trimmed = note?.trim();
    const appeal: QcAppeal = {
      status: "open",
      submittedAt: at,
      items: checked,
      ...(trimmed ? { note: trimmed } : {}),
      from,
    };
    const qc: TouchQc = { ...qcNow, status: "appealed", appeal };
    tx.set(touchRef, { qc }, { mergeFields: ["qc"] });
    // `appealCount` is what the reviewer's Appeals row reads for "{n} criteria". Written here
    // because this is the only place an appeal is created.
    tx.set(itemRef, { status: "appealed", appealCount: checked.length }, { merge: true });
    return { ok: true, qc };
  });

  if (!outcome.ok) return outcome;

  const row = await readRow(context, touchId);
  const count = outcome.qc.appeal?.items.length ?? 0;
  const notified = await notifyReviewers(context, {
    kind: "qc_appeal_submitted",
    subjectId: touchId,
    title: "Score appeal submitted",
    detail: `${row?.am || "An account manager"} · ${row?.client || "a client"} · ${count} ${count === 1 ? "criterion" : "criteria"}`,
    href: `/qa?appeal=${touchId}`,
  });
  return { ...outcome, notified };
}

// ---------------------------------------------------------------------------
// Telling the reviewers
// ---------------------------------------------------------------------------

async function readRow(
  context: TenantContext,
  touchId: string,
): Promise<QcIndexRow | undefined> {
  const db = getFirebaseAdminDb();
  if (!db) return undefined;
  return withQuotaFallback(`the QC index row for ${touchId}`, undefined, async () => {
    const snapshot = await db.doc(qcItemPath(context.tenantId, touchId)).get();
    return snapshot.exists ? (snapshot.data() as QcIndexRow) : undefined;
  });
}

/**
 * Raise one notification per configured reviewer.
 *
 * Never throws and never undoes the write that preceded it. When no reviewer is configured this
 * returns false and the caller says so -- the appeal is still recorded, and the AM is told it was
 * filed but that nobody was notified, which is the §0.7 rule: degrade, say what happened, never
 * pretend. Silently filing an appeal nobody will see is the failure this avoids.
 */
async function notifyReviewers(
  context: TenantContext,
  candidate: {
    kind: "qc_appeal_submitted" | "qc_chat_requested";
    subjectId: string;
    title: string;
    detail: string;
    href: string;
  },
): Promise<boolean> {
  const reviewers = await getQcReviewers(context.tenantId).catch(() => ({ userIds: [] as string[] }));
  if (!reviewers.userIds.length) return false;
  const results = await Promise.all(
    reviewers.userIds.map((userId) =>
      raiseNotificationForUser(context, userId, {
        kind: candidate.kind,
        subjectId: candidate.subjectId,
        title: candidate.title,
        detail: candidate.detail,
        href: candidate.href,
      }).catch(() => "unavailable" as const),
    ),
  );
  return results.some((result) => result === "created" || result === "existing");
}

// ---------------------------------------------------------------------------
// Closing the loop: the last QC feeds the next call's Review (handoff §6.8)
// ---------------------------------------------------------------------------

/**
 * The AM's latest submitted QC, turned into coaching for the touch they are preparing now.
 *
 * Prefers the latest scored touch **for this client**, and falls back to their latest overall.
 * Both are useful and they are useful differently: the same client's QC carries context the AM is
 * about to walk back into, while another client's still describes how this AM runs a call. The
 * returned `note` says which it is, so the Review never implies that advice about one account came
 * from another.
 *
 * The touch being prepared is excluded. A touch cannot be coached by its own QC, and in the normal
 * case it has none yet anyway.
 *
 * Costs one indexed query plus one touch read, and only on the Review step. Returns undefined --
 * never throws -- when there is no history, no database or no quota left: the Review then keeps
 * whatever source it already had, which is the handoff's own fallback.
 */
export async function getLatestQcCoaching(
  context: TenantContext,
  input: { clientId: string; excludeTouchId: string },
): Promise<QcBriefCoaching | undefined> {
  const db = getFirebaseAdminDb();
  if (!db) return undefined;

  const rows = await withQuotaFallback("your last QC", [] as QcIndexRow[], async () => {
    const snapshot = await db
      .collection(qcItemsCollectionPath(context.tenantId))
      .where("amId", "==", context.userId)
      .limit(AM_ROW_LIMIT)
      .get();
    return snapshot.docs.map((doc) => doc.data() as QcIndexRow);
  });

  const { done } = splitAmRows(rows.filter((row) => row.touchId !== input.excludeTouchId));
  if (!done.length) return undefined;

  const sameClient = [...done].reverse().find((row) => row.clientId === input.clientId);
  const row = sameClient || done[done.length - 1];
  if (!row) return undefined;

  const touch = await getMtosDataSource(context)
    .getMonthlyTouchById(row.touchId)
    .catch(() => undefined);
  if (!touch?.qc) return undefined;

  return qcToBriefCoaching({
    touchId: row.touchId,
    client: row.client,
    ...(row.date ? { date: row.date } : {}),
    sameClient: Boolean(sameClient),
    qc: touch.qc,
  });
}
