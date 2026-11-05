import type { TenantContext } from "@/src/lib/contracts/mtos";
import {
  QC_QUEUE_STATUSES,
  isQueued,
  isScored,
  queueCounts,
  sortQueueOldestFirst,
  sortScoredNewestFirst,
  type QcQueueCounts,
} from "@/src/lib/contracts/qc-queue";
import type { QcIndexRow } from "@/src/lib/contracts/qc-record";
import { teamCards, type QcTeamCard } from "@/src/lib/contracts/qc-team";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { qcItemPath, qcItemsCollectionPath } from "@/src/lib/server/firebase/collections";
import { withQuotaFallback } from "@/src/lib/server/firebase/quota";
import { getUserDisplayNames } from "@/src/lib/server/services/user-service";
import { getQcReviewers } from "@/src/lib/server/services/qc-reviewers-service";

/**
 * Reading the QC queue, in two queries over the index collection.
 *
 * ## Two queries, and why it is not one
 *
 * **Open work** is fetched by status with no ordering: `where status in (ready, in_progress,
 * appealed)`. **History** is fetched by `readyAt` descending with a limit. Both use the automatic
 * single-field indexes, because this repository does not manage Firestore composite indexes -- a
 * `where` combined with an `orderBy` on a different field would need one created by hand in the
 * console, and until somebody did the page would fail with FAILED_PRECONDITION rather than render.
 * The ordering the handoff asks for is applied in memory afterwards, over a few hundred rows.
 *
 * The split exists so that **age can never hide work**. A single `orderBy readyAt desc` with a
 * limit would be simpler, but at roughly two hundred touches a month a touch that has waited six
 * weeks would fall out of the window -- and that is precisely the touch the queue is supposed to be
 * shouting about in red. Open work is therefore queried by status, where no amount of waiting can
 * push it out of view. Only history is capped, and a capped history is a page of history.
 *
 * ## Quota
 *
 * Index rows are a few hundred bytes; a touch document is hundreds of kilobytes. Every field these
 * tabs show is on the row (see `QcIndexRow`), so drawing the whole page costs two queries plus one
 * read per *distinct AM* for the display names -- not one read per row, and never a touch read.
 * This app has already had production deploys fail on the Firestore daily read limit.
 */

/** History is a page, not an archive. Raised only if a tenant actually outgrows it. */
const HISTORY_LIMIT = 200;

/**
 * Open work is bounded too, but generously: this is the number of touches that can be waiting at
 * once, and a tenant with more than this in the queue has a staffing problem, not a paging problem.
 */
const OPEN_LIMIT = 300;

export interface QcQueueView {
  counts: QcQueueCounts;
  /** Oldest first: a reviewer works downwards, so the longest wait must be at the top. */
  queue: QcIndexRow[];
  appeals: QcIndexRow[];
  scored: QcIndexRow[];
  team: QcTeamCard[];
  /** The configured reviewer's name, for the "Appeal with {name}" chip. Absent if none is set. */
  reviewerName?: string;
}

const EMPTY_VIEW: QcQueueView = {
  counts: { queue: 0, appeals: 0, scored: 0, team: 0 },
  queue: [],
  appeals: [],
  scored: [],
  team: [],
};

function rowsOf(snapshot: { docs: { data: () => unknown }[] }): QcIndexRow[] {
  return snapshot.docs.map((doc) => doc.data() as QcIndexRow);
}

/** Union by touch id. A row appears in both queries only if it is open and recent. */
function mergeRows(...lists: QcIndexRow[][]): QcIndexRow[] {
  const byId = new Map<string, QcIndexRow>();
  for (const list of lists) {
    for (const row of list) {
      if (row?.touchId) byId.set(row.touchId, row);
    }
  }
  return [...byId.values()];
}

/**
 * The whole QC page: four tabs from two queries.
 *
 * Returns an empty view rather than throwing when there is no database or the quota is spent. The
 * queue being empty for a reason is a readable screen; a 500 on the page a reviewer opens every
 * morning is not. A genuine fault -- a missing index, a rules rejection -- still propagates, which
 * is what `withQuotaFallback` is careful about.
 */
export async function getQcQueueView(context: TenantContext): Promise<QcQueueView> {
  const db = getFirebaseAdminDb();
  if (!db) return EMPTY_VIEW;

  const collection = db.collection(qcItemsCollectionPath(context.tenantId));

  const rows = await withQuotaFallback("the QC queue", [] as QcIndexRow[], async () => {
    const [open, history] = await Promise.all([
      // No orderBy: see the note above. `in` with three values uses the automatic status index.
      collection
        .where("status", "in", [...QC_QUEUE_STATUSES, "appealed"])
        .limit(OPEN_LIMIT)
        .get(),
      collection.orderBy("readyAt", "desc").limit(HISTORY_LIMIT).get(),
    ]);
    return mergeRows(rowsOf(open), rowsOf(history));
  });

  const names = await getUserDisplayNames(
    context.tenantId,
    rows.map((row) => row.amId),
  ).catch(() => ({}) as Record<string, string>);

  // The row's own denormalised name wins -- it is what was true when the touch was handed over.
  // The lookup only fills rows written before that field existed, or whose AM has since renamed.
  const nameFor = (row: QcIndexRow) => row.am || names[row.amId] || "";
  const withNames = rows.map((row) => ({ ...row, am: nameFor(row) || undefined }));

  const reviewers = await getQcReviewers(context.tenantId).catch(() => ({ userIds: [] as string[] }));
  const reviewerNames = await getUserDisplayNames(context.tenantId, reviewers.userIds).catch(
    () => ({}) as Record<string, string>,
  );
  const reviewerName = reviewers.userIds.map((id) => reviewerNames[id]).find(Boolean);

  const teamNames: Record<string, string> = {};
  for (const row of withNames) {
    if (row.am) teamNames[row.amId] = row.am;
  }

  const cards = teamCards(withNames, teamNames);

  return {
    counts: queueCounts(withNames, cards.length),
    queue: sortQueueOldestFirst(withNames.filter((row) => isQueued(row.status))),
    appeals: sortScoredNewestFirst(withNames.filter((row) => row.status === "appealed")),
    scored: sortScoredNewestFirst(withNames.filter((row) => isScored(row.status))),
    team: cards,
    ...(reviewerName ? { reviewerName } : {}),
  };
}

/**
 * One index row, for the routes that need to know whose touch this is before reading it.
 *
 * The index is the only place a touch is linked to its AM -- `MonthlyTouchRecord` has no owner
 * field -- so every permission check on a QC record starts here, with one small read, rather than
 * by opening the touch and then discovering the reader was not allowed to.
 */
export async function getQcIndexRow(
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
