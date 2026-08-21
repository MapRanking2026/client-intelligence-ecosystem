import { NextResponse } from "next/server";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";

const SCREEN_KEYS = ["performance", "leads", "intelligence", "plan", "promises", "overview", "runsheet"];

/** Persist the AM's override for which screen a call-guide section suggests presenting. */
export async function POST(request: Request, { params }: { params: Promise<{ touchId: string }> }) {
  const context = await resolveTenantContext(request);
  const { touchId } = await params;
  const body = (await request.json().catch(() => ({}))) as { sectionIndex?: number; screenKey?: string };

  const idx = Number(body.sectionIndex);
  const key = String(body.screenKey || "");
  if (!Number.isInteger(idx) || idx < 0 || !SCREEN_KEYS.includes(key)) {
    return NextResponse.json({ error: "Invalid section or screen." }, { status: 400 });
  }

  const db = getFirebaseAdminDb();
  if (!db) return NextResponse.json({ error: "Storage is not configured." }, { status: 500 });

  try {
    // Deep-merge writes only this section's override, leaving the others intact.
    await db.doc(monthlyTouchPath(context.tenantId, touchId)).set(
      { callGuideScreens: { [String(idx)]: key } },
      { merge: true },
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Couldn't save" }, { status: 500 });
  }
}
