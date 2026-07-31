import { NextResponse } from "next/server";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { integrationSnapshotPath } from "@/src/lib/server/firebase/collections";
import { getGhlLocationToken } from "@/src/lib/server/integration-sync";

/**
 * Stream a GoHighLevel call recording on demand. Recordings are auth-gated (no
 * public URL), so this proxies the audio using a freshly-minted location-scoped
 * token. Nothing is stored — the bytes pass straight through.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const context = await resolveTenantContext(request);
  const { clientId } = await params;
  const messageId = new URL(request.url).searchParams.get("messageId");

  if (!messageId) {
    return NextResponse.json({ error: "messageId is required" }, { status: 400 });
  }

  const db = getFirebaseAdminDb();
  if (!db) {
    return NextResponse.json({ error: "Recordings need the Firestore-backed data source." }, { status: 503 });
  }

  // The client's GoHighLevel location lives on the CRM snapshot.
  const doc = await db.doc(integrationSnapshotPath(context.tenantId, "gohighlevel")).get();
  const payload = doc.exists ? ((doc.data() as { payload?: Record<string, unknown> }).payload ?? {}) : {};
  const leadsByClient = (payload as Record<string, unknown>).leadsByClient as Record<string, unknown> | undefined;
  const clientEntry = leadsByClient?.[clientId] as { locationId?: string } | undefined;
  const locationId = clientEntry?.locationId;

  if (!locationId) {
    return NextResponse.json({ error: "No GoHighLevel location is mapped to this client." }, { status: 404 });
  }

  const token = await getGhlLocationToken(context, locationId);
  if (!token) {
    return NextResponse.json({ error: "GoHighLevel isn't connected." }, { status: 502 });
  }

  const upstream = await fetch(
    `https://services.leadconnectorhq.com/conversations/messages/${encodeURIComponent(
      messageId,
    )}/locations/${encodeURIComponent(locationId)}/recording`,
    { headers: { authorization: `Bearer ${token}`, Version: "2021-07-28" } },
  );

  if (!upstream.ok) {
    return NextResponse.json(
      { error: `GoHighLevel returned ${upstream.status} for this recording. It may not be available.` },
      { status: upstream.status === 404 ? 404 : 502 },
    );
  }

  const audio = await upstream.arrayBuffer();
  return new Response(audio, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") || "audio/mpeg",
      "cache-control": "private, max-age=300",
    },
  });
}
