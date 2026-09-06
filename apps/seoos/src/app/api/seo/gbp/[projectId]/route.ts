import { NextResponse } from "next/server";
import { AuthzError, canAccessClient, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { getProject } from "@/src/lib/server/projects-service";
import { fetchGbpForClient } from "@/src/lib/server/sync/gbp-adapter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Live Google Business Profile data for a client. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.package.read");
    const { projectId } = await params;
    const project = await getProject(authz.tenantId, projectId);
    if (!project || !canAccessClient(authz.clientVisibility, project.clientId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const data = await fetchGbpForClient(authz.tenantId, project.businessName);
    return NextResponse.json({ data });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
