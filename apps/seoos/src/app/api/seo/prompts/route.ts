import { NextResponse } from "next/server";
import type { AuthzContextV1 } from "@cie/contracts";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { listPromptCatalog } from "@/src/lib/server/prompts-service";

function adminGuard(authz: AuthzContextV1) {
  requirePermission(authz.permissions, "seo.project.manage");
  if (authz.clientVisibility !== "all") throw new AuthzError("forbidden_permission", "Admin only");
}

export async function GET(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    adminGuard(authz);
    return NextResponse.json({ data: await listPromptCatalog(authz.tenantId) });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Failed" }, { status: 400 });
  }
}
