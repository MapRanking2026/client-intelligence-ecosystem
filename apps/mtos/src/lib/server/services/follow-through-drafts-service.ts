import type { TenantContext } from "@/src/lib/contracts/mtos";
import { hasMeetingNotes } from "@/src/lib/contracts/follow-through-notes";
import type { MonthlyTouchRecord } from "@/src/lib/mtos-data";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import { stripUndefinedDeep } from "@/src/lib/server/services/mtos-ai";

type FollowThrough = NonNullable<MonthlyTouchRecord["followThrough"]>;
type DraftField = "notes" | "items" | "trackerCards" | "recap";

/** A slow generation should keep any reviewed draft saved by another tab while it ran. */
export async function persistGeneratedFollowThroughDraft<Field extends DraftField>(
  context: TenantContext,
  touchId: string,
  field: Field,
  draft: NonNullable<FollowThrough[Field]>,
): Promise<NonNullable<FollowThrough[Field]>> {
  const db = getFirebaseAdminDb();
  if (!db) throw new Error("MTOS storage is unavailable.");
  const ref = db.doc(monthlyTouchPath(context.tenantId, touchId));
  return db.runTransaction(async (transaction) => {
    const touch = (await transaction.get(ref)).data() as MonthlyTouchRecord | undefined;
    if (!touch) throw new Error("Monthly Touch not found.");
    if (!touch.followThrough?.score?.confirmedAt) throw new Error("Confirm the health score before preparing drafts.");
    const current = touch.followThrough[field];
    if (current !== undefined && (field !== "notes" || hasMeetingNotes(touch.followThrough.notes))) {
      return current;
    }
    transaction.update(ref, {
      [`followThrough.${field}`]: stripUndefinedDeep(draft),
      ...(field === "notes" ? { "followThrough.notesDraftedAt": new Date().toISOString() } : {}),
    });
    return draft;
  });
}
