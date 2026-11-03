import { AppShell } from "@/src/components/mtos/app-shell";
import { SectionCard } from "@/src/components/mtos/section-card";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { listIntegrationViews } from "@/src/lib/server/integrations";
import { listPermissions } from "@/src/lib/server/services/integration-permissions-service";
import { IntegrationPermissions } from "@/src/components/mtos/integration-permissions";

import { IntegrationsClient } from "./integrations-client";

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

interface IntegrationsPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function IntegrationsPage({ searchParams }: IntegrationsPageProps) {
  const context = await resolveTenantContext();
  const resolvedSearchParams = (await searchParams) || {};
  const [integrations, permissions] = await Promise.all([
    listIntegrationViews(context),
    listPermissions(context),
  ]);
  const flashStatus = typeof resolvedSearchParams.status === "string" ? resolvedSearchParams.status : null;
  const flashMessage = typeof resolvedSearchParams.message === "string" ? resolvedSearchParams.message : null;
  const flashProvider = typeof resolvedSearchParams.provider === "string" ? resolvedSearchParams.provider : null;

  return (
    <AppShell
      title="Integrations"
      subtitle="Connect every external system MTOS depends on through one governed surface, with OAuth where it exists, API credentials where it does not, and timed token rotation for providers that need endpoint-issued renewals."
    >
      <SectionCard
        eyebrow="What MTOS may do for you"
        title="Permissions"
        subtitle="Read from the scopes your own connections hold, so this page and the follow-through can never disagree about what is allowed. Where a permission is missing, the row says what MTOS does instead."
      >
        <IntegrationPermissions permissions={permissions} />
      </SectionCard>

      <div id="integration-providers" className="mt-4" />

      <SectionCard
        eyebrow="Integration fabric"
        title="Connection management"
        subtitle="This page is live-backed. OAuth providers can launch consent flows, API integrations store server-side credentials, and rotating-token integrations keep an endpoint plus refresh window on file so MTOS can renew access without forcing a full reconnect."
      >
        <IntegrationsClient
          initialIntegrations={integrations}
          initialFlashMessage={flashMessage}
          initialFlashProvider={flashProvider}
          initialFlashStatus={flashStatus}
        />
      </SectionCard>
    </AppShell>
  );
}
