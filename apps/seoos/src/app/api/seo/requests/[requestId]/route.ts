import { NextResponse } from "next/server";
import { AuthzError, requirePermission } from "@cie/core";

import { isSeoosRequestsEnabled } from "@/src/lib/flags";
import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { getLatestPackage, getRequest } from "@/src/lib/server/seo-engine";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  if (!isSeoosRequestsEnabled()) {
    return NextResponse.json({ error: "SEOOS requests are disabled" }, { status: 404 });
  }
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.package.read");
  } catch (e) {
    if (e instanceof AuthzError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    }
    throw e;
  }

  const { requestId } = await params;
  const found = await getRequest(authz.tenantId, requestId);
  if (!found) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  return NextResponse.json({
    tenantId: authz.tenantId,
    data: { request: found, package: await getLatestPackage(authz.tenantId, requestId) },
  });
}
