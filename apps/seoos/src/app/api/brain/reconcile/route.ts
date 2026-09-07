import { NextResponse } from "next/server";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { getClientBrain, ingestClickUpIntoBrain } from "@/src/lib/server/brain/client-brain";

export const maxDuration = 300;

/** The latest reconciliation report + canonical client count. Admin only. */
export async function GET(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "settings.manage");
    const brain = getClientBrain();
    const [clients, report] = await Promise.all([
      brain.listClients(authz.tenantId),
      brain.getLatestReport(authz.tenantId),
    ]);
    return NextResponse.json({ data: { canonicalClients: clients.length, report } });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Failed" }, { status: 400 });
  }
}

/**
 * Ingest the ClickUp client lists (SEO Dashboard + MTOS's Client Health Tracker)
 * into the Client Brain and reconcile them into canonical clients. Read-only
 * against ClickUp; writes only to the brain's own store. Admin only.
 */
export async function POST(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "settings.manage");
    const result = await ingestClickUpIntoBrain(authz.tenantId);
    if (!result.ok) return NextResponse.json({ error: result.error ?? "ingest_failed" }, { status: 400 });
    return NextResponse.json({ data: { report: result.report } });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
