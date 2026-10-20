import { NextResponse } from "next/server";

import { activationCheck, getProfile, initProfile, ProfilePatch, updateProfile } from "@/src/lib/server/ai-visibility/profile-service";
import { AIV_PERMS, jsonBody, withProject } from "@/src/lib/server/ai-visibility/route-helpers";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, { params }: P) {
  return withProject(request, params, AIV_PERMS.read, async ({ authz, project }) => {
    const profile = await getProfile(authz.tenantId, project.id);
    return NextResponse.json({ data: profile, check: profile ? activationCheck(profile) : null });
  });
}

/** Create the draft profile (seeded from the SEOOS project / canonical client). */
export async function POST(request: Request, { params }: P) {
  return withProject(request, params, AIV_PERMS.manage, async ({ project, actor }) => {
    const profile = await initProfile(project, actor);
    return NextResponse.json({ data: profile }, { status: 201 });
  });
}

export async function PUT(request: Request, { params }: P) {
  return withProject(request, params, AIV_PERMS.manage, async ({ authz, project, actor }) => {
    const patch = ProfilePatch.parse(await jsonBody(request));
    const profile = await updateProfile(authz.tenantId, project.id, patch, actor);
    return NextResponse.json({ data: profile, check: activationCheck(profile) });
  });
}
