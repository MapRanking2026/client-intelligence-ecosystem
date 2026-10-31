import { NextResponse } from "next/server";
import { z } from "zod";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import type { LiveSession } from "@/src/lib/mtos-data";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import { getNowIso } from "@/src/lib/server/services/mtos-ai";

/**
 * Saving what the AM captures during the meeting.
 *
 * Called as they move between agenda segments and when they stop typing, so notes and timings
 * survive a tab switch, a reload, or the laptop going to sleep mid-call. It writes only the live
 * session -- it never touches the preparation, the scores or the touch's status, because being in
 * the room is not an approval of anything.
 */

const segmentSchema = z.object({
  key: z.string().min(1).max(120),
  title: z.string().min(1).max(300),
  notes: z.string().max(20000),
  elapsedSeconds: z.number().int().min(0).max(60 * 60 * 12),
});

const bodySchema = z.object({
  segments: z.array(segmentSchema).max(40),
  recapStepsDone: z.array(z.number().int().min(1).max(6)).max(6),
  closeNotes: z.string().max(20000),
  /** Set once, when the AM opens Live mode. */
  startedAt: z.string().max(60).optional(),
});

export async function PUT(request: Request, { params }: { params: Promise<{ touchId: string }> }) {
  const context = await resolveTenantContext(request);
  const { touchId } = await params;

  let payload: z.infer<typeof bodySchema>;
  try {
    payload = bodySchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Those live notes could not be saved." },
      { status: 400 },
    );
  }

  const touch = await getMtosDataSource(context).getMonthlyTouchById(touchId);
  if (!touch) {
    return NextResponse.json({ error: "Monthly touch not found" }, { status: 404 });
  }

  const now = getNowIso();
  const liveSession: LiveSession = {
    startedAt: touch.liveSession?.startedAt || payload.startedAt || now,
    updatedAt: now,
    segments: payload.segments,
    // De-duplicated and ordered, so the checklist reads the same however the AM clicked through it.
    recapStepsDone: [...new Set(payload.recapStepsDone)].sort((a, b) => a - b),
    closeNotes: payload.closeNotes,
  };

  const db = getFirebaseAdminDb();
  if (!db) {
    return NextResponse.json(
      {
        error:
          "MTOS has no database connection right now, so these notes were not saved. Copy them somewhere safe before you close this view.",
      },
      { status: 503 },
    );
  }

  await db.doc(monthlyTouchPath(context.tenantId, touchId)).set({ liveSession }, { merge: true });

  return NextResponse.json({ context, data: { liveSession } });
}
