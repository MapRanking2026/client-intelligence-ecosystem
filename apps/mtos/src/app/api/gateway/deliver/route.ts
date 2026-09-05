import { NextResponse } from "next/server";
import { OutboxEventV1 } from "@cie/contracts";
import { S2S_HEADERS, verifyGatewayRequest } from "@cie/core";

import { getServerEnv } from "@/src/lib/server/env";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";

/**
 * MTOS delivery receiver for the SEOOS outbox. Verifies the signed S2S request,
 * then idempotently records the delivered event (keyed by idempotencyKey) so
 * redelivery is a no-op. This is how approved packages reach MTOS without MTOS
 * reaching into SEOOS storage.
 */
function docIdFrom(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 400);
}

export async function POST(request: Request) {
  const env = getServerEnv();
  if (!env.serviceToServiceSecret) {
    return NextResponse.json({ error: "gateway_not_configured" }, { status: 503 });
  }

  const raw = await request.text();
  let event;
  try {
    event = OutboxEventV1.parse(JSON.parse(raw));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "bad_request" },
      { status: 400 },
    );
  }

  const verdict = await verifyGatewayRequest(env.serviceToServiceSecret, {
    timestamp: request.headers.get(S2S_HEADERS.timestamp),
    nonce: request.headers.get(S2S_HEADERS.nonce),
    tenantHeader: request.headers.get(S2S_HEADERS.tenant),
    signature: request.headers.get(S2S_HEADERS.signature),
    body: raw,
    expectedTenantId: event.tenantId,
    nowMs: Date.now(),
  });
  if (!verdict.ok) {
    return NextResponse.json({ error: "unauthorized", reason: verdict.reason }, { status: 401 });
  }

  const db = getFirebaseAdminDb();
  if (!db) {
    // Accept but cannot persist without Firestore (dev/seed). Avoids retry storms.
    return NextResponse.json({ ok: true, persisted: false });
  }

  await db
    .collection("tenants")
    .doc(event.tenantId)
    .collection("seoDeliveries")
    .doc(docIdFrom(event.idempotencyKey))
    .set({ event, receivedAt: new Date().toISOString() });

  return NextResponse.json({ ok: true, persisted: true });
}
