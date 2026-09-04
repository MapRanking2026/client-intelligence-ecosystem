import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthzError, requireClientAccess, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { getProject } from "@/src/lib/server/projects-service";
import { importKeywords } from "@/src/lib/server/keywords-service";

const ImportBody = z.object({
  projectId: z.string().min(1),
  phrases: z.array(z.string()).min(1).max(2000),
});

export async function POST(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.project.manage");
    const { projectId, phrases } = ImportBody.parse(await request.json());
    const project = await getProject(authz.tenantId, projectId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    requireClientAccess(authz.clientVisibility, project.clientId);
    const result = await importKeywords(authz.tenantId, projectId, project.clientId, phrases);
    return NextResponse.json({ data: { created: result.created, skipped: result.skipped } }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthzError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Import failed" },
      { status: 400 },
    );
  }
}
