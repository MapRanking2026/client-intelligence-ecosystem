import { NextResponse } from "next/server";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { addNicheStudy, listNicheStudies } from "@/src/lib/server/niche-studies-service";

export async function GET(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.package.read");
    return NextResponse.json({ data: await listNicheStudies(authz.tenantId) });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Failed" }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.project.manage");
    const body = (await request.json().catch(() => null)) as { niche?: string; title?: string; content?: string } | null;
    if (!body?.title?.trim() || !body?.content?.trim()) {
      return NextResponse.json({ error: "Title and content are required." }, { status: 400 });
    }
    const study = await addNicheStudy(authz.tenantId, { niche: body.niche, title: body.title, content: body.content });
    return NextResponse.json({ data: study }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
