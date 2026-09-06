import { NextResponse } from "next/server";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { listTicketsForViewer, syncTickets } from "@/src/lib/server/tickets-service";

export const maxDuration = 300;

/** List the tickets the viewer may see (admins → all; specialist → their own). */
export async function GET(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.package.read");
    return NextResponse.json({ data: await listTicketsForViewer(authz) });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Failed" }, { status: 400 });
  }
}

/** Sync tickets from ClickUp (read-only) and auto-draft new ones. Admin only. */
export async function POST(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.project.manage");
    const result = await syncTickets(authz.tenantId, { autoDraft: true });
    if (!result.ok) return NextResponse.json({ error: result.error ?? "sync_failed" }, { status: 400 });
    return NextResponse.json({ data: result });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Failed" }, { status: 400 });
  }
}
