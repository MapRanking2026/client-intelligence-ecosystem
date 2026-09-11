import { NextResponse } from "next/server";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { listProjects, syncClientsFromClickUp } from "@/src/lib/server/projects-service";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Auto-sync at most once per this window per tenant, so logins don't hammer ClickUp. */
const THROTTLE_MS = 10 * 60 * 1000;

/**
 * Auto-pool clients from ClickUp when a user opens their Clients page. Available
 * to anyone who can view clients (not just admins) and throttled using the most
 * recent ClickUp-sourced project update as a proxy for "last synced".
 */
export async function POST(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.project.manage");

    const projects = await listProjects(authz.tenantId);
    const lastSync = projects
      .filter((p) => p.externalIds?.clickupTaskId)
      .reduce((max, p) => Math.max(max, Date.parse(p.updatedAt) || 0), 0);
    if (projects.length > 0 && Date.now() - lastSync < THROTTLE_MS) {
      return NextResponse.json({ data: { synced: false, reason: "recent" } });
    }

    const result = await syncClientsFromClickUp(authz.tenantId);
    return NextResponse.json({
      data: { synced: result.ok, created: result.created, updated: result.updated, pruned: result.pruned },
    });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "auto_sync_failed" }, { status: 400 });
  }
}
