import { NextResponse } from "next/server";

import { getServerEnv } from "@/src/lib/server/env";
import { verifyCronSecret } from "@/src/lib/server/ai-visibility/access";
import { appOrigin, processInBackground } from "@/src/lib/server/ai-visibility/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Queue worker (CRON_SECRET bearer only). Responds immediately and processes
 * in `after()`, chaining another invocation if work remains. Users never call
 * this directly.
 */
export async function POST(request: Request) {
  if (!verifyCronSecret(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const hop = Number(request.headers.get("x-aiv-hop") ?? 0) || 0;
  processInBackground(appOrigin(request), getServerEnv().pilotTenantId, hop);
  return NextResponse.json({ accepted: true, hop }, { status: 202 });
}
