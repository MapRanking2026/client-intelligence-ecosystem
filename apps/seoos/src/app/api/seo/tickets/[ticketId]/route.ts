import { NextResponse } from "next/server";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import {
  decideTicket,
  draftTicket,
  getTicketForViewer,
} from "@/src/lib/server/tickets-service";

/** One ticket, scoped to the viewer. */
export async function GET(request: Request, { params }: { params: Promise<{ ticketId: string }> }) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.package.read");
    const { ticketId } = await params;
    const ticket = await getTicketForViewer(authz, ticketId);
    if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ data: ticket });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Failed" }, { status: 400 });
  }
}

/**
 * Act on a ticket. Body: { action: "draft" | "approve" | "reject" | "needs_info" | "save",
 * note?, draft? }. Drafting stages the deliverable in SEOOS; decisions record the
 * specialist's call — nothing is ever written to ClickUp or pushed live here.
 */
export async function POST(request: Request, { params }: { params: Promise<{ ticketId: string }> }) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.package.read");
    const { ticketId } = await params;
    // The viewer must be allowed to see this ticket before acting on it.
    const ticket = await getTicketForViewer(authz, ticketId);
    if (!ticket) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = (await request.json().catch(() => null)) as
      | { action?: string; note?: string; draft?: string }
      | null;
    const action = body?.action ?? "";

    if (action === "draft") {
      const res = await draftTicket(authz.tenantId, ticketId);
      if (!res.ok) return NextResponse.json({ error: res.error ?? "draft_failed" }, { status: 400 });
      return NextResponse.json({ data: await getTicketForViewer(authz, ticketId) });
    }

    if (["approve", "reject", "needs_info", "save"].includes(action)) {
      const res = await decideTicket(
        authz.tenantId,
        ticketId,
        { action: action as "approve" | "reject" | "needs_info" | "save", note: body?.note, draft: body?.draft },
        authz.userId,
      );
      if (!res.ok) return NextResponse.json({ error: res.error ?? "failed" }, { status: 400 });
      return NextResponse.json({ data: await getTicketForViewer(authz, ticketId) });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Failed" }, { status: 400 });
  }
}
