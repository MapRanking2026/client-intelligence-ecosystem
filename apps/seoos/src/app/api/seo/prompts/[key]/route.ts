import { NextResponse } from "next/server";
import type { AuthzContextV1 } from "@cie/contracts";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { resetPrompt, upsertPrompt } from "@/src/lib/server/prompts-service";

function adminGuard(authz: AuthzContextV1) {
  requirePermission(authz.permissions, "seo.project.manage");
  if (authz.clientVisibility !== "all") throw new AuthzError("forbidden_permission", "Admin only");
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    adminGuard(authz);
    const { key } = await params;
    const body = (await request.json().catch(() => null)) as { template?: string } | null;
    if (!body?.template?.trim()) return NextResponse.json({ error: "Template is required." }, { status: 400 });
    const saved = await upsertPrompt(authz.tenantId, key, body.template, authz.userId);
    return NextResponse.json({ data: { key: saved.key, updatedAt: saved.updatedAt } });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    adminGuard(authz);
    const { key } = await params;
    await resetPrompt(authz.tenantId, key);
    return NextResponse.json({ data: { ok: true } });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Failed" }, { status: 400 });
  }
}
