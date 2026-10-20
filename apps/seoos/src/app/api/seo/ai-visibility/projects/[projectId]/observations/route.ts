import { NextResponse } from "next/server";

import { filterObservations, parseViewFilter } from "@/src/lib/ai-visibility/filters";
import { computeMetrics } from "@/src/lib/ai-visibility/metrics";
import { liveObservations } from "@/src/lib/server/ai-visibility/data-service";
import { AIV_PERMS, withProject } from "@/src/lib/server/ai-visibility/route-helpers";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ projectId: string }> };

export async function GET(request: Request, { params }: P) {
  return withProject(request, params, AIV_PERMS.read, async ({ authz, project }) => {
    const f = parseViewFilter(new URL(request.url).searchParams);
    const all = await liveObservations(authz.tenantId, project.id);
    const rows = filterObservations(all, f);
    const { flag: _flag, ...mf } = f;
    void _flag;
    return NextResponse.json({
      filter: f,
      metrics: computeMetrics(all, mf),
      data: rows.map(({ rawResponse: _raw, ...rest }) => {
        void _raw;
        return rest;
      }),
    });
  });
}
