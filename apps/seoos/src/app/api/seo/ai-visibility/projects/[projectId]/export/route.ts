import { filterObservations, observationsCsv, parseViewFilter } from "@/src/lib/ai-visibility/filters";
import { audit } from "@/src/lib/server/ai-visibility/audit";
import { liveObservations } from "@/src/lib/server/ai-visibility/data-service";
import { AIV_PERMS, requireProfile, withProject } from "@/src/lib/server/ai-visibility/route-helpers";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ projectId: string }> };

/** CSV of exactly the observations matching the dashboard filters in the query string. */
export async function GET(request: Request, { params }: P) {
  return withProject(request, params, AIV_PERMS.read, async (ctx) => {
    const profile = await requireProfile(ctx);
    const f = parseViewFilter(new URL(request.url).searchParams);
    const rows = filterObservations(await liveObservations(ctx.authz.tenantId, ctx.project.id), f);
    await audit(ctx.authz.tenantId, ctx.actor, "export.csv", { projectId: ctx.project.id, detail: { rows: rows.length, filter: f } });
    const name = `${ctx.project.businessName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-ai-visibility-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(`﻿${observationsCsv(rows, profile)}`, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
      },
    });
  });
}
