import Link from "next/link";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { Panel, StatCard, UnauthorizedPage } from "@/src/components/states";
import { getServerEnv, hasFirebaseAdminConfig, hasAiConfig, hasGoogleOAuth } from "@/src/lib/server/env";
import { listSpecialists } from "@/src/lib/server/specialists-service";
import { listProjectsForViewer } from "@/src/lib/server/projects-service";
import { SeedStylesButton } from "@/src/components/seed-styles-button";
import { getUserRepo } from "@/src/lib/server/repositories/user-repo";
import { UserAdmin } from "@/src/components/user-admin";
import { ImpersonationPanel } from "@/src/components/impersonation-panel";

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
  const [specialists, projects, users] = await Promise.all([
    listSpecialists(authz.tenantId),
    listProjectsForViewer(authz),
    getUserRepo().list(authz.tenantId),
  ]);
  const managedUsers = users.map((u) => ({
    userId: u.userId,
    email: u.email,
    displayName: u.displayName ?? "",
    isAdmin: u.clientVisibility === "all" || u.roles.includes("tenant_admin"),
    disabled: u.disabled,
    mustResetPassword: u.mustResetPassword === true,
  }));
  const isSuperAdmin = authz.userId === (process.env.SEOOS_SUPERADMIN_USER_ID || "francisco");
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
          <StatCard label="Organization" value={env.tenantDisplayName} />
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

      <Panel title="User accounts">
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Create login users, make someone an admin, or force a password reset on their next login.
          Creating a user shows a one-time temporary password they must change when they first log in.
        </p>
        <UserAdmin users={managedUsers} />
      </Panel>

      {isSuperAdmin ? (
        <Panel title="Impersonate a specialist (developer)">
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Open the app exactly as a specialist sees it, to verify their view. A banner stays visible while
            impersonating — click &ldquo;Stop impersonating&rdquo; to return to your admin account.
          </p>
          <ImpersonationPanel specialists={specialists.map((s) => ({ id: s.id, name: s.name }))} />
        </Panel>
      ) : null}

      <Panel title="Specialist writing styles">
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Learn how each specialist writes from their own ClickUp comments, so AI drafts sound like them
          from the first run. Reads ClickUp only — nothing is written back, and each person&apos;s learned
          corrections are always kept. {hasAiConfig() ? null : <strong>Set an AI key first (below).</strong>}
        </p>
        <SeedStylesButton />
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
