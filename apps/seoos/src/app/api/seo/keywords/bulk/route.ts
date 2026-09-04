import { NextResponse } from "next/server";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { BulkKeywordAction } from "@/src/lib/domain/keyword";
import { applyBulkAction } from "@/src/lib/server/keywords-service";

export async function POST(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.project.manage");
    const action = BulkKeywordAction.parse(await request.json());
    const result = await applyBulkAction(authz.tenantId, action);
    return NextResponse.json({ data: result });
  } catch (e) {
    if (e instanceof AuthzError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Bulk action failed" },
      { status: 400 },
    );
  }
}
