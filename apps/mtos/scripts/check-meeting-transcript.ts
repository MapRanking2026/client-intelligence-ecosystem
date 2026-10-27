/**
 * Exercises the Gemini transcript lookup against live data, without going through the UI.
 *
 * The post-meeting step is behind sign-in, so this runs the same service the API route calls --
 * fetchMonthlyTouchTranscript -- for real monthly touches, and reports the status each one
 * resolves to. Read-only: it reads Firestore and Google, and writes nothing.
 *
 *   npx tsx scripts/check-meeting-transcript.ts            # most recent 5 touches with an event
 *   npx tsx scripts/check-meeting-transcript.ts <touchId>  # one specific touch
 */
import { loadEnvConfig } from "@next/env";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import {
  monthlyTouchesCollectionPath,
  tenantUsersCollectionPath,
} from "@/src/lib/server/firebase/collections";
import { listActiveTenantIds } from "@/src/lib/server/services/daily-sync-service";
import {
  FULL_NOTES_MARKER,
  TRANSCRIPT_MARKER,
  fetchMonthlyTouchTranscript,
  splitTranscriptPayload,
} from "@/src/lib/server/services/meeting-transcript-service";

async function main() {
  loadEnvConfig(process.cwd());

  const requestedTouchId = process.argv[2];
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firebase Admin must be configured");
  }

  const [tenantId] = await listActiveTenantIds();
  const users = await db.collection(tenantUsersCollectionPath(tenantId)).get();

  // The lookup reads the signed-in user's own Google connection and primary calendar, so it has
  // to run as a specific user rather than as the cron identity.
  const contexts: TenantContext[] = users.docs.map((doc) => ({
    tenantId,
    userId: doc.id,
    role: String((doc.data() as { role?: string }).role || "account_manager") as TenantContext["role"],
  }));

  const touchSnapshot = await db
    .collection(monthlyTouchesCollectionPath(tenantId))
    .orderBy("scheduledAt", "desc")
    .limit(60)
    .get();

  // Only the handful of fields this report prints; the rest of the document is along for the ride.
  type TouchRow = {
    id: string;
    calendarEventId?: unknown;
    clientName?: unknown;
    clientId?: unknown;
    scheduledAt?: unknown;
  };

  const touches = touchSnapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }) as TouchRow)
    .filter((touch) => (requestedTouchId ? touch.id === requestedTouchId : Boolean(touch.calendarEventId)))
    .slice(0, requestedTouchId ? 1 : 5);

  console.log(`tenant=${tenantId} users=${contexts.length} touches=${touches.length}\n`);

  for (const touch of touches) {
    const label = `${String(touch.clientName || touch.clientId || touch.id)} (${String(touch.scheduledAt || "no date")})`;
    console.log(`=== ${label}`);
    console.log(`    touchId=${touch.id} calendarEventId=${touch.calendarEventId ? "yes" : "NO"}`);

    for (const context of contexts) {
      const lookup = await fetchMonthlyTouchTranscript(context, String(touch.id));
      const detail: string[] = [`status=${lookup.status}`];
      if (lookup.matchedBy) detail.push(`matchedBy=${lookup.matchedBy}`);
      if (lookup.doc?.title) detail.push(`doc="${lookup.doc.title}"`);

      if (lookup.status === "loaded" && lookup.transcript) {
        const parts = splitTranscriptPayload(lookup.transcript);
        detail.push(`notes=${parts.fullNotes ? `${parts.fullNotes.length}c` : "none"}`);
        detail.push(`transcript=${parts.transcript.length}c`);
        detail.push(`markers=${lookup.transcript.includes(FULL_NOTES_MARKER) && lookup.transcript.includes(TRANSCRIPT_MARKER) ? "both" : "INCOMPLETE"}`);
      } else if (lookup.reason) {
        detail.push(`reason="${lookup.reason.slice(0, 120)}"`);
      }

      console.log(`    user=${context.userId.slice(0, 12)} ${detail.join(" ")}`);

      if (lookup.status === "loaded" && lookup.transcript) {
        const parts = splitTranscriptPayload(lookup.transcript);
        console.log("    --- first transcript lines ---");
        for (const line of parts.transcript.split("\n").filter(Boolean).slice(0, 4)) {
          console.log(`      ${line.slice(0, 110)}`);
        }
      }
    }
    console.log();
  }
}

main().catch((error) => {
  console.error("FAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
