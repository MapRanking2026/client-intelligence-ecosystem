import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { clientPath } from "@/src/lib/server/firebase/collections";
import { createGoogleMeeting, endGoogleMeeting, getGoogleMeetingOverview, pinGoogleConference, selectGoogleMeeting, syncGoogleMeeting } from "@/src/lib/server/services/google-meet-service";

export const maxDuration = 300;
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("select"), eventId: z.string().min(1).max(1024), conferenceName: z.string().regex(/^conferenceRecords\/[a-zA-Z0-9_-]+$/).optional() }),
  z.object({ action: z.literal("create") }),
  z.object({ action: z.literal("sync") }),
  z.object({ action: z.literal("conference"), conferenceName: z.string().regex(/^conferenceRecords\/[a-zA-Z0-9_-]+$/) }),
  z.object({ action: z.literal("end"), conferenceName: z.string().regex(/^conferenceRecords\/[a-zA-Z0-9_-]+$/) }),
  z.object({ action: z.literal("client_emails"), emails: z.array(z.email()).max(20) }),
]);

export async function GET(request: Request, { params }: { params: Promise<{ touchId: string }> }) {
  const context = await resolveTenantContext(request);
  if (context.userId === "unknown") return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  try {
    const { touchId } = await params;
    return NextResponse.json({ data: await getGoogleMeetingOverview(context, touchId) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load meetings." }, { status: 400 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ touchId: string }> }) {
  const context = await resolveTenantContext(request);
  if (context.userId === "unknown") return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const { touchId } = await params;
    const body = schema.parse(await request.json());
    let data: unknown;
    if (body.action === "select") data = await selectGoogleMeeting(context, touchId, body.eventId, body.conferenceName);
    if (body.action === "create") data = await createGoogleMeeting(context, touchId);
    if (body.action === "end") { await endGoogleMeeting(context, touchId, body.conferenceName); data = { ended: true }; }
    if (body.action === "sync") data = await syncGoogleMeeting(context, touchId);
    if (body.action === "conference") data = await pinGoogleConference(context, touchId, body.conferenceName);
    if (body.action === "client_emails") {
      const source = getMtosDataSource(context);
      const touch = await source.getMonthlyTouchById(touchId);
      if (!touch || !await source.getClientById(touch.clientId)) throw new Error("Client not available to your account.");
      const db = getFirebaseAdminDb();
      if (!db) throw new Error("Database is unavailable.");
      await db.doc(clientPath(context.tenantId, touch.clientId)).set({ googleMeetingEmails: [...new Set(body.emails.map((email) => email.toLowerCase()))] }, { merge: true });
      data = { saved: true };
    }
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Meeting action failed." }, { status: 400 });
  }
}
