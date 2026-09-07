import { NextResponse } from "next/server";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { getIntegrationCredentials } from "@/src/lib/server/integrations-service";
import { fetchClickUpClientRoster } from "@/src/lib/server/sync/clickup-clients";
import { getClientBrain, rosterToInputs } from "@/src/lib/server/brain/client-brain";
import { nowIso } from "@/src/lib/ids";

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
 * Ingest the ClickUp SEO Dashboard roster into the Client Brain and reconcile it
 * into canonical clients. Read-only against ClickUp; writes only to the brain's
 * own store. Admin only. (MTOS's Health Tracker joins as a second source in a
 * later phase — the engine already merges multiple sources.)
 */
export async function POST(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "settings.manage");

    const creds = await getIntegrationCredentials(authz.tenantId, "clickup");
    if (!creds?.apiToken) {
      return NextResponse.json(
        { error: "ClickUp credentials are missing. Reconnect ClickUp under Integrations." },
        { status: 400 },
      );
    }
    const rosterListId =
      creds.dashboardListId ||
      process.env.CLICKUP_SEO_DASHBOARD_LIST_ID ||
      creds.listId ||
      creds.healthTrackerListId;

    const roster = await fetchClickUpClientRoster({
      token: creds.apiToken,
      listId: rosterListId,
      teamId: creds.teamId,
    });
    if (!roster.ok) {
      return NextResponse.json({ error: roster.error ?? "clickup_roster_failed" }, { status: 400 });
    }

    const report = await getClientBrain().ingestAndReconcile(
      authz.tenantId,
      rosterToInputs(roster.clients),
      { now: nowIso() },
    );
    return NextResponse.json({ data: { report } });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
