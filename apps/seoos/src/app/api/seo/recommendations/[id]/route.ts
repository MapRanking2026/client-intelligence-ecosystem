import { NextResponse } from "next/server";
import { AuthzError, requireClientAccess, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import type { RecommendationStatus } from "@/src/lib/domain/recommendation";
import {
  convertToWorkOrder,
  decideRecommendation,
  getRecommendation,
} from "@/src/lib/server/recommendations-service";

const ACTION_TO_STATUS: Record<string, RecommendationStatus> = {
  approve: "approved",
  reject: "rejected",
  defer: "deferred",
  repropose: "proposed",
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    const rec = await getRecommendation(authz.tenantId, id);
    if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });
    requireClientAccess(authz.clientVisibility, rec.clientId);

    const body = await request.json();
    const action = String(body?.action ?? "");

    if (action === "convert") {
      // Converting to work order is a human-gated action.
      requirePermission(authz.permissions, "seo.work.approve");
      const result = await convertToWorkOrder(authz.tenantId, id, authz.userId);
      return NextResponse.json({ data: result });
    }

    const to = ACTION_TO_STATUS[action];
    if (!to) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    requirePermission(authz.permissions, "seo.project.manage");
    const updated = await decideRecommendation(
      authz.tenantId,
      id,
      to,
      authz.userId,
      typeof body?.reason === "string" ? body.reason : undefined,
    );
    return NextResponse.json({ data: updated });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
