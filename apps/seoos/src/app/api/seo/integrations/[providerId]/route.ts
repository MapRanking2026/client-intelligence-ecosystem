import { NextResponse } from "next/server";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import {
  ConnectError,
  connectIntegration,
  disconnectIntegration,
} from "@/src/lib/server/integrations-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ providerId: string }> },
) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "integrations.manage");
    const { providerId } = await params;
    const body = await request.json().catch(() => ({}));
    const values = (body?.values ?? {}) as Record<string, string>;
    const conn = await connectIntegration(authz.tenantId, providerId, values, authz.userId);
    // Never return credential material.
    return NextResponse.json({
      data: {
        providerId: conn.providerId,
        status: conn.status,
        connectedAt: conn.connectedAt,
        note: conn.metadata?.validation,
      },
    });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    if (e instanceof ConnectError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Connect failed" }, { status: 400 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ providerId: string }> },
) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "integrations.manage");
    const { providerId } = await params;
    await disconnectIntegration(authz.tenantId, providerId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
