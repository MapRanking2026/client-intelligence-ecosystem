import { NextResponse } from "next/server";

import { reanalyzeProject } from "@/src/lib/server/ai-visibility/analysis-service";
import { AIV_PERMS, requireProfile, withProject } from "@/src/lib/server/ai-visibility/route-helpers";

type P = { params: Promise<{ projectId: string }> };

/** Re-run deterministic extraction over stored answers (collected data unchanged). */
export async function POST(request: Request, { params }: P) {
  return withProject(request, params, AIV_PERMS.manage, async (ctx) => {
    const profile = await requireProfile(ctx);
    return NextResponse.json({ data: await reanalyzeProject(profile, ctx.actor) });
  });
}
