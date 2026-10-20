import { NextResponse } from "next/server";
import { z } from "zod";

import { setProfileStatus } from "@/src/lib/server/ai-visibility/profile-service";
import { AIV_PERMS, jsonBody, withProject } from "@/src/lib/server/ai-visibility/route-helpers";

type P = { params: Promise<{ projectId: string }> };
const Body = z.object({ status: z.enum(["active", "paused", "draft"]) });

export async function POST(request: Request, { params }: P) {
  return withProject(request, params, AIV_PERMS.manage, async ({ authz, project, actor }) => {
    const { status } = Body.parse(await jsonBody(request));
    const profile = await setProfileStatus(authz.tenantId, project.id, status, actor);
    return NextResponse.json({ data: profile });
  });
}
