import { NextResponse } from "next/server";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { listAssignableMembers } from "@/src/lib/server/services/post-meeting-service";

/**
 * The ClickUp members who can be assigned follow-up tickets, for the assignee
 * dropdown on the post-meeting screen. Returns an empty list with a `reason`
 * (rather than an error) when ClickUp isn't configured, so the UI degrades to
 * "leave unassigned" gracefully.
 */
export async function GET(request: Request) {
  const context = await resolveTenantContext(request);

  try {
    const result = await listAssignableMembers(context);
    return NextResponse.json({ context, data: result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load ClickUp members" },
      { status: 400 },
    );
  }
}
