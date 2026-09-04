import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { ModuleScaffold } from "@/src/components/module-scaffold";
import { UnauthorizedPage } from "@/src/components/states";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  return (
    <ModuleScaffold
      authz={authz}
      title="Integrations & Data Health"
      subtitle="Connection/mapping health via the shared MTOS integration gateway"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Integrations" }]}
      requiredPermission="integrations.manage"
      phase="Phase 2"
      purpose="Per-client/provider connection state, last sync, next run, errors, retries, and mappings — consuming the EXISTING encrypted MTOS connections through a shared server package / authenticated gateway. No duplicate connections, no plaintext tokens, no forced reconnect."
      blocked={[{ provider: "integration gateway", requirement: "the shared server package / signed service-to-service gateway to the MTOS integration/token store" }]}
    />
  );
}
