import { AppShell } from "@/src/components/app-shell";
import { UnauthorizedPage } from "@/src/components/states";
import { ProviderSettings } from "@/src/components/ai-visibility/provider-settings";
import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { getAgencySettings, listProviderStatus } from "@/src/lib/server/ai-visibility/settings-service";

export const dynamic = "force-dynamic";

export default async function AivSettingsPage() {
  const authz = await resolveSeoAuthz();
  if (!authz || !authz.permissions.includes("seo.package.read")) return <UnauthorizedPage />;
  const [rows, agency] = await Promise.all([listProviderStatus(authz.tenantId), getAgencySettings(authz.tenantId)]);
  const canManage = authz.permissions.includes("integrations.manage");
  return (
    <AppShell authz={authz} title="AI Visibility — Providers & caps" subtitle="Credentials stay server-side; only their presence is shown" breadcrumbs={[{ label: "SEOOS" }, { label: "AI Visibility" }, { label: "Providers" }]}>
      {!canManage ? <p className="muted">You can view provider status. Changing settings requires the integrations permission.</p> : null}
      <ProviderSettings rows={rows} canManage={canManage} agencyCap={agency.monthlyAgencyCapUsd} />
    </AppShell>
  );
}
