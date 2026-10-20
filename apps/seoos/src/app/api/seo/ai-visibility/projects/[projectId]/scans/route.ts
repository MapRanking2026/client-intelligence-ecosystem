import { NextResponse } from "next/server";
import { z } from "zod";

import { ProviderId } from "@/src/lib/ai-visibility/types";
import { listScans, planScan, startScan } from "@/src/lib/server/ai-visibility/scan-service";
import { appOrigin, processInBackground } from "@/src/lib/server/ai-visibility/scheduler";
import { AIV_PERMS, jsonBody, requireProfile, withProject } from "@/src/lib/server/ai-visibility/route-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
type P = { params: Promise<{ projectId: string }> };

const Body = z.object({
  action: z.enum(["plan", "start"]),
  promptIds: z.array(z.string()).max(50).optional(),
  branded: z.boolean().optional(),
  providerIds: z.array(ProviderId).max(4).optional(),
  repetitions: z.number().int().min(1).max(10).optional(),
  nearMeLocationIds: z.array(z.string()).max(20).optional(),
  /** The user confirms the estimate shown to them. */
  confirmEstimateUsd: z.number().min(0).optional(),
});

export async function GET(request: Request, { params }: P) {
  return withProject(request, params, AIV_PERMS.read, async ({ authz, project }) =>
    NextResponse.json({ data: await listScans(authz.tenantId, project.id) }),
  );
}

export async function POST(request: Request, { params }: P) {
  return withProject(request, params, AIV_PERMS.manage, async (ctx) => {
    const profile = await requireProfile(ctx);
    const body = Body.parse(await jsonBody(request));
    const { action, confirmEstimateUsd, ...input } = body;
    if (action === "plan") {
      const plan = await planScan(profile, input);
      return NextResponse.json({ data: { ...plan, slots: plan.slots.length } });
    }
    // Start: re-plan server-side; refuse if the cost moved above what the user confirmed.
    const plan = await planScan(profile, input);
    if (confirmEstimateUsd === undefined) return NextResponse.json({ error: "Confirm the estimate before starting" }, { status: 400 });
    if (plan.estimatedCostUsd > confirmEstimateUsd + 0.005) {
      return NextResponse.json({ error: "The estimate changed since you reviewed it. Review the plan again.", estimate: plan.estimatedCostUsd }, { status: 409 });
    }
    const { scan } = await startScan(profile, input, { actor: ctx.actor, trigger: "manual" });
    processInBackground(appOrigin(request), ctx.authz.tenantId);
    return NextResponse.json({ data: scan }, { status: 202 });
  });
}
