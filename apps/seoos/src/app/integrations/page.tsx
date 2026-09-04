import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { BlockedExternal, EmptyState, Panel, StatusPill, UnauthorizedPage } from "@/src/components/states";
import { getIntegrationHealth } from "@/src/lib/server/gateway/client";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;

  if (!authzHas(authz, "integrations.manage")) {
    return (
      <AppShell authz={authz} title="Integrations & Data Health" breadcrumbs={[{ label: "SEOOS" }, { label: "Integrations" }]}>
        <div className="state state--blocked">
          <span className="badge badge--warn">Permission required</span>
          <p className="muted">You need integrations.manage to view integration health.</p>
        </div>
      </AppShell>
    );
  }

  const health = await getIntegrationHealth(authz.tenantId);

  return (
    <AppShell
      authz={authz}
      title="Integrations & Data Health"
      subtitle="Shared MTOS connections, consumed through the signed integration gateway"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Integrations" }]}
    >
      <p className="muted" style={{ marginTop: 0 }}>
        SEOOS never stores provider credentials. Connection state is read from the
        existing MTOS token store over a signed service-to-service request; no
        tokens or raw URLs reach this app or the browser.
      </p>

      {!health.configured ? (
        <BlockedExternal
          provider="Integration gateway"
          requirement="MTOS_GATEWAY_URL + CIE_SERVICE_SECRET set for the SEOOS project (same secret on MTOS)"
        />
      ) : !health.ok ? (
        <div className="state state--blocked">
          <span className="badge badge--warn">Gateway error</span>
          <p className="muted">The gateway responded with: {health.error ?? "unknown error"}.</p>
        </div>
      ) : health.providers.length === 0 ? (
        <EmptyState title="No providers reported" message="The gateway returned no provider health for this tenant." />
      ) : (
        <Panel title={`Providers (${health.providers.length})`}>
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Category</th>
                  <th>Ownership</th>
                  <th>Status</th>
                  <th>Last sync</th>
                  <th>Token expires</th>
                </tr>
              </thead>
              <tbody>
                {health.providers.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className="muted">{p.category}</td>
                    <td className="muted">{p.isShared ? "shared" : "per-user"}</td>
                    <td><StatusPill status={p.status} /></td>
                    <td className="muted">{p.lastSyncAt ? p.lastSyncAt.slice(0, 10) : "—"}</td>
                    <td className="muted">{p.tokenExpiresAt ? p.tokenExpiresAt.slice(0, 10) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </AppShell>
  );
}
