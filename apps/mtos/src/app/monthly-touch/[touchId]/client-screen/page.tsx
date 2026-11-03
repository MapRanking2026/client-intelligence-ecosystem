import { notFound } from "next/navigation";

import { ClientScreen } from "@/src/components/mtos/client-screen";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { visibleSlides } from "@/src/lib/contracts/live-call";
import { getMonthlyTouchWorkspaceView } from "@/src/lib/server/services/monthly-touch-service";

/**
 * Rendered per request, never prerendered.
 *
 * This page reads one tenant's data behind a session cookie, so a build-time copy of it would
 * be the wrong tenant's page for everyone -- and the build would have to reach Firestore to
 * make it, which is what failed the deploys of 2026-11-02 when the daily read quota ran out.
 * Next cannot infer this on its own here: the session read calls `cookies()` inside a
 * try/catch and skips it entirely when the cookie secret is absent, so on a build without
 * that secret nothing marks the route dynamic and it is prerendered.
 */
export const dynamic = "force-dynamic";

/**
 * The client-facing window for a live call: the deck, and nothing else.
 *
 * Deliberately outside the app shell. The account manager shares this window in Google Meet, so
 * the navigation, the client roster and every other screen in MTOS would be on the client's
 * screen with it. It renders one thing.
 *
 * It is still an authenticated route behind the same tenant resolution as the rest of the app --
 * it is the AM's own window, opened from their own session, not a link anybody can hold. What
 * reaches the browser is the slides and the deck's cover details, which is what the client is
 * about to be shown anyway; the declined sections are filtered out here, on the server, so a
 * section the AM declined is not sitting in the page waiting for a stray message to reveal it.
 */
export default async function ClientScreenPage({ params }: { params: Promise<{ touchId: string }> }) {
  const { touchId } = await params;
  const context = await resolveTenantContext();

  const payload = await getMonthlyTouchWorkspaceView(context, touchId).catch(() => undefined);
  if (!payload) notFound();

  const { touch } = payload;
  const slides = visibleSlides(touch.presentation?.slides, touch.review?.declinedSections);

  return (
    <ClientScreen
      touchId={touch.id}
      {...(touch.presentation ? { presentation: touch.presentation } : {})}
      slides={slides}
    />
  );
}
