import { NextResponse } from "next/server";
import type { AuthzContextV1 } from "@cie/contracts";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { syncAllTaskPlans } from "@/src/lib/server/task-engine-service";

function adminGuard(authz: AuthzContextV1) {
  requirePermission(authz.permissions, "seo.project.manage");
  if (authz.clientVisibility !== "all") throw new AuthzError("forbidden_permission", "Admin only");
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Admin: bring EVERY client's task plan up to date so none is missed. */
export async function POST(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    adminGuard(authz);
    const result = await syncAllTaskPlans(authz.tenantId);
    return NextResponse.json({ data: result });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
