import type { ReactNode } from "react";
import type { AuthzContextV1 } from "@cie/contracts";

import { NAV } from "@/src/lib/nav";
import { Sidebar } from "@/src/components/sidebar";

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
          <div className="topbar-right">
            {actions}
            <span className="user-badge" title={authz.userId}>
              <span className="role-pill">{role}</span>
              <span className="user-id">{authz.userId}</span>
            </span>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
