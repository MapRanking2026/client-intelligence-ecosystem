import { NextResponse } from "next/server";
import { requirePermission } from "@cie/core";
import { z } from "zod";

import { ProviderId } from "@/src/lib/ai-visibility/types";
import { AIV_PERMS, apiError, requireAuthz } from "@/src/lib/server/ai-visibility/access";
import { jsonBody } from "@/src/lib/server/ai-visibility/route-helpers";
import { getAgencySettings, listProviderStatus, saveProviderSettings } from "@/src/lib/server/ai-visibility/settings-service";

export const dynamic = "force-dynamic";

/** Provider connection status. Never returns credentials — only whether they are set. */
export async function GET(request: Request) {
  try {
    const authz = await requireAuthz(request);
    requirePermission(authz.permissions, AIV_PERMS.read);
    return NextResponse.json({ data: await listProviderStatus(authz.tenantId), agency: await getAgencySettings(authz.tenantId) });
  } catch (e) {
    return apiError(e);
  }
}

const Body = z.object({
  providerId: ProviderId,
  patch: z
    .object({
      enabled: z.boolean(),
      model: z.string().min(1).max(100).regex(/^[A-Za-z0-9._:-]+$/),
      maxSearchUses: z.number().int().min(1).max(10),
      maxOutputTokens: z.number().int().min(256).max(8000),
      timeoutMs: z.number().int().min(5000).max(240000),
      requestsPerMinute: z.number().int().min(1).max(600),
      maxConcurrency: z.number().int().min(1).max(10),
    })
    .partial(),
});

export async function PUT(request: Request) {
  try {
    const authz = await requireAuthz(request);
    requirePermission(authz.permissions, AIV_PERMS.providers);
    const { providerId, patch } = Body.parse(await jsonBody(request));
    return NextResponse.json({ data: await saveProviderSettings(authz.tenantId, providerId, patch, authz.userId) });
  } catch (e) {
    return apiError(e);
  }
}
