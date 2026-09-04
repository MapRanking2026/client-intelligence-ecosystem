import { NextResponse } from "next/server";

import { isSeoosRequestsEnabled } from "@/src/lib/flags";
import { resolveSeoContext } from "@/src/lib/server/context";
import {
  getLatestPackageSync,
  getRequestSync,
} from "@/src/lib/server/seo-engine";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  if (!isSeoosRequestsEnabled()) {
    return NextResponse.json({ error: "SEOOS requests are disabled" }, { status: 404 });
  }
  const ctx = resolveSeoContext(request);
  const { requestId } = await params;
  const found = getRequestSync(ctx.tenantId, requestId);
  if (!found) {
    return NextResponse.json({ error: "Request not found" }, { status: 404 });
  }
  return NextResponse.json({
    tenantId: ctx.tenantId,
    data: {
      request: found,
      package: getLatestPackageSync(ctx.tenantId, requestId),
    },
  });
}
