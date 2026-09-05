import { NextResponse } from "next/server";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { syncClientsFromClickUp } from "@/src/lib/server/projects-service";

/**
 * Pull the full client roster from ClickUp into SEOOS as SEO projects.
 * Admin-only: only a caller with tenant-wide visibility ("all") may sync every
 * client at once. Each specialist then sees just their assigned accounts.
 */
export async function POST(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.project.manage");
    if (authz.clientVisibility !== "all") {
      return NextResponse.json(
        { error: "Only an admin can sync all clients.", code: "admin_required" },
        { status: 403 },
      );
    }
    const result = await syncClientsFromClickUp(authz.tenantId);
    return NextResponse.json({ data: result });
  } catch (e) {
    if (e instanceof AuthzError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sync failed" },
      { status: 400 },
    );
  }
}
