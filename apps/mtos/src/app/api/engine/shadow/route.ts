import { NextResponse } from "next/server";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getLatestMtosEngineShadow, runMtosEngineShadow } from "@/src/lib/server/engine/shadow-compare";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Allow a tenant_admin session, or a valid CRON_SECRET bearer (for automation). */
function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/** Read the latest MTOS↔Engine shadow report (observational; changes nothing). */
export async function GET(request: Request) {
  const context = await resolveTenantContext(request);
  if (context.role !== "tenant_admin" && !cronAuthorized(request)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const report = await getLatestMtosEngineShadow(context.tenantId);
  return NextResponse.json({ tenantId: context.tenantId, data: report });
}

/**
 * Run the shadow comparison: read MTOS clients + the Client Intelligence Engine's canonical
 * clients, record how they line up, store the report. READ-ONLY on both sides;
 * does not touch any live read path or what users see.
 */
export async function POST(request: Request) {
  const context = await resolveTenantContext(request);
  if (context.role !== "tenant_admin" && !cronAuthorized(request)) {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  try {
    const report = await runMtosEngineShadow(context.tenantId);
    return NextResponse.json({ tenantId: context.tenantId, data: report });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "shadow_failed" },
      { status: 500 },
    );
  }
}
