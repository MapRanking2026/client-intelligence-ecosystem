import { NextResponse } from "next/server";
import type { AuthzContextV1 } from "@cie/contracts";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { removeSpecialist, updateSpecialist } from "@/src/lib/server/specialists-service";

function adminGuard(authz: AuthzContextV1) {
  requirePermission(authz.permissions, "seo.project.manage");
  if (authz.clientVisibility !== "all") throw new AuthzError("forbidden_permission", "Admin only");
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    adminGuard(authz);
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as
      | { name?: string; email?: string | null; active?: boolean }
      | null;
    const specialist = await updateSpecialist(authz.tenantId, id, body ?? {});
    return NextResponse.json({ data: specialist });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    adminGuard(authz);
    const { id } = await params;
    await removeSpecialist(authz.tenantId, id);
    return NextResponse.json({ data: { ok: true } });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
