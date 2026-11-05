import type { TenantContext } from "@/src/lib/contracts/mtos";
import {
  applyAppealDecisions,
  qcRating,
  qcScore,
  type QcAppealDecision,
  type QcCriterionNote,
  type QcDraftValue,
  type QcGoal,
  type QcIndexRow,
  type QcScoreValue,
  type TouchQc,
} from "@/src/lib/contracts/qc-record";
import {
  appealDecisionsComplete,
  draftToStore,
  finalizeSubmission,
  submitBlockers,
  type QcSubmission,
} from "@/src/lib/contracts/qc-submit";
import type { CoachingItem } from "@/src/lib/contracts/qc-record";
import type { ClientRecord, MonthlyTouchRecord } from "@/src/lib/mtos-data";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { monthlyTouchPath, qcItemPath } from "@/src/lib/server/firebase/collections";
import { raiseNotificationForUser } from "@/src/lib/server/services/notification-service";
import { getQcIndexRow } from "@/src/lib/server/services/qc-queue-service";

/**
 * The four things a QC reviewer does to a record: open it, save a draft, submit it, decide an appeal.
 *
 * ## Every write is one transaction on the touch, plus the index row beside it
 *
 * The touch document is the source of truth and the index row is a copy for the list pages. They
 * are written together, in the same transaction, every time -- never one and then the other. A
 * queue showing "Ready" for a touch that is actually being scored would hand the same work to two
 * reviewers, and a Scored tab showing a score the touch does not have is worse than showing none.
 *
 * ## The guard conditions are re-read inside each transaction
 *
 * The screen gates its own submit button, and the route checks the role. Neither is enough: a
 * reviewer can leave a tab open for an hour while the touch is appealed, re-scored or handed back.
 * So each transaction reads the record it is about to change and refuses on what it finds there --
 * not on what the client sent. The alternative is a stale tab silently overwriting a newer score.
 *
 * ## What it refuses to do
 *
 * Nothing here deletes or rewrites history. An appeal decision adds to the record and recomputes
 * the score; it does not erase the score that was appealed, which is kept as `appeal.from` so
 * "80 → 84" stays true after a later rubric change.
 */

export type QcWriteOutcome =
  | { ok: true; qc: TouchQc; notified?: boolean }
  | { ok: false; reason: string; status: number };

function fail(reason: string, status = 409): QcWriteOutcome {
  return { ok: false, reason, status };
}

