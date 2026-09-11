import type { ReactNode } from "react";
import type { AuthzContextV1 } from "@cie/contracts";

import { NAV } from "@/src/lib/nav";
import { getServerEnv } from "@/src/lib/server/env";
import { Sidebar } from "@/src/components/sidebar";
import { ThemeToggle } from "@/src/components/theme-toggle";
import { AnnotationsToggle } from "@/src/components/annotations-toggle";
import { Annotator } from "@/src/components/annotator";
import { GlobalSearch } from "@/src/components/global-search";
import { LogoutButton } from "@/src/components/logout-button";
import { ImpersonationBanner } from "@/src/components/impersonation-banner";
import { getUserRepo } from "@/src/lib/server/repositories/user-repo";
import { listSpecialists } from "@/src/lib/server/specialists-service";
import { isOutboundLocked } from "@/src/lib/server/egress-policy";

export interface Breadcrumb {
  label: string;
  href?: string;
}

interface AppShellProps {
  authz: AuthzContextV1;
  title: string;
  subtitle?: string;
  breadcrumbs?: Breadcrumb[];
  actions?: ReactNode;
  children: ReactNode;
}

/** Authenticated application chrome: sidebar + topbar + content region. */
export async function AppShell({
  authz,
  title,
  subtitle,
  breadcrumbs,
  actions,
  children,
}: AppShellProps) {
  const visible = NAV.filter(
    (item) => !item.permission || authz.permissions.includes(item.permission),
  );
  const role = authz.roles[0] ?? "member";
  // Friendly role: admins → "Admin", everyone else → "SEO Specialist".
  const roleLabel = /admin|owner/i.test(role) ? "Admin" : "SEO Specialist";

  const titleCase = (s: string) =>
    s.split(/[\s._-]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

  // When the super-admin is impersonating, authz.userId is "imp__<specialistId>".
  const impersonatingId = authz.userId.startsWith("imp__") ? authz.userId.slice(5) : null;
  let displayName: string;
  let impersonatingName: string | null = null;
  let mustReset = false;
  if (impersonatingId) {
    const specialists = await listSpecialists(authz.tenantId);
    impersonatingName = specialists.find((s) => s.id === impersonatingId)?.name ?? impersonatingId;
    displayName = impersonatingName;
  } else {
    const user = await getUserRepo().getById(authz.tenantId, authz.userId);
    mustReset = user?.mustResetPassword === true;
    displayName = user?.displayName || titleCase(authz.userId);
  }

  return (
    <div className="app-grid">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">SEOOS</span>
          <span className="brand-sub">SEO Operations</span>
        </div>
        <Sidebar items={visible} />
      </aside>
      <div className="main">
        <header className="topbar">
          <div>
            {breadcrumbs && breadcrumbs.length > 0 ? (
              <div className="crumbs">
                {breadcrumbs.map((c, i) => (
                  <span key={`${c.label}-${i}`}>
                    {c.label}
                    {i < breadcrumbs.length - 1 ? (
                      <span className="crumb-sep"> / </span>
                    ) : null}
                  </span>
                ))}
              </div>
            ) : null}
            <h1 className="page-title">{title}</h1>
            {subtitle ? <p className="page-sub muted">{subtitle}</p> : null}
          </div>
          <div className="topbar-center">
            <GlobalSearch />
          </div>
          <div className="topbar-right">
            {actions}
            <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{getServerEnv().tenantDisplayName}</span>
            <AnnotationsToggle />
            <ThemeToggle />
            <span className="user-badge" title={authz.userId}>
              <span className="role-pill">{roleLabel}</span>
              <span className="user-id">{displayName}</span>
            </span>
            <LogoutButton />
          </div>
        </header>
        <main className="content">
          {isOutboundLocked() ? (
            <div className="egress-banner">
              🔒 <strong>Read-only mode</strong> — outbound is locked. Data still syncs in; nothing is sent
              or changed in any external system (ClickUp, email, MTOS) until you lift it.
            </div>
          ) : null}
          {impersonatingName ? <ImpersonationBanner name={impersonatingName} /> : null}
          {mustReset ? (
            <div className="reset-banner">
              You must set a new password. <a href="/set-password">Set it now →</a>
            </div>
          ) : null}
          {children}
        </main>
        <Annotator />
      </div>
    </div>
  );
}
