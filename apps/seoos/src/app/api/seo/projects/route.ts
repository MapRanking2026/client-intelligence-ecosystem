import { NextResponse } from "next/server";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { CreateSeoProjectInput } from "@/src/lib/domain/project";
import {
  createProject,
  DuplicateProjectError,
  listProjects,
} from "@/src/lib/server/projects-service";

export async function GET(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.project.manage");
    return NextResponse.json({ data: await listProjects(authz.tenantId) });
  } catch (e) {
    if (e instanceof AuthzError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    }
    throw e;
  }
}

export async function POST(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.project.manage");
    const input = CreateSeoProjectInput.parse(await request.json());
    const project = await createProject(authz.tenantId, input);
    return NextResponse.json({ data: project }, { status: 201 });
  } catch (e) {
    if (e instanceof AuthzError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    }
    if (e instanceof DuplicateProjectError) {
      return NextResponse.json({ error: e.message, code: "duplicate_project" }, { status: 409 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to create project" },
      { status: 400 },
    );
  }
}
