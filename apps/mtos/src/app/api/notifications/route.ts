import { NextResponse } from "next/server";

import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { toastQueue } from "@/src/lib/contracts/notification-toasts";
import {
  listNotifications,
  markNotificationsRead,
  markNotificationsToasted,
} from "@/src/lib/server/services/notification-service";

/**
 * The AM's own notification feed, for the bell in the header.
 *
 * Read-only on GET. The POST marks rows read or toasted, and those two are the only things the
 * browser is allowed to change about a notification -- the title, the link and the reason are
 * written by the run that raised it, and a client that could rewrite those could rewrite what the
 * AM is told.
 *
 * GET also returns `toast`: the notifications due a pop-up, newest first, at most three. It is
 * computed here rather than in the browser so the rule lives in one tested place, and it is part
 * of this response rather than its own endpoint so the bell's single fetch serves both -- a second
 * request for the same feed would double what the most-loaded screen in the app costs to read.
 */
export async function GET(request: Request) {
  const context = await resolveTenantContext(request);
  const items = await listNotifications(context);
  return NextResponse.json({ data: { items, toast: toastQueue(items) } });
}

export async function POST(request: Request) {
  const context = await resolveTenantContext(request);
  const body = (await request.json().catch(() => ({}))) as { read?: unknown; toasted?: unknown };
  const idsOf = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      : [];
  const read = idsOf(body.read);
  const toasted = idsOf(body.toasted);

  if (!read.length && !toasted.length) {
    return NextResponse.json({ error: "Nothing to mark." }, { status: 400 });
  }

  // Both in one request, because the toast's own button does both at once: it was shown, and
  // clicking it means the person has read it.
  const marked = read.length ? await markNotificationsRead(context, read) : 0;
  const toastMarked = toasted.length ? await markNotificationsToasted(context, toasted) : 0;
  return NextResponse.json({ data: { marked, toasted: toastMarked } });
}
