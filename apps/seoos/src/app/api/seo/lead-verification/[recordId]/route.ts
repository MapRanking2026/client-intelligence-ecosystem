import { NextResponse } from "next/server";
import { LeadCallVerificationChangeV1 } from "@cie/contracts";
import { AuthzError, requireClientAccess, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { nowIso } from "@/src/lib/ids";
import { getLeadCallRepo } from "@/src/lib/server/repositories/lead-call-repo";

/**
 * Apply an authorized verification/classification change to the CANONICAL
 * lead/call record. Writes an audit entry (actor, app, prev→new, reason, time)
 * that is visible to MTOS reading the same record. Same validation rules as MTOS.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ recordId: string }> },
) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "lead_call.verify");
    const { recordId } = await params;
    const repo = getLeadCallRepo();
    const existing = await repo.get(authz.tenantId, recordId);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    requireClientAccess(authz.clientVisibility, existing.clientId);

    const body = await request.json();
    const change = LeadCallVerificationChangeV1.parse({
      recordId,
      app: "seoos",
      actorUserId: authz.userId,
      verificationStatus: body?.verificationStatus,
      classification: body?.classification,
      reason: body?.reason,
    });
    const updated = await repo.applyVerificationChange(authz.tenantId, change, nowIso());
    return NextResponse.json({ data: updated });
  } catch (e) {
    if (e instanceof AuthzError) {
      const status = e.code === "forbidden_client" ? 403 : 403;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to verify" },
      { status: 400 },
    );
  }
}
