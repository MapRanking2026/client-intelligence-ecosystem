import type { TenantContext } from "@/src/lib/contracts/mtos";
import { canOpenQcQueue } from "@/src/lib/contracts/qc-access";
import { amQcCards, reviewerQcCards, type QcCommandCard } from "@/src/lib/contracts/qc-cards";
import type { QcIndexRow } from "@/src/lib/contracts/qc-record";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { qcItemsCollectionPath } from "@/src/lib/server/firebase/collections";
import { withQuotaFallback } from "@/src/lib/server/firebase/quota";
import { getUserDisplayNames } from "@/src/lib/server/services/user-service";

/**
 * The rows behind the Command Center's QC cards.
 *
 * Deliberately not `getQcQueueView`: that builds the whole four-tab page including the Team cards'
 * per-criterion averages over two hundred rows of history. The Command Center needs only what is
 * open right now, and it is the screen everybody loads first every morning -- so this is the
 * narrowest query that answers the question, and nothing else.
 *
 * Every filter is an equality or an `in` with no ordering, which the automatic single-field indexes
 * serve. This repository manages no composite indexes, so a query needing one would fail in front
 * of a user rather than at deploy time.
 *
 * Returns an empty list rather than throwing on any failure. The Command Center is the first thing
 * anybody sees, and a missing card there is a far smaller problem than a page that will not render.
 */

/**
 * Enough to fill the card, not enough to become a list.
 *
 * The card shows a handful and links to QA & Coaching for the rest, so there is no point reading
 * more than can be shown plus enough to say how many more there are.
 */
const CARD_ROW_LIMIT = 40;

export interface QcCommandCards {
  cards: QcCommandCard[];
  /** True for a reviewer, admin or manager: the card is work waiting, not news. */
  forReviewer: boolean;
}

const EMPTY: QcCommandCards = { cards: [], forReviewer: false };

export async function getQcCommandCards(context: TenantContext): Promise<QcCommandCards> {
  const db = getFirebaseAdminDb();
  if (!db || !context.userId || context.userId === "unknown") return EMPTY;
  const collection = db.collection(qcItemsCollectionPath(context.tenantId));
  const forReviewer = canOpenQcQueue(context.role);

  if (forReviewer) {
    const rows = await withQuotaFallback("the QC cards", [] as QcIndexRow[], async () => {
      const snapshot = await collection
        .where("status", "in", ["ready", "in_progress", "appealed"])
        .limit(CARD_ROW_LIMIT)
        .get();
      return snapshot.docs.map((doc) => doc.data() as QcIndexRow);
    }).catch(() => [] as QcIndexRow[]);

    // One read per distinct AM, not one per row, and only for rows missing the denormalised name.
    const names = await getUserDisplayNames(
      context.tenantId,
      rows.filter((row) => !row.am).map((row) => row.amId),
    ).catch(() => ({}) as Record<string, string>);
    const withNames = rows.map((row) => ({ ...row, am: row.am || names[row.amId] || undefined }));

    return { cards: reviewerQcCards(withNames), forReviewer: true };
  }

  // Two equality pairs rather than one `in` beside an equality, for the index reason above. Each
  // returns only this AM's unread results, which is normally none or one.
  const [scored, decided] = await Promise.all(
    (["scored", "appeal_resolved"] as const).map((status) =>
      withQuotaFallback(`your ${status} QC results`, [] as QcIndexRow[], async () => {
        const snapshot = await collection
          .where("amId", "==", context.userId)
          .where("status", "==", status)
          .limit(CARD_ROW_LIMIT)
          .get();
        return snapshot.docs.map((doc) => doc.data() as QcIndexRow);
      }).catch(() => [] as QcIndexRow[]),
    ),
  );

  return { cards: amQcCards([...scored, ...decided]), forReviewer: false };
}
