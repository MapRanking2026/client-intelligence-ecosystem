import { NextResponse } from "next/server";
import { AuthzError, requireClientAccess, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { CreateRecommendationInput } from "@/src/lib/domain/recommendation";
import { getProject } from "@/src/lib/server/projects-service";
import { createRecommendation, listRecommendations } from "@/src/lib/server/recommendations-service";

function fail(e: unknown) {
  if (e instanceof AuthzError) return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
  return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
}

export async function GET(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.package.read");
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
    const project = await getProject(authz.tenantId, projectId);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    requireClientAccess(authz.clientVisibility, project.clientId);
    return NextResponse.json({ data: await listRecommendations(authz.tenantId, projectId) });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.project.manage");
    const input = CreateRecommendationInput.parse(await request.json());
    requireClientAccess(authz.clientVisibility, input.clientId);
    const rec = await createRecommendation(authz.tenantId, input);
    return NextResponse.json({ data: rec }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
