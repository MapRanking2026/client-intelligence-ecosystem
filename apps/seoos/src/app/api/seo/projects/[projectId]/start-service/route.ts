import { NextResponse } from "next/server";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { getProject } from "@/src/lib/server/projects-service";
import { getServiceOffering } from "@/src/lib/domain/service-offering";
import { createWorkOrder } from "@/src/lib/server/workorders-service";

/** Start a service offering for a project: creates an internal work order. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.project.manage");
    const { projectId } = await params;
    const body = (await request.json().catch(() => null)) as { offeringId?: string } | null;
    const offering = body?.offeringId ? getServiceOffering(body.offeringId) : undefined;
    if (!offering) return NextResponse.json({ error: "Unknown service offering" }, { status: 400 });

    const project = await getProject(authz.tenantId, projectId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const workOrder = await createWorkOrder(
      authz.tenantId,
      {
        projectId,
        clientId: project.clientId,
        type: offering.workOrderType,
        title: `${offering.name} ($${offering.priceUsd})`,
        scope: offering.description,
        priority: "normal",
        requiresApproval: true,
      },
      authz.userId,
    );
    return NextResponse.json({ data: { workOrderId: workOrder.id } });
  } catch (e) {
    if (e instanceof AuthzError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
