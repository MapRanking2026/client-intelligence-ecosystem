import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantSettingsPath } from "@/src/lib/server/firebase/collections";
import { listTenantUserContexts } from "@/src/lib/server/services/daily-sync-service";

/**
 * Who the QC reviewers are, resolved once so every caller agrees.
 *
 * Two sources, in order:
 *
 *  1. **`qcReviewerUserIds`** in the tenant settings. The explicit list, and the one the owner
 *     maintains. Today it holds one person.
 *  2. **Every user whose role is `qa_reviewer`**, when that list is empty or unset. A deployment
 *     that has never configured the setting still routes QC work to the people whose role says
 *     they do it, rather than routing it nowhere.
 *
 * When both come back empty this returns an empty array and says so to the caller. It does not
 * throw and it does not fall back to an admin: a touch quietly assigned to whoever happened to
 * have rights is worse than one that is visibly unassigned, because nobody goes looking for work
 * they were never told about. The handoff records that it could not notify anyone, which is the
 * §0.7 rule -- degrade, say what happened, never crash.
 */

/** The settings document id. One small doc, read on the handoff and on the QC screens. */
export const QC_REVIEWERS_SETTING_ID = "qcReviewers";

export interface QcReviewersSetting {
  userIds: string[];
  updatedAt?: string;
}

export interface QcReviewers {
  userIds: string[];
  /** Where the list came from, so a screen can say "no reviewer configured" rather than guess. */
  source: "configured" | "role" | "none";
}

function uniqueIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const id = value.trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** The configured list, or an empty array when the document is missing or unreadable. */
export async function getConfiguredQcReviewerIds(tenantId: string): Promise<string[]> {
  const db = getFirebaseAdminDb();
  if (!db) return [];
  try {
    const snapshot = await db.doc(tenantSettingsPath(tenantId, QC_REVIEWERS_SETTING_ID)).get();
    if (!snapshot.exists) return [];
    return uniqueIds((snapshot.data() as Partial<QcReviewersSetting> | undefined)?.userIds);
  } catch {
    // An unreadable settings document must not stop a follow-through being handed over. The role
    // fallback below still finds the reviewers.
    return [];
  }
}

/**
 * The reviewers to notify and assign, with where the answer came from.
 *
 * Costs one document read in the normal case. The role fallback reads the tenant's user list,
 * which is why it is a fallback: it is the more expensive of the two and this runs on every Finish.
 */
export async function getQcReviewers(tenantId: string): Promise<QcReviewers> {
  const configured = await getConfiguredQcReviewerIds(tenantId);
  if (configured.length) return { userIds: configured, source: "configured" };

  try {
    const contexts = await listTenantUserContexts(tenantId);
    const byRole = contexts.filter((entry) => entry.role === "qa_reviewer").map((entry) => entry.userId);
    if (byRole.length) return { userIds: byRole, source: "role" };
  } catch {
    // Same reasoning as above.
  }

  return { userIds: [], source: "none" };
}

/** Save the explicit list. Admins only; the route that calls this checks that first. */
export async function saveQcReviewerIds(
  context: TenantContext,
  userIds: string[],
): Promise<QcReviewersSetting> {
  const db = getFirebaseAdminDb();
  if (!db) throw new Error("QC reviewers cannot be saved: this deployment has no database connection.");
  const next: QcReviewersSetting = {
    userIds: uniqueIds(userIds),
    updatedAt: new Date().toISOString(),
  };
  await db.doc(tenantSettingsPath(context.tenantId, QC_REVIEWERS_SETTING_ID)).set(next, { merge: true });
  return next;
}
