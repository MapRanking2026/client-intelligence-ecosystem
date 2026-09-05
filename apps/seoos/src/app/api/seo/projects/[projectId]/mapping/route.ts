import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthzError, requireClientAccess, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { getProject, updateProjectExternalIds } from "@/src/lib/server/projects-service";

const Body = z.object({
  externalIds: z.record(z.string(), z.string()),
});

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
    const { externalIds } = Body.parse(await request.json());
    const updated = await updateProjectExternalIds(authz.tenantId, projectId, externalIds);
    return NextResponse.json({ data: { externalIds: updated.externalIds } });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
