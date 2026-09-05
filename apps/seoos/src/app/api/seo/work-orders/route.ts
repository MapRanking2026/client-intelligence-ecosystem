import { NextResponse } from "next/server";
import { AuthzError, canAccessClient, requireClientAccess, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { CreateWorkOrderInput } from "@/src/lib/domain/work-order";
import { getProject } from "@/src/lib/server/projects-service";
import { createWorkOrder, listWorkOrders } from "@/src/lib/server/workorders-service";

function fail(e: unknown) {
  if (e instanceof AuthzError) return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
  return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
}

export async function GET(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.package.read");
    const projectId = new URL(request.url).searchParams.get("projectId") ?? undefined;
    if (projectId) {
      const project = await getProject(authz.tenantId, projectId);
      if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
      requireClientAccess(authz.clientVisibility, project.clientId);
    }
    const all = await listWorkOrders(authz.tenantId, projectId);
    // Enforce client visibility on the result set.
    const visible = all.filter((w) => canAccessClient(authz.clientVisibility, w.clientId));
    return NextResponse.json({ data: visible });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.project.manage");
    const input = CreateWorkOrderInput.parse(await request.json());
    requireClientAccess(authz.clientVisibility, input.clientId);
    const wo = await createWorkOrder(authz.tenantId, input, authz.userId);
    return NextResponse.json({ data: wo }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
