import { NextResponse } from "next/server";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { assignProjectSpecialist } from "@/src/lib/server/projects-service";

/** Admin: assign/clear a client's SEO specialist (overrides pod). Admin only. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.project.manage");
    if (authz.clientVisibility !== "all") {
      return NextResponse.json({ error: "Admin only", code: "admin_required" }, { status: 403 });
    }
    const { projectId } = await params;
    const body = (await request.json().catch(() => null)) as { specialistId?: string | null } | null;
    const project = await assignProjectSpecialist(
      authz.tenantId,
      projectId,
      body?.specialistId ? body.specialistId : null,
    );
    return NextResponse.json({ data: { id: project.id, assignedSpecialistId: project.assignedSpecialistId ?? null } });
  } catch (e) {
    if (e instanceof AuthzError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
