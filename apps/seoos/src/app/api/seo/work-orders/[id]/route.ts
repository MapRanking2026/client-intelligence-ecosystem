import { NextResponse } from "next/server";
import { AuthzError, requireClientAccess, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { WorkOrderStatus, QaResult } from "@/src/lib/domain/work-order";
import {
  getWorkOrder,
  qaReviewWorkOrder,
  transitionWorkOrder,
} from "@/src/lib/server/workorders-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    const wo = await getWorkOrder(authz.tenantId, id);
    if (!wo) return NextResponse.json({ error: "Not found" }, { status: 404 });
    requireClientAccess(authz.clientVisibility, wo.clientId);

    const body = await request.json();
    const action = String(body?.action ?? "");

    if (action === "qa") {
      requirePermission(authz.permissions, "seo.package.qa");
      const result = QaResult.parse(body?.result);
      const updated = await qaReviewWorkOrder(
        authz.tenantId,
        id,
        result,
        authz.userId,
        typeof body?.notes === "string" ? body.notes : undefined,
      );
      return NextResponse.json({ data: updated });
    }

    if (action === "transition") {
      requirePermission(authz.permissions, "seo.project.manage");
      const to = WorkOrderStatus.parse(body?.to);
      const updated = await transitionWorkOrder(authz.tenantId, id, to, authz.userId);
      return NextResponse.json({ data: updated });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
