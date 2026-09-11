import { NextResponse } from "next/server";
import type { AuthzContextV1 } from "@cie/contracts";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { seedSpecialistStyles } from "@/src/lib/server/specialist-style-seed-service";

function adminGuard(authz: AuthzContextV1) {
  requirePermission(authz.permissions, "seo.project.manage");
  if (authz.clientVisibility !== "all") throw new AuthzError("forbidden_permission", "Admin only");
}

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Admin: learn each specialist's writing style from their own ClickUp comments
 * and seed their style profile. Only seeds empty profiles unless `force` is set,
 * so learned corrections are never overwritten.
 */
export async function POST(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    adminGuard(authz);
    const body = (await request.json().catch(() => ({}))) as {
      force?: boolean;
      specialistId?: string;
    };
    const result = await seedSpecialistStyles(authz.tenantId, {
      onlyEmpty: !body?.force,
      specialistId: typeof body?.specialistId === "string" ? body.specialistId : undefined,
    });
    return NextResponse.json({ data: result });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
