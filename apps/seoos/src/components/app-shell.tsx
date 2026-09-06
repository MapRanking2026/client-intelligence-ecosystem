import type { ReactNode } from "react";
import type { AuthzContextV1 } from "@cie/contracts";

import { NAV } from "@/src/lib/nav";
import { getServerEnv } from "@/src/lib/server/env";
import { Sidebar } from "@/src/components/sidebar";
import { ThemeToggle } from "@/src/components/theme-toggle";
import { AnnotationsToggle } from "@/src/components/annotations-toggle";
import { Annotator } from "@/src/components/annotator";
import { GlobalSearch } from "@/src/components/global-search";

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
export function AppShell({
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
  // Show the person's name with each word capitalized (e.g. "francisco" → "Francisco").
  const displayName = authz.userId
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

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
          </div>
        </header>
        <main className="content">{children}</main>
        <Annotator />
      </div>
    </div>
  );
}
