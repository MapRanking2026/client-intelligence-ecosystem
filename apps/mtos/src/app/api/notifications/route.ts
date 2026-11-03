import { NextResponse } from "next/server";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import {
  listNotifications,
  markNotificationsRead,
} from "@/src/lib/server/services/notification-service";

/**
 * The AM's own notification feed, for the bell in the header.
 *
 * Read-only on GET. The POST marks rows read, which is the only thing the browser is allowed to
 * change about a notification -- the title, the link and the reason are written by the run that
 * raised it, and a client that could rewrite those could rewrite what the AM is told.
 */
export async function GET(request: Request) {
  const context = await resolveTenantContext(request);
  const items = await listNotifications(context);
  return NextResponse.json({ data: { items } });
}

export async function POST(request: Request) {
  const context = await resolveTenantContext(request);
  const body = (await request.json().catch(() => ({}))) as { read?: unknown };
  const ids = Array.isArray(body.read)
    ? body.read.filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];

  if (!ids.length) {
    return NextResponse.json({ error: "Nothing to mark read." }, { status: 400 });
  }

  const marked = await markNotificationsRead(context, ids);
  return NextResponse.json({ data: { marked } });
}
