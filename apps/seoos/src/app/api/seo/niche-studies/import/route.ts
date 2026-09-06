import { NextResponse } from "next/server";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { importFromDrive } from "@/src/lib/server/niche-studies-service";
import { getServerEnv } from "@/src/lib/server/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Import niche studies from a Google Drive folder. Admin action. */
export async function POST(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.project.manage");
    const body = (await request.json().catch(() => null)) as { folderId?: string } | null;
    const folderId = (body?.folderId || getServerEnv().driveNicheFolderId || "").trim();
    if (!folderId) return NextResponse.json({ error: "A Drive folder ID is required." }, { status: 400 });
    const result = await importFromDrive(authz.tenantId, folderId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ data: result });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
