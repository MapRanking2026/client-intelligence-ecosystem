import { NextResponse } from "next/server";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { generateAiRecommendations } from "@/src/lib/server/ai/recommendations-ai";

/** Generate AI recommendations for a project (proposed; a human still approves). */
export async function POST(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.project.manage");
    const body = (await request.json().catch(() => null)) as { projectId?: string } | null;
    if (!body?.projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    const result = await generateAiRecommendations(authz.tenantId, body.projectId);
    return NextResponse.json({ data: result });
  } catch (e) {
    if (e instanceof AuthzError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
