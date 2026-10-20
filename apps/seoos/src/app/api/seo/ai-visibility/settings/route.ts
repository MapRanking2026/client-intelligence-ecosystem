import { NextResponse } from "next/server";
import { requirePermission } from "@cie/core";
import { z } from "zod";

import { AIV_PERMS, apiError, requireAuthz } from "@/src/lib/server/ai-visibility/access";
import { jsonBody } from "@/src/lib/server/ai-visibility/route-helpers";
import { saveAgencySettings } from "@/src/lib/server/ai-visibility/settings-service";

const Body = z.object({ monthlyAgencyCapUsd: z.number().min(0).max(100000) });

export async function PUT(request: Request) {
  try {
    const authz = await requireAuthz(request);
    requirePermission(authz.permissions, AIV_PERMS.providers);
    const { monthlyAgencyCapUsd } = Body.parse(await jsonBody(request));
    return NextResponse.json({ data: await saveAgencySettings(authz.tenantId, monthlyAgencyCapUsd, authz.userId) });
  } catch (e) {
    return apiError(e);
  }
}
