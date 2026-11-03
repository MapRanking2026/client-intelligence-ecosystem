import { AppShell } from "@/src/components/mtos/app-shell";
import { SectionCard } from "@/src/components/mtos/section-card";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getAccountManagerPreferences } from "@/src/lib/server/services/user-service";

import { PreferencesClient } from "./preferences-client";

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

export default async function PreferencesPage() {
  const context = await resolveTenantContext();
  const preferences = await getAccountManagerPreferences(context);

  return (
    <AppShell
      title="My profile & preferences"
      subtitle="Saved against your account rather than this browser, so the way you work follows you to another computer. Every preference has a default, and the hint under each one says where it takes effect."
    >
      <SectionCard
        eyebrow="Your account"
        title="Preferences"
        subtitle="Your name and clock, the workspace you arrive in, and what MTOS prepares for a Monthly Touch."
      >
        <PreferencesClient initial={preferences} />
      </SectionCard>
    </AppShell>
  );
}
