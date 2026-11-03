import { NextResponse } from "next/server";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { normalizePreferences } from "@/src/lib/contracts/user-preferences";
import {
  getAccountManagerPreferences,
  resetAccountManagerPreferences,
  saveAccountManagerPreferences,
} from "@/src/lib/server/services/user-service";

/**
 * One user's own preferences.
 *
 * Nothing here is tenant-wide and nothing here touches another user: `resolveTenantContext` fixes
 * whose document is read and written, so there is no user id in the request to get wrong.
 *
 * The body is normalized before it reaches the service, which normalizes it again. That is not
 * belt and braces for its own sake -- this route is the only place an arbitrary object reaches the
 * preference document, and a value the Settings screen could never have produced should stop here.
 */
export async function GET(request: Request) {
  const context = await resolveTenantContext(request);
  return NextResponse.json({ data: await getAccountManagerPreferences(context) });
}

export async function PUT(request: Request) {
  const context = await resolveTenantContext(request);
  const body = await request.json().catch(() => ({}));
  const patch = normalizePreferences(body);

  try {
    return NextResponse.json({ data: await saveAccountManagerPreferences(context, patch) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Your preferences were not saved." },
      { status: 500 },
    );
  }
}

/** Reset to defaults. Writes an empty preference object; nothing else on the document is touched. */
export async function DELETE(request: Request) {
  const context = await resolveTenantContext(request);
  try {
    return NextResponse.json({ data: await resetAccountManagerPreferences(context) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Your preferences were not reset." },
      { status: 500 },
    );
  }
}
