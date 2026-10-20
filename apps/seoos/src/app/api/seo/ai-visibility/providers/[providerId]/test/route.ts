import { NextResponse } from "next/server";
import { requirePermission } from "@cie/core";

import { ProviderId } from "@/src/lib/ai-visibility/types";
import { AIV_PERMS, apiError, requireAuthz } from "@/src/lib/server/ai-visibility/access";
import { testProvider } from "@/src/lib/server/ai-visibility/settings-service";

export const dynamic = "force-dynamic";

/** Test connection (metadata call — spends no tokens where the provider allows). */
export async function POST(request: Request, { params }: { params: Promise<{ providerId: string }> }) {
  try {
    const authz = await requireAuthz(request);
    requirePermission(authz.permissions, AIV_PERMS.providers);
    const providerId = ProviderId.parse((await params).providerId);
    return NextResponse.json({ data: await testProvider(authz.tenantId, providerId, authz.userId) });
  } catch (e) {
    return apiError(e);
  }
}
