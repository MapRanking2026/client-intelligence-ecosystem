import { NextResponse } from "next/server";
import { AuthzError, requireClientAccess, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { getProject } from "@/src/lib/server/projects-service";
import { populateProjectFromMtos } from "@/src/lib/server/populate-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.project.manage");
    const { projectId } = await params;
    const project = await getProject(authz.tenantId, projectId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    requireClientAccess(authz.clientVisibility, project.clientId);
    const result = await populateProjectFromMtos(authz.tenantId, projectId);
    return NextResponse.json({ data: result });
  } catch (e) {
    if (e instanceof AuthzError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Populate failed" },
      { status: 400 },
    );
  }
}
