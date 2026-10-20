import { NextResponse } from "next/server";
import { z } from "zod";

import { EntityOverride } from "@/src/lib/ai-visibility/types";
import { AivHttpError } from "@/src/lib/server/ai-visibility/access";
import { applyCorrection } from "@/src/lib/server/ai-visibility/analysis-service";
import { listAudit } from "@/src/lib/server/ai-visibility/audit";
import { attempts, observations } from "@/src/lib/server/ai-visibility/store";
import { AIV_PERMS, jsonBody, withProject } from "@/src/lib/server/ai-visibility/route-helpers";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ projectId: string; obsId: string }> };

export async function GET(request: Request, { params }: P) {
  const { obsId } = await params;
  return withProject(request, params, AIV_PERMS.read, async ({ authz, project }) => {
    const obs = await observations().get(authz.tenantId, obsId);
    if (!obs || obs.projectId !== project.id || obs.isFixture) throw new AivHttpError(404, "Observation not found");
    const atts = obs.jobId ? await attempts().listWhere(authz.tenantId, "jobId", obs.jobId) : [];
    const corrections = (await listAudit(authz.tenantId, project.id, 500)).filter((a) => a.action === "observation.correct" && a.target === obsId);
    return NextResponse.json({ data: obs, attempts: atts, corrections });
  });
}

const Body = z.object({ override: EntityOverride, reason: z.string().min(3).max(500) });

export async function POST(request: Request, { params }: P) {
  const { obsId } = await params;
  return withProject(request, params, AIV_PERMS.manage, async ({ authz, project, actor }) => {
    const { override, reason } = Body.parse(await jsonBody(request));
    const obs = await applyCorrection(authz.tenantId, project.id, obsId, override, reason, actor);
    return NextResponse.json({ data: obs });
  });
}