function dateLabel(iso: string | undefined): string {
  if (!iso) return "no date";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "no date";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function firstName(name: string | undefined): string {
  return (name || "").trim().split(" ").filter(Boolean)[0] || "";
}

// ---------------------------------------------------------------------------
// Reading the scoring screen
// ---------------------------------------------------------------------------

export interface QcSource {
  label: string;
  href?: string;
  /** Said plainly when there is no link, rather than rendering a dead one. */
  absent?: string;
}

/**
 * The Sources panel: every link a reviewer needs to check a claim, and the truth when there is none.
 *
 * A source with no URL is listed with the reason it is missing rather than left out. A reviewer who
 * cannot find the transcript needs to know it was never captured, not be left wondering whether
 * the panel is broken -- and criterion 9 is about numbers said on the call, which cannot be graded
 * against a recording nobody has.
 */
export function qcSources(touch: MonthlyTouchRecord): QcSource[] {
  const out: QcSource[] = [];

  const docId = touch.transcript?.docIds?.[0];
  out.push(
    docId
      ? { label: "Transcript", href: `https://docs.google.com/document/d/${docId}` }
      : { label: "Transcript", absent: "No transcript was captured for this call." },
  );

  const notesUrl = touch.followThrough?.processing?.notesPageUrl;
  out.push(
    notesUrl
      ? { label: "Post-touch notes", href: notesUrl }
      : { label: "Post-touch notes", absent: "The notes page was not filed in the Client's Book." },
  );

  const ticketUrls = Object.values(
    touch.followThrough?.processing?.ticketUrls || touch.followThrough?.ticketUrls || {},
  ).filter(Boolean);
  if (ticketUrls.length) {
    ticketUrls.forEach((href, index) => {
      out.push({ label: `Ticket ${index + 1} in ClickUp`, href });
    });
  } else {
    out.push({ label: "Tickets", absent: "No tickets were created for this touch." });
  }

  return out;
}

export interface QcScoringView {
  row: QcIndexRow;
  qc: TouchQc;
  touch: MonthlyTouchRecord;
  client?: Pick<ClientRecord, "id" | "name">;
  sources: QcSource[];
  /** The AM's first name, for the submit button and its hint. */
  amFirstName: string;
}

/**
 * Everything one scoring screen needs, in two reads: the index row and the touch.
 *
 * The index row first, and separately, because it is what says whose touch this is. The caller
 * checks permission against it before this opens the touch -- a record the reader may not see
 * should not be loaded and then discarded.
 */
export async function getQcScoringView(
  context: TenantContext,
  touchId: string,
  row: QcIndexRow,
): Promise<QcScoringView | undefined> {
  const source = getMtosDataSource(context);
  const touch = await source.getMonthlyTouchById(touchId).catch(() => undefined);
  if (!touch?.qc) return undefined;
  const client = await source.getClientById(touch.clientId).catch(() => undefined);
  return {
    row,
    qc: touch.qc,
    touch,
    ...(client ? { client: { id: client.id, name: client.name } } : {}),
    sources: qcSources(touch),
    amFirstName: firstName(row.am),
  };
}

// ---------------------------------------------------------------------------
// Opening a touch for scoring
// ---------------------------------------------------------------------------

/**
 * Mark a `ready` touch as being scored, and record who has it.
 *
 * Idempotent and non-destructive: a touch already `in_progress` is returned untouched, including
 * its existing `reviewerId` and `startedAt`. A second reviewer opening the same row does not become
 * its owner, and re-opening your own does not reset the clock on how long it has taken.
 */
export async function startQcReview(
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
    if (!current?.qc) return fail("This touch is not with QC.", 404);
    if (current.qc.status !== "ready") {
      // Nothing to do, and nothing to complain about: the screen opens either way.
      return { ok: true, qc: current.qc };
    }
    const qc: TouchQc = {
      ...current.qc,
      status: "in_progress",
      startedAt: at,
      reviewerId: context.userId,
    };
    tx.set(touchRef, { qc }, { mergeFields: ["qc"] });
    tx.set(itemRef, { status: "in_progress" }, { merge: true });
    return { ok: true, qc };
  });
}

// ---------------------------------------------------------------------------
// The draft
// ---------------------------------------------------------------------------

export interface QcDraftInput {
  crit: (QcDraftValue | undefined)[];
  notes?: Record<number, QcCriterionNote>;
  goal?: QcGoal;
  strengths?: string;
  focus?: string;
  coaching?: CoachingItem[];
}

/**
 * Save the reviewer's work in progress.
 *
 * Refuses once the touch has been scored. The draft is scaffolding for an unfinished review, and a
 * late autosave from a tab left open could otherwise write a half-filled form over the record of a
 * score that has already been sent to the AM.
 */
export async function saveQcDraft(
  context: TenantContext,
  touchId: string,
  input: QcDraftInput,
): Promise<QcWriteOutcome> {
  const db = getFirebaseAdminDb();
  if (!db) return fail("This deployment has no database connection.", 503);
  const at = new Date().toISOString();
  const touchRef = db.doc(monthlyTouchPath(context.tenantId, touchId));

  return db.runTransaction(async (tx): Promise<QcWriteOutcome> => {
    const snapshot = await tx.get(touchRef);
    const current = snapshot.data() as Partial<MonthlyTouchRecord> | undefined;
    if (!current?.qc) return fail("This touch is not with QC.", 404);
    if (current.qc.score !== undefined || current.qc.status === "scored") {
      return fail("This touch has already been scored, so the draft was not saved.");
    }
    const qc: TouchQc = { ...current.qc, draft: draftToStore(input, at) };
    tx.set(touchRef, { qc }, { mergeFields: ["qc"] });
    return { ok: true, qc };
  });
}

// ---------------------------------------------------------------------------
// Submitting
// ---------------------------------------------------------------------------

