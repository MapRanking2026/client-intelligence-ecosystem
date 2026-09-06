import Link from "next/link";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { Panel, StatCard, UnauthorizedPage } from "@/src/components/states";
import { getServerEnv, hasFirebaseAdminConfig, hasAiConfig, hasGoogleOAuth } from "@/src/lib/server/env";
import { listSpecialists } from "@/src/lib/server/specialists-service";
import { listProjectsForViewer } from "@/src/lib/server/projects-service";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  if (!authzHas(authz, "settings.manage")) {
    return (
      <AppShell authz={authz} title="Team / Settings" breadcrumbs={[{ label: "SEOOS" }, { label: "Team / Settings" }]}>
        <div className="state state--blocked">
          <span className="badge badge--warn">Admin only</span>
          <p className="muted">You need settings.manage to view team settings.</p>
        </div>
      </AppShell>
    );
  }

  const env = getServerEnv();
  const [specialists, projects] = await Promise.all([
    listSpecialists(authz.tenantId),
    listProjectsForViewer(authz),
  ]);
  const flag = (b: boolean) => (b ? "✓ configured" : "— not set");

  return (
    <AppShell
      authz={authz}
      title="Team / Settings"
      subtitle="Team, roles, and system configuration"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Team / Settings" }]}
    >
      <Panel title="Overview">
        <div className="grid-cards">
          <StatCard label="Clients" value={projects.length} />
          <StatCard label="SEO specialists" value={specialists.length} hint="manage on Clients" />
          <StatCard label="You" value={authz.userId} hint={authz.roles.join(", ")} />
          <StatCard label="Organization" value={env.tenantDisplayName} hint={authz.tenantId} />
        </div>
      </Panel>

      <Panel title="Team">
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Add, remove, and assign SEO specialists on the <Link href="/clients">Clients</Link> page.
          New people sign up at the login screen; the admin scopes them to their clients.
        </p>
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Specialist</th><th>Login email</th></tr></thead>
            <tbody>
              {specialists.map((s) => (
                <tr key={s.id}><td>{s.name}</td><td className="muted">{s.email || "— links by name"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="System configuration">
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th>Setting</th><th>Status</th></tr></thead>
            <tbody>
              <tr><td>Firestore (persistence)</td><td>{flag(hasFirebaseAdminConfig())}</td></tr>
              <tr><td>AI recommendations (LLM key)</td><td>{flag(hasAiConfig())}</td></tr>
              <tr><td>Google OAuth (GBP + Search Console)</td><td>{flag(hasGoogleOAuth())}</td></tr>
              <tr><td>Encryption secret</td><td>{flag(Boolean(env.integrationsEncryptionSecret))}</td></tr>
              <tr><td>Session secret</td><td>{flag(Boolean(env.sessionCookieSecret))}</td></tr>
              <tr><td>SEOOS enabled</td><td>{flag(env.seoosEnabled)}</td></tr>
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          These reflect environment configuration (set in Vercel). Secrets are never shown here.
        </p>
      </Panel>
    </AppShell>
  );
}
