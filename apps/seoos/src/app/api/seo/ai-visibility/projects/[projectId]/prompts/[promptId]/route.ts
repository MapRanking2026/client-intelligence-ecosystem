import { NextResponse } from "next/server";
import { z } from "zod";

import { editPrompt, PromptValidationError } from "@/src/lib/server/ai-visibility/prompt-service";
import { AIV_PERMS, jsonBody, requireProfile, withProject } from "@/src/lib/server/ai-visibility/route-helpers";

type P = { params: Promise<{ projectId: string; promptId: string }> };
const Body = z.object({
  text: z.string().min(5).max(600).optional(),
  changeNote: z.string().max(300).optional(),
  status: z.enum(["draft", "approved", "archived"]).optional(),
  locationId: z.string().optional(),
  serviceId: z.string().optional(),
});

export async function PATCH(request: Request, { params }: P) {
  const { promptId } = await params;
  return withProject(request, params, AIV_PERMS.manage, async (ctx) => {
    const profile = await requireProfile(ctx);
    const patch = Body.parse(await jsonBody(request));
    try {
      return NextResponse.json({ data: await editPrompt(profile, promptId, patch, ctx.actor) });
    } catch (e) {
      if (e instanceof PromptValidationError) return NextResponse.json({ error: "Prompt rejected", problems: e.problems }, { status: 422 });
      throw e;
    }
  });
}