/** What the index row copies from a submitted score. See `QcIndexRow` for why it copies at all. */
function scoredIndexPatch(submission: QcSubmission, at: string): Partial<QcIndexRow> {
  return {
    status: "scored",
    scoredAt: at,
    crit: submission.crit,
    goal: submission.goal,
    ...(submission.score === null ? {} : { score: submission.score }),
    ...(submission.rating ? { rating: submission.rating } : {}),
  };
}

/**
 * Write the score, clear the draft, and tell the AM.
 *
 * The completeness check runs again here against the record as stored, not against what the client
 * sent: the submit button is the screen's own gate, and a request that reaches this function
 * directly must meet the same bar. An incomplete submission is refused rather than written with
 * holes in it, because a score is averaged into someone's KPIs the moment it exists.
 *
 * The notification is raised after the transaction commits, deliberately. It is deduped on its own
 * document id, so a retry cannot double-notify, and a notification that failed to send must not
 * roll back a score the reviewer has finished writing -- the AM can still see it on their page.
 */
export async function submitQcScore(
  context: TenantContext,
  touchId: string,
  input: QcDraftInput & { goal: QcGoal },
): Promise<QcWriteOutcome> {
  const db = getFirebaseAdminDb();
  if (!db) return fail("This deployment has no database connection.", 503);

  const blockers = submitBlockers(input.crit, input.goal);
  if (blockers.length) {
    return fail(`This review is not finished: ${blockers.join(" · ")}.`, 400);
  }

  const at = new Date().toISOString();
  const submission = finalizeSubmission({ ...input, goal: input.goal });
  const touchRef = db.doc(monthlyTouchPath(context.tenantId, touchId));
  const itemRef = db.doc(qcItemPath(context.tenantId, touchId));

  const outcome = await db.runTransaction(async (tx): Promise<QcWriteOutcome> => {
    const snapshot = await tx.get(touchRef);
    const current = snapshot.data() as Partial<MonthlyTouchRecord> | undefined;
    if (!current?.qc) return fail("This touch is not with QC.", 404);
    if (current.qc.score !== undefined) {
      return fail("This touch has already been scored.");
    }

    const qc: TouchQc = {
      ...current.qc,
      status: "scored",
      crit: submission.crit,
      notes: submission.notes,
      goal: submission.goal,
      ...(submission.strengths ? { strengths: submission.strengths } : {}),
      ...(submission.focus ? { focus: submission.focus } : {}),
      coaching: submission.coaching,
      ...(submission.score === null ? {} : { score: submission.score }),
      ...(submission.rating ? { rating: submission.rating } : {}),
      scoredAt: at,
      scoredBy: context.userId,
    };
    // The draft is scaffolding, and it is gone once the record is real. Leaving it would mean a
    // reopened screen restored a half-filled form over a submitted score.
    delete qc.draft;

    tx.set(touchRef, { qc }, { mergeFields: ["qc"] });
    tx.set(itemRef, scoredIndexPatch(submission, at), { merge: true });
    return { ok: true, qc };
  });

  if (!outcome.ok) return outcome;

  const row = await getQcIndexRow(context, touchId).catch(() => undefined);
  const notified = await notifyAm(context, row, {
    kind: "qc_scored",
    title: "Your QC score is ready",
    detail:
      submission.score === null
        ? `${row?.client || "A client"} · ${dateLabel(row?.date)} · no criterion applied`
        : `${row?.client || "A client"} · ${dateLabel(row?.date)} · ${submission.score} (${submission.rating})`,
  });

  return { ...outcome, notified };
}

// ---------------------------------------------------------------------------
// Deciding an appeal
// ---------------------------------------------------------------------------

/**
 * Apply the reviewer's decisions, recompute the score, and reply to the AM.
 *
 * `appeal.from` is written once, from the score as it stood when the appeal was opened, and is
 * never recomputed afterwards. That is what keeps "80 → 84" true in the AM's history even after
 * the rubric changes underneath it.
 *
 * A declined item changes nothing at all -- not the criterion, not the score. The record still
 * carries the decision and the reply, so an AM can see their appeal was read and answered rather
 * than silently dropped.
 */
