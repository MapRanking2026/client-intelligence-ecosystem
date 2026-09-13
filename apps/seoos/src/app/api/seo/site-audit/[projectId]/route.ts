import { NextResponse } from "next/server";
import { AuthzError, canAccessClient, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { getProject } from "@/src/lib/server/projects-service";
import { getSiteAudit } from "@/src/lib/server/site-audit-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Multi-page site crawl + cross-page pattern recognition for a client.
 * Read-only (inbound fetches of the client's own public pages). On-demand:
 * a crawl can take tens of seconds, so it runs when the specialist asks, not
 * on every page render.
 */
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
    const audit = await getSiteAudit(authz, project);
    return NextResponse.json({ data: audit });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
