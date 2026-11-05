import type { TenantContext } from "@/src/lib/contracts/mtos";
import { canOpenQcQueue } from "@/src/lib/contracts/qc-access";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { qcItemsCollectionPath } from "@/src/lib/server/firebase/collections";
import { withQuotaFallback } from "@/src/lib/server/firebase/quota";

/**
 * The violet count on the sidebar's QA & Coaching item (handoff §6.9).
 *
 * ## Why this is counted rather than listed
 *
 * The sidebar is on every page, so this runs on every page load for every signed-in person. A
 * query that returned the rows and counted them in memory would read one document per queued touch
 * per page view -- six people, fifty page views each, twenty touches in the queue is six thousand
 * reads a day for a number in a badge. This app has already had production deploys fail on the
 * Firestore daily read limit.
 *
 * So it uses Firestore's aggregate `count()`, which is billed as **one read per thousand documents
 * matched** rather than one per document. A badge for a queue of twenty costs one read, and so does
 * a badge for a queue of nine hundred.
 *
 * ## Every filter here is an equality, on purpose
 *
 * This repository manages no Firestore composite indexes, so a query needing one would fail with
 * FAILED_PRECONDITION in front of a user rather than at deploy time. The reviewer's count is one
 * `in` over `status` with no ordering, which the automatic single-field index serves -- the same
 * shape the queue page already uses in production. The AM's two counts are equality on `amId` and
 * equality on `status`, which Firestore serves by merging two single-field indexes.
 *
 * `scripts/verify-qc-am.ts` runs both against the live tenant, which is where a wrong assumption
 * about any of that would surface as a hard failure rather than as a missing number.
 *
 * ## What the number means depends on who is asking
 *
 * For a reviewer, admin or manager it is **work waiting**: touches to score plus appeals to answer.
 * For an account manager it is **news unread**: their own scores they have not opened. Those are
 * genuinely different quantities, and a badge that mixed them would tell a manager who also runs
 * touches a number that was neither.
 */

export interface QcBadge {
  count: number;
  /** "queue" for work waiting, "scores" for unread news. The nav uses it for the tooltip. */
  kind: "queue" | "scores";
  /** Said in full for the title attribute, because a bare number explains nothing. */
  label: string;
}

const NONE: QcBadge = { count: 0, kind: "scores", label: "Nothing waiting in QC" };

/** One aggregate count, or 0 when it cannot be read. A badge must never break a page. */
async function countWhere(
  build: (collection: ReturnType<NonNullable<ReturnType<typeof getFirebaseAdminDb>>["collection"]>) => {
    count: () => { get: () => Promise<{ data: () => { count: number } }> };
  },
  tenantId: string,
  label: string,
): Promise<number> {
  const db = getFirebaseAdminDb();
  if (!db) return 0;
  return withQuotaFallback(label, 0, async () => {
    const snapshot = await build(db.collection(qcItemsCollectionPath(tenantId))).count().get();
    return snapshot.data().count;
  }).catch(() => 0);
}

/**
 * The badge for whoever is asking.
 *
 * Never throws. A badge that could fail a page render would take the whole app down for a number
 * nobody would miss, so every failure path here returns zero and the badge simply does not show.
 */
export async function getQcBadge(context: TenantContext): Promise<QcBadge> {
  const db = getFirebaseAdminDb();
  if (!db || !context.userId || context.userId === "unknown") return NONE;

  if (canOpenQcQueue(context.role)) {
    // One `in` over status, no ordering: the automatic single-field index serves it.
    const count = await countWhere(
      (collection) => collection.where("status", "in", ["ready", "in_progress", "appealed"]),
      context.tenantId,
      "the QC queue badge",
    );
    return {
      count,
      kind: "queue",
      label: count
        ? `${count} ${count === 1 ? "touch" : "touches"} waiting in QC`
        : "Nothing waiting in QC",
    };
  }

  // Two equality pairs rather than one `in` beside an equality: equality-only filters are the
  // shape Firestore is certain to serve from single-field indexes, and two counts are two reads.
  const [scored, decided] = await Promise.all([
    countWhere(
      (collection) => collection.where("amId", "==", context.userId).where("status", "==", "scored"),
      context.tenantId,
      "your unread QC scores",
    ),
    countWhere(
      (collection) =>
        collection.where("amId", "==", context.userId).where("status", "==", "appeal_resolved"),
      context.tenantId,
      "your decided QC appeals",
    ),
  ]);
  const count = scored + decided;
  return {
    count,
    kind: "scores",
    label: count
      ? `${count} new QC ${count === 1 ? "result" : "results"} you haven't read`
      : "No new QC scores",
  };
}
