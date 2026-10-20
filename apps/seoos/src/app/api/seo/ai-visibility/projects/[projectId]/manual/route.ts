import { NextResponse } from "next/server";

import { createManualObservation, ManualInput } from "@/src/lib/server/ai-visibility/manual-service";
import { AIV_PERMS, jsonBody, requireProfile, withProject } from "@/src/lib/server/ai-visibility/route-helpers";

type P = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, { params }: P) {
  return withProject(request, params, AIV_PERMS.manage, async (ctx) => {
    const profile = await requireProfile(ctx);
    const input = ManualInput.parse(await jsonBody(request));
    const obs = await createManualObservation(profile, input, ctx.actor);
    return NextResponse.json({ data: { id: obs.id } }, { status: 201 });
  });
}
