import type { TenantContext } from "@/src/lib/contracts/mtos";
import {
  buildRecapEmailDraft,
  sanitizeRecapEmailHtml,
  type RecapEmailState,
  type RecapWin,
} from "@/src/lib/contracts/follow-through-recap-email";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getServerEnv } from "@/src/lib/server/env";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import { getAccountManagerPreferences, getAccountManagerProfile } from "@/src/lib/server/services/user-service";

/**
 * Assembling the recap email from what the touch actually decided.
 *
 * Everything in it is read from a record: the summary from the notes, the commitments from the
 * approved tickets, the asks from the client actions, the sign-off from the AM's profile. The
 * one thing MTOS cannot supply is covered below.
 */

/** `Mon, 2 November` in the AM's own zone. */
function dayLabel(iso: string | undefined, timeZone: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "long",
    timeZone,
  }).format(date);
}

/**
 * The wins to show, from the Map Ranking commitments that were completed.
 *
 * Their ship dates come back EMPTY, and that is not an oversight. A commitment record carries a
 * due date and a status, and nothing anywhere records the day a piece of work actually shipped.
 * Writing the due date into a client-facing email as "shipped 14 October" would be stating a
 * date we do not hold, about work the client can check. So the AM fills these in, and the email
 * leaves a win undated rather than carrying a date that might be wrong.
 */
async function winsSinceLastTouch(context: TenantContext, clientId: string): Promise<RecapWin[]> {
  const dataSource = getMtosDataSource(context);
  const commitments = await dataSource.getCommitments(clientId);
  return commitments
    .filter((commitment) => commitment.status === "Completed" && commitment.category === "Map Ranking")
    .slice(0, 6)
    .map((commitment) => ({ what: commitment.title, shipped: "" }));
}

export interface RecapBuildResult {
  recap: RecapEmailState;
  blockingGaps: string[];
  note?: string;
}

export async function buildFollowThroughRecap(
  context: TenantContext,
  touchId: string,
): Promise<RecapBuildResult> {
  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }
  const notes = touch.followThrough?.notes;
  if (!notes) {
    throw new Error("Draft the notes before building the recap email.");
  }
  const client = await dataSource.getClientById(touch.clientId);
  if (!client) {
    throw new Error("The client for this touch is not visible to you.");
  }

  const [profile, preferences] = await Promise.all([
    getAccountManagerProfile(context),
    getAccountManagerPreferences(context),
  ]);
  const env = getServerEnv();
  const timeZone = profile.timeZone;

  // The next check-in is only named when one is actually on the calendar. Booking it is the last
  // step of the follow-through, so on most runs this is empty and the email simply does not
  // promise a date -- which is better than promising one nobody has agreed to.
  const touches = await dataSource.getMonthlyTouches();
  const next = touches
    .filter(
      (candidate) =>
        candidate.clientId === client.id &&
        candidate.id !== touch.id &&
        candidate.scheduledAt &&
        touch.scheduledAt &&
        candidate.scheduledAt > touch.scheduledAt,
    )
    .sort((a, b) => (a.scheduledAt || "").localeCompare(b.scheduledAt || ""))[0];

  const wins = await winsSinceLastTouch(context, client.id);

  const draft = buildRecapEmailDraft(
    {
      businessName: client.name,
      contactName: client.contact || "",
      metLabel: dayLabel(touch.scheduledAt, timeZone),
      nextCheckInLabel: dayLabel(next?.scheduledAt, timeZone),
      nextCheckInUrl: "",
      signoff: preferences.emailSignoff || "",
      accountManagerName: profile.name || client.accountManager || "",
      ...(env.appUrl ? { appUrl: env.appUrl } : {}),
      wins,
    },
    notes,
    touch.followThrough?.items || [],
  );

  return {
    recap: { subject: draft.subject, html: draft.html },
    blockingGaps: draft.blockingGaps,
    ...(wins.length
      ? {
          note: "The wins are the Map Ranking commitments marked complete. MTOS has no record of the day each one actually shipped, so those dates are blank — add them, or the email will go out without them.",
        }
      : {}),
  };
}

export async function saveFollowThroughRecap(
  context: TenantContext,
  touchId: string,
  recap: RecapEmailState,
): Promise<RecapEmailState> {
  // Cleaned on the way in, so the stored draft is exactly what the client would receive. The AM
  // wrote it, so this is not defence against an attacker -- it is defence against what lands in
  // a contentEditable when someone pastes from a web page.
  const cleaned: RecapEmailState = { ...recap, html: sanitizeRecapEmailHtml(recap.html) };
  const db = getFirebaseAdminDb();
  if (db) {
    await db
      .doc(monthlyTouchPath(context.tenantId, touchId))
      .set({ followThrough: { recap: cleaned } }, { mergeFields: ["followThrough.recap"] });
  }
  return cleaned;
}