export async function resolveQcAppeal(
  context: TenantContext,
  touchId: string,
  decisions: QcAppealDecision[],
  reply: string | undefined,
): Promise<QcWriteOutcome> {
  const db = getFirebaseAdminDb();
  if (!db) return fail("This deployment has no database connection.", 503);
  const at = new Date().toISOString();
  const touchRef = db.doc(monthlyTouchPath(context.tenantId, touchId));
  const itemRef = db.doc(qcItemPath(context.tenantId, touchId));

  const outcome = await db.runTransaction(async (tx): Promise<QcWriteOutcome> => {
    const snapshot = await tx.get(touchRef);
    const current = snapshot.data() as Partial<MonthlyTouchRecord> | undefined;
    const qcNow = current?.qc;
    if (!qcNow) return fail("This touch is not with QC.", 404);
    const appeal = qcNow.appeal;
    if (!appeal) return fail("There is no appeal on this touch.", 404);
    if (appeal.status === "resolved") return fail("This appeal has already been decided.");
    if (!appealDecisionsComplete(appeal.items, decisions)) {
      return fail("Every appealed criterion needs a decision before the reply can be sent.", 400);
    }

    const before: QcScoreValue[] = qcNow.crit || [];
    const nextCrit = applyAppealDecisions(before, decisions);
    const nextScore = qcScore(nextCrit);
    const replyText = reply?.trim();

    const qc: TouchQc = {
      ...qcNow,
      status: "appeal_resolved",
      crit: nextCrit,
      ...(nextScore === null ? {} : { score: nextScore, rating: qcRating(nextScore) }),
      appeal: {
        ...appeal,
        status: "resolved",
        decisions,
        ...(replyText ? { reply: replyText } : {}),
        ...(nextScore === null ? {} : { to: nextScore }),
        resolvedAt: at,
        resolvedBy: context.userId,
      },
    };

    tx.set(touchRef, { qc }, { mergeFields: ["qc"] });
    tx.set(
      itemRef,
      {
        status: "appeal_resolved",
        crit: nextCrit,
        ...(nextScore === null ? {} : { score: nextScore, rating: qcRating(nextScore) }),
      },
      { merge: true },
    );
    return { ok: true, qc };
  });

  if (!outcome.ok) return outcome;

  const row = await getQcIndexRow(context, touchId).catch(() => undefined);
  const from = outcome.qc.appeal?.from;
  const to = outcome.qc.score;
  const detail =
    typeof from === "number" && typeof to === "number" && from !== to
      ? `${row?.client || "A client"} · score ${from} → ${to}`
      : `${row?.client || "A client"} · score stays ${typeof from === "number" ? from : "as it was"}`;
  const notified = await notifyAm(context, row, {
    kind: "qc_appeal_decided",
    title: "Appeal decided",
    detail,
  });

  return { ...outcome, notified };
}

// ---------------------------------------------------------------------------
// Telling the AM
// ---------------------------------------------------------------------------

/**
 * Raise one notification for the touch's own AM.
 *
 * Never throws and never blocks the write that preceded it. `?touch=` is the same forward-looking
 * link the handoff used for `?qc=`: the AM's QA & Coaching page is built in the next phase, and
 * `/qa` today ignores a query parameter it does not know -- so a notification raised now opens a
 * working page and selects the right touch later. A link that 404s is worse than a plain one.
 */
async function notifyAm(
  context: TenantContext,
  row: QcIndexRow | undefined,
  candidate: { kind: "qc_scored" | "qc_appeal_decided"; title: string; detail: string },
): Promise<boolean> {
  if (!row?.amId) return false;
  const result = await raiseNotificationForUser(
    context,
    row.amId,
    {
      kind: candidate.kind,
      // One appeal per touch (handoff §6.7), so the touch id is the whole dedupe key it needs.
      subjectId: row.touchId,
      title: candidate.title,
      detail: candidate.detail,
      href: `/qa?touch=${row.touchId}`,
    },
  ).catch(() => "unavailable" as const);
  return result === "created" || result === "existing";
}
