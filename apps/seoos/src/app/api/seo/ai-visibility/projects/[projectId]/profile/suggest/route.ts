import { NextResponse } from "next/server";
import { z } from "zod";

import { suggestFromWebsite } from "@/src/lib/server/ai-visibility/profile-service";
import { AIV_PERMS, jsonBody, withProject } from "@/src/lib/server/ai-visibility/route-helpers";

export const maxDuration = 30;
type P = { params: Promise<{ projectId: string }> };
const Body = z.object({ url: z.string().min(4).max(500) });

/** Read the client's public website and add SUGGESTIONS (never auto-approved). */
export async function POST(request: Request, { params }: P) {
  return withProject(request, params, AIV_PERMS.manage, async ({ authz, project, actor }) => {
    const { url } = Body.parse(await jsonBody(request));
    const { profile, suggestions } = await suggestFromWebsite(authz.tenantId, project.id, url, actor);
    return NextResponse.json({ data: profile, suggestions });
  });
}
