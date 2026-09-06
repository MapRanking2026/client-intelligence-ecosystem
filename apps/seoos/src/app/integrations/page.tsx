import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { UnauthorizedPage } from "@/src/components/states";
import { IntegrationCard } from "@/src/components/integration-card";
import { GatewayDiagnostics } from "@/src/components/gateway-diagnostics";
import { SyncClientsButton } from "@/src/components/sync-clients-button";
import { listIntegrations } from "@/src/lib/server/integrations-service";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  const { connected, error } = await searchParams;

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
  const clickupConnected = integrations.some((i) => i.id === "clickup" && i.status === "connected");
  const isAdmin = authz.clientVisibility === "all";

  return (
    <AppShell
      authz={authz}
      title="Integrations & Data Health"
      subtitle="SEOOS-native connections · credentials are encrypted at rest, never shown"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Integrations" }]}
    >
      {connected ? (
        <div className="state" style={{ borderColor: "var(--ok, #3fb950)" }}>
          <span className="badge status-active">connected</span>
          <p className="muted" style={{ margin: 0 }}>{connected.replace(/-/g, " ")} connected via Google.</p>
        </div>
      ) : null}
      {error ? (
        <div className="state state--blocked">
          <span className="badge badge--warn">connection error</span>
          <p className="muted" style={{ margin: 0 }}>{error.replace(/_/g, " ")}</p>
        </div>
      ) : null}

      <p className="muted" style={{ marginTop: 0 }}>
        Connect each source directly with its API credentials. {connectedCount} of{" "}
        {integrations.length} connected. Credentials are AES-encrypted at rest and
        never returned to the browser. After connecting, use <strong>Sync all sources</strong>{" "}
        on a client/project to pull data. SEO-performance (rankings/grids/check-ins)
        can also be relayed from MTOS via the gateway when configured.
      </p>

      {isAdmin && clickupConnected ? (
        <div className="panel">
          <div className="panel-head">
            <h3 className="panel-title">ClickUp client sync</h3>
            <span className="badge status-active">connected</span>
          </div>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Pull the full client roster + SEO data from the SEO Dashboard list. This also runs
            automatically once a day to keep clients current.
          </p>
          <SyncClientsButton />
        </div>
      ) : null}

      <GatewayDiagnostics />

      <div className="grid-cards" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
        {integrations.map((view) => (
          <IntegrationCard key={view.id} view={view} />
        ))}
      </div>
    </AppShell>
  );
}
