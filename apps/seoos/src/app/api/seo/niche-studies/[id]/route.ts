import { NextResponse } from "next/server";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { removeNicheStudy } from "@/src/lib/server/niche-studies-service";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.project.manage");
    const { id } = await params;
    await removeNicheStudy(authz.tenantId, id);
    return NextResponse.json({ data: { ok: true } });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Failed" }, { status: 400 });
  }
}
