import { NextResponse } from "next/server";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { runOutboxDelivery } from "@/src/lib/server/outbox-service";

/**
 * Trigger a delivery run of the durable outbox. Intended to be driven by a
 * scheduled job; exposed as a protected endpoint for now. Delivery is
 * at-least-once with backoff + dead-letter; MTOS dedups by idempotency key.
 */
export async function POST(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.package.deliver");
    const result = await runOutboxDelivery(authz.tenantId, Date.now());
    return NextResponse.json({ data: result });
  } catch (e) {
    if (e instanceof AuthzError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Delivery failed" },
      { status: 400 },
    );
  }
}
