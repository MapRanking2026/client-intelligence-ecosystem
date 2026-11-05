import type { Role } from "@/src/lib/contracts/mtos";

/**
 * Who may do what in QC.
 *
 * Pure, and separate from the QC record on purpose: these are the predicates every new route
 * checks before it reads or writes anything, so they need to be testable without a tenant, a
 * session or a database. A permission rule that can only be exercised by signing in is a rule
 * nobody writes a negative test for.
 *
 * ## Scoring and watching are different permissions
 *
 * The decision behind this file (owner, 4 November 2026): **Sady is the only QC reviewer, but
 * every admin can open the QC screens.** So there are two questions, not one.
 *
 *  - **Can this person score a touch?** Only a `qa_reviewer`. Scoring means applying a 17-point
 *    rubric consistently across a whole team, which is a trained job; spreading it across whoever
 *    happens to have admin rights would make scores from different months incomparable, and the
 *    averages on the AM's own page are built on exactly that comparison.
 *  - **Can this person see the queue?** A `qa_reviewer` or a `tenant_admin`. The people who run
 *    the company need to see what is waiting and what was scored without being handed work.
 *
 * Which touches a reviewer is *assigned* is a separate matter again, and it is data rather than
 * role: `qcReviewerUserIds` in the tenant settings. An admin opening the queue is a reader because
 * they are not in that list, not because the screen is hiding something from them.
 *
 * ## An AM sees their own
 *
 * An `account_manager` may read the QC of a touch they ran and nobody else's, and may appeal,
 * acknowledge or ask for a coaching chat only on their own. A score is a personal review; an AM
 * browsing a colleague's would be a performance record leaking sideways through a URL.
 */

/**
 * Only a trained reviewer scores, and only a reviewer decides an appeal.
 *
 * Not an admin and not a manager, even though both can read everything. Scoring means applying one
 * rubric consistently across a whole team over months, and the AM's own page averages those scores
 * and draws a trend from them -- a number produced by somebody who has not been calibrated against
 * the others makes that trend meaningless. An admin who should score is given `qa_reviewer`.
 */
export function canScoreQc(role: Role): boolean {
  return role === "qa_reviewer";
}

/**
 * Who may open the QC queue, the Scored tab and the Team cards.
 *
 * Three roles. `qa_reviewer` because it is their job; `tenant_admin` because the owner asked for
 * every admin to be able to watch the queue; `manager` because the handoff already gives managers
 * oversight of everyone's QC and the Team tab, and a manager who could see the team's averages but
 * not the queue those averages come from would be looking at a summary they cannot check.
 *
 * None of this grants scoring. See `canScoreQc`.
 */
export function canOpenQcQueue(role: Role): boolean {
  return role === "qa_reviewer" || role === "tenant_admin" || role === "manager";
}

/** Who may read every AM's QC records and the Team tab, rather than only their own. */
export function canSeeAllQc(role: Role): boolean {
  return canOpenQcQueue(role);
}

/**
 * Whether this person may read one touch's QC record.
 *
 * `amId` is the AM who ran the touch. An absent `amId` is treated as nobody's: an unattributed
 * record is readable only by the people who can see everything, because the alternative -- letting
 * it through for whoever asked -- fails open.
 */
export function canReadQcRecord(role: Role, userId: string, amId: string | undefined): boolean {
  if (canSeeAllQc(role)) return true;
  return Boolean(amId) && amId === userId;
}

/**
 * Whether this person may appeal, acknowledge or request a chat about this touch.
 *
 * Only the AM who ran it -- not a reviewer, not an admin. Someone else marking a score as reviewed
 * or appealing on an AM's behalf would put words in their mouth in their own record.
 */
export function canActAsTouchOwner(userId: string, amId: string | undefined): boolean {
  return Boolean(amId) && amId === userId;
}

/** The display title a `qa_reviewer` is shown under, which is not the same as the role's name. */
export const QC_SPECIALIST_TITLE = "QC Specialist";
