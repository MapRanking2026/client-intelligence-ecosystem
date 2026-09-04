import { AppShell } from "@/src/components/mtos/app-shell";
import { SectionCard } from "@/src/components/mtos/section-card";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { listIntegrationViews } from "@/src/lib/server/integrations";

import { IntegrationsClient } from "./integrations-client";

interface IntegrationsPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function IntegrationsPage({ searchParams }: IntegrationsPageProps) {
  const context = await resolveTenantContext();
  const resolvedSearchParams = (await searchParams) || {};
  const integrations = await listIntegrationViews(context);
  const flashStatus = typeof resolvedSearchParams.status === "string" ? resolvedSearchParams.status : null;
  const flashMessage = typeof resolvedSearchParams.message === "string" ? resolvedSearchParams.message : null;
  const flashProvider = typeof resolvedSearchParams.provider === "string" ? resolvedSearchParams.provider : null;

  return (
    <AppShell
      title="Integrations"
      subtitle="Connect every external system MTOS depends on through one governed surface, with OAuth where it exists, API credentials where it does not, and timed token rotation for providers that need endpoint-issued renewals."
    >
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
