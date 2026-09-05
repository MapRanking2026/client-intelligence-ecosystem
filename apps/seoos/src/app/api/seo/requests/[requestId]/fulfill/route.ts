import { NextResponse } from "next/server";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { fulfillRequest } from "@/src/lib/server/seo-engine";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.request.fulfill");
    const { requestId } = await params;
    const result = await fulfillRequest(authz.tenantId, requestId);
    return NextResponse.json({ data: result });
  } catch (e) {
    if (e instanceof AuthzError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fulfillment failed" },
      { status: 400 },
    );
  }
}
