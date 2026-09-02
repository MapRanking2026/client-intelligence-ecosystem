import { NextResponse } from "next/server";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import {
  listAssignableMembers,
  listBusinessOptions,
} from "@/src/lib/server/services/post-meeting-service";

/**
 * The ClickUp members (for the assignee dropdown) and Business Name options (for
 * the business dropdown) used on the post-meeting follow-up screen. Read-only.
 * Returns empty lists with a `reason` rather than erroring when ClickUp isn't
 * configured, so the UI degrades gracefully.
 */
export async function GET(request: Request) {
  const context = await resolveTenantContext(request);

  try {
    const [memberResult, businessResult] = await Promise.all([
      listAssignableMembers(context),
      listBusinessOptions(context),
    ]);
    return NextResponse.json({
      context,
      data: {
        members: memberResult.members,
        membersReason: memberResult.reason,
        businesses: businessResult.businesses,
        businessesReason: businessResult.reason,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load ClickUp ticket options" },
      { status: 400 },
    );
  }
}
