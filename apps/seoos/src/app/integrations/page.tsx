import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { UnauthorizedPage } from "@/src/components/states";
import { IntegrationCard } from "@/src/components/integration-card";
import { GatewayDiagnostics } from "@/src/components/gateway-diagnostics";
import { listIntegrations } from "@/src/lib/server/integrations-service";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;

  if (!authzHas(authz, "integrations.manage")) {
    return (
      <AppShell authz={authz} title="Integrations & Data Health" breadcrumbs={[{ label: "SEOOS" }, { label: "Integrations" }]}>
        <div className="state state--blocked">
          <span className="badge badge--warn">Permission required</span>
          <p className="muted">You need integrations.manage to view integrations.</p>
        </div>
      </AppShell>
    );
  }

  const integrations = await listIntegrations(authz.tenantId);
  const connectedCount = integrations.filter((i) => i.status === "connected").length;

  return (
    <AppShell
      authz={authz}
      title="Integrations & Data Health"
      subtitle="SEOOS-native connections · credentials are encrypted at rest, never shown"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Integrations" }]}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Connect each source directly with its API credentials. {connectedCount} of{" "}
        {integrations.length} connected. Credentials are AES-encrypted at rest and
        never returned to the browser. After connecting, use <strong>Sync all sources</strong>{" "}
        on a client/project to pull data. SEO-performance (rankings/grids/check-ins)
        can also be relayed from MTOS via the gateway when configured.
      </p>

      <GatewayDiagnostics />

      <div className="grid-cards" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
        {integrations.map((view) => (
          <IntegrationCard key={view.id} view={view} />
        ))}
      </div>
    </AppShell>
  );
}
