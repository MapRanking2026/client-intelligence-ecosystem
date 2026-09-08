import { NextResponse } from "next/server";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { getClientEngine, ingestClickUpIntoEngine } from "@/src/lib/server/engine/client-engine";
import { getEngineProjectId } from "@/src/lib/server/firebase/engine-admin";

export const maxDuration = 300;

/** The latest reconciliation report + canonical client count. Admin only. */
export async function GET(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "settings.manage");
    const engine = getClientEngine();
    const [clients, report] = await Promise.all([
      engine.listClients(authz.tenantId),
      engine.getLatestReport(authz.tenantId),
    ]);
    // projectId + tenantId let us confirm SEOOS writes where MTOS reads.
    return NextResponse.json({
      data: {
        tenantId: authz.tenantId,
        engineProjectId: getEngineProjectId(),
        canonicalClients: clients.length,
        report,
      },
    });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Failed" }, { status: 400 });
  }
}

/**
 * Ingest the ClickUp client lists (SEO Dashboard + MTOS's Client Health Tracker)
 * into the Client Intelligence Engine and reconcile them into canonical clients.
 * Read-only against ClickUp; writes only to the engine's own store. Admin only.
 */
export async function POST(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "settings.manage");
    const result = await ingestClickUpIntoEngine(authz.tenantId);
    if (!result.ok) return NextResponse.json({ error: result.error ?? "ingest_failed" }, { status: 400 });
    return NextResponse.json({ data: { report: result.report } });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
