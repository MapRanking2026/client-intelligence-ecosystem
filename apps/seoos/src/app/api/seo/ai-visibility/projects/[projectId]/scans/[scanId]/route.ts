import { NextResponse } from "next/server";
import { z } from "zod";

import { AivHttpError } from "@/src/lib/server/ai-visibility/access";
import { cancelScan, listJobs, retryFailed } from "@/src/lib/server/ai-visibility/scan-service";
import { appOrigin, processInBackground } from "@/src/lib/server/ai-visibility/scheduler";
import { attempts, scans } from "@/src/lib/server/ai-visibility/store";
import { AIV_PERMS, jsonBody, withProject } from "@/src/lib/server/ai-visibility/route-helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
type P = { params: Promise<{ projectId: string; scanId: string }> };

async function scanFor(tenantId: string, projectId: string, scanId: string) {
  const scan = await scans().get(tenantId, scanId);
  if (!scan || scan.projectId !== projectId) throw new AivHttpError(404, "Scan not found");
  return scan;
}

export async function GET(request: Request, { params }: P) {
  const { scanId } = await params;
  return withProject(request, params, AIV_PERMS.read, async ({ authz, project }) => {
    const scan = await scanFor(authz.tenantId, project.id, scanId);
    const [js, atts] = await Promise.all([listJobs(authz.tenantId, scanId), attempts().listWhere(authz.tenantId, "scanId", scanId)]);
    return NextResponse.json({
      data: {
        scan,
        jobs: js.map((j) => ({ id: j.id, status: j.status, attempts: j.attempts, lastErrorClass: j.lastErrorClass, lastError: j.lastError, slot: j.slot, nextAttemptAt: j.nextAttemptAt })),
        attempts: atts.sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1)),
      },
    });
  });
}

const Body = z.object({ action: z.enum(["cancel", "retry_failed", "resume"]) });

export async function POST(request: Request, { params }: P) {
  const { scanId } = await params;
  return withProject(request, params, AIV_PERMS.manage, async ({ authz, project, actor }) => {
    await scanFor(authz.tenantId, project.id, scanId);
    const { action } = Body.parse(await jsonBody(request));
    if (action === "cancel") return NextResponse.json({ data: await cancelScan(authz.tenantId, scanId, actor) });
    if (action === "retry_failed") {
      const res = await retryFailed(authz.tenantId, scanId, actor);
      processInBackground(appOrigin(request), authz.tenantId);
      return NextResponse.json({ data: res }, { status: 202 });
    }
    // resume: just (re)start processing; expired leases are reclaimed automatically.
    processInBackground(appOrigin(request), authz.tenantId);
    return NextResponse.json({ data: { resumed: true } }, { status: 202 });
  });
}
