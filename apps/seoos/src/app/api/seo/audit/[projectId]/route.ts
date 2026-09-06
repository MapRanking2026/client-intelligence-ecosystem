import { NextResponse } from "next/server";
import { AuthzError, canAccessClient, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { getProject } from "@/src/lib/server/projects-service";
import { auditUrl } from "@/src/lib/server/sync/onpage-audit";
import { fetchGscForClient } from "@/src/lib/server/sync/gsc-adapter";
import { listIntegrations } from "@/src/lib/server/integrations-service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Native on-page audit + live Search Console data for a client. */
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
    const gscConnected = (await listIntegrations(authz.tenantId)).some(
      (i) => i.id === "google-search-console" && i.status === "connected",
    );
    const [onpage, gsc] = await Promise.all([
      auditUrl(project.website ?? ""),
      gscConnected ? fetchGscForClient(authz.tenantId, project.website) : Promise.resolve(null),
    ]);
    return NextResponse.json({ data: { onpage, gsc, gscConnected } });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
