import { NextResponse } from "next/server";
import { z } from "zod";

import { PromptGroup } from "@/src/lib/ai-visibility/types";
import { createPrompt, generatePrompts, listPrompts, PromptValidationError } from "@/src/lib/server/ai-visibility/prompt-service";
import { AIV_PERMS, jsonBody, requireProfile, withProject } from "@/src/lib/server/ai-visibility/route-helpers";

type P = { params: Promise<{ projectId: string }> };

const Generate = z.object({
  action: z.literal("generate"),
  groups: z.array(PromptGroup).min(1),
  includeNearMe: z.boolean().default(false),
  maxPerGroup: z.number().int().min(1).max(30).default(10),
  locationIds: z.array(z.string()).optional(),
});
const Create = z.object({
  action: z.literal("create"),
  text: z.string().min(5).max(600),
  group: PromptGroup,
  serviceId: z.string().optional(),
  locationId: z.string().optional(),
  language: z.string().max(12).optional(),
});

export async function GET(request: Request, { params }: P) {
  return withProject(request, params, AIV_PERMS.read, async ({ authz, project }) =>
    NextResponse.json({ data: await listPrompts(authz.tenantId, project.id) }),
  );
}

export async function POST(request: Request, { params }: P) {
  return withProject(request, params, AIV_PERMS.manage, async (ctx) => {
    const profile = await requireProfile(ctx);
    const body = await jsonBody(request);
    try {
      if (body.action === "generate") {
        const g = Generate.parse(body);
        const res = await generatePrompts(profile, g, ctx.actor);
        return NextResponse.json({ data: res }, { status: 201 });
      }
      const c = Create.parse(body);
      return NextResponse.json({ data: await createPrompt(profile, c, ctx.actor) }, { status: 201 });
    } catch (e) {
      if (e instanceof PromptValidationError) return NextResponse.json({ error: "Prompt rejected", problems: e.problems }, { status: 422 });
      throw e;
    }
  });
}
