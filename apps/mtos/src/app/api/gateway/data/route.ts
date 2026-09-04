import { NextResponse } from "next/server";
import { GatewayRequestV1, GatewayResponseV1 } from "@cie/contracts";
import { S2S_HEADERS, verifyGatewayRequest } from "@cie/core";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getServerEnv } from "@/src/lib/server/env";
import { dispatchGatewayResource } from "@/src/lib/server/gateway/gateway-service";

/**
 * Integration Gateway endpoint (MTOS side). Authenticates signed
 * service-to-service requests from SEOOS, validates tenant, and returns
 * secret-free, normalized data. No session cookie is used here — auth is the
 * HMAC signature over the raw body + timestamp + nonce + tenant.
 */
export async function POST(request: Request) {
  const env = getServerEnv();
  if (!env.serviceToServiceSecret) {
    return NextResponse.json(
      { error: "gateway_not_configured" },
      { status: 503 },
    );
  }

  const raw = await request.text();
  let parsed;
  try {
    parsed = GatewayRequestV1.parse(JSON.parse(raw));
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
    expectedTenantId: parsed.tenantId,
    nowMs: Date.now(),
  });
  if (!verdict.ok) {
    return NextResponse.json(
      { error: "unauthorized", reason: verdict.reason },
      { status: 401 },
    );
  }

  // Least-privilege service principal, scoped to the validated tenant.
  const context: TenantContext = {
    tenantId: parsed.tenantId,
    userId: "svc:seoos",
    role: "tenant_admin",
  };

  try {
    const result = await dispatchGatewayResource(context, parsed.resource);
    const response = GatewayResponseV1.parse({
      schemaVersion: 1,
      ok: true,
      resource: parsed.resource,
      correlationId: parsed.correlationId,
      freshness: result.freshness,
      data: result.data,
      dataGaps: result.dataGaps,
    });
    return NextResponse.json(response);
  } catch (e) {
    const response = GatewayResponseV1.parse({
      schemaVersion: 1,
      ok: false,
      resource: parsed.resource,
      correlationId: parsed.correlationId,
      freshness: "unknown",
      dataGaps: [],
      error: e instanceof Error ? e.message : "gateway_error",
    });
    return NextResponse.json(response, { status: 500 });
  }
}
