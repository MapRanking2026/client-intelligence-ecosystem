import { NextResponse } from "next/server";
import { AuthzError, requireClientAccess, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { CreateKeywordInput } from "@/src/lib/domain/keyword";
import { getProject } from "@/src/lib/server/projects-service";
import { createKeyword, listKeywords } from "@/src/lib/server/keywords-service";

function fail(e: unknown) {
  if (e instanceof AuthzError) {
    return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
  }
  return NextResponse.json(
    { error: e instanceof Error ? e.message : "Keyword request failed" },
    { status: 400 },
  );
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
    return NextResponse.json({ data: await listKeywords(authz.tenantId, projectId) });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.project.manage");
    const input = CreateKeywordInput.parse(await request.json());
    requireClientAccess(authz.clientVisibility, input.clientId);
    const result = await createKeyword(authz.tenantId, input);
    return NextResponse.json(result, { status: result.deduped ? 200 : 201 });
  } catch (e) {
    return fail(e);
  }
}
