import { NextResponse } from "next/server";
import { AuthzError, canAccessClient, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { getProject } from "@/src/lib/server/projects-service";
import { getPreparedTaskRepo } from "@/src/lib/server/repositories/prepared-task-repo";
import { syncTaskPlan } from "@/src/lib/server/task-engine-service";

/** List a client's prepared tasks. */
export async function GET(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.package.read");
    const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
    const project = await getProject(authz.tenantId, projectId);
    if (!project || !canAccessClient(authz.clientVisibility, project.clientId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const tasks = await getPreparedTaskRepo().listByProject(authz.tenantId, projectId);
    return NextResponse.json({ data: tasks });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Failed" }, { status: 400 });
  }
}

/** Refresh one client's plan (idempotent; continues from current state). */
export async function POST(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.project.manage");
    const body = (await request.json().catch(() => null)) as { projectId?: string } | null;
    const project = body?.projectId ? await getProject(authz.tenantId, body.projectId) : null;
    if (!project || !canAccessClient(authz.clientVisibility, project.clientId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const result = await syncTaskPlan(authz.tenantId, body!.projectId!);
    return NextResponse.json({ data: result });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
