import { NextResponse } from "next/server";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { generateGbpAuditForViewer } from "@/src/lib/server/gbp-audit-service";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Generate a GBP audit DRAFT for a client (staged in SEOOS; nothing written to Google). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.project.manage");
    const { projectId } = await params;
    const result = await generateGbpAuditForViewer(authz, projectId);
    if (!result.ok) return NextResponse.json({ error: result.error ?? "Failed" }, { status: 400 });
    return NextResponse.json({ data: result });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
