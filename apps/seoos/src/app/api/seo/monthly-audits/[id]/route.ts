import { NextResponse } from "next/server";
import { AuthzError, requireClientAccess, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { AuditResult, MonthlyAuditStatus } from "@/src/lib/domain/monthly-audit";
import {
  getMonthlyAudit,
  transitionMonthlyAudit,
  updateAuditItem,
} from "@/src/lib/server/monthly-audits-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    const audit = await getMonthlyAudit(authz.tenantId, id);
    if (!audit) return NextResponse.json({ error: "Not found" }, { status: 404 });
    requireClientAccess(authz.clientVisibility, audit.clientId);

    const body = await request.json();
    const action = String(body?.action ?? "");

    if (action === "update_item") {
      requirePermission(authz.permissions, "seo.project.manage");
      const key = String(body?.key ?? "");
      if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
      const patch = {
        result: body?.result ? AuditResult.parse(body.result) : undefined,
        notes: typeof body?.notes === "string" ? body.notes : undefined,
        remediation: typeof body?.remediation === "string" ? body.remediation : undefined,
      };
      const updated = await updateAuditItem(authz.tenantId, id, key, patch);
      return NextResponse.json({ data: updated });
    }

    if (action === "transition") {
      const to = MonthlyAuditStatus.parse(body?.to);
      // Advancing to QA/published is a review action; others are specialist edits.
      requirePermission(authz.permissions, to === "qa" || to === "published" ? "seo.package.qa" : "seo.project.manage");
      const updated = await transitionMonthlyAudit(authz.tenantId, id, to, authz.userId);
      return NextResponse.json({ data: updated });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
