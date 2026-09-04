import type { ReactNode } from "react";
import type { AuthzContextV1, PermissionScope } from "@cie/contracts";

import { AppShell, type Breadcrumb } from "@/src/components/app-shell";
import { BlockedExternal, PhaseNote } from "@/src/components/states";

/**
 * Consistent scaffold for a foundation module whose deep workflows are being
 * built out. Enforces the module's read permission and renders an honest status
 * (phase note + external blockers) instead of a fake "working" card.
 */
export function ModuleScaffold({
  authz,
  title,
  subtitle,
  breadcrumbs,
  requiredPermission,
  phase,
  purpose,
  blocked,
  children,
}: {
  authz: AuthzContextV1;
  title: string;
  subtitle?: string;
  breadcrumbs?: Breadcrumb[];
  requiredPermission?: PermissionScope;
  phase: string;
  purpose: string;
  blocked?: { provider: string; requirement: string }[];
  children?: ReactNode;
}) {
  const permitted =
    !requiredPermission || authz.permissions.includes(requiredPermission);

  return (
    <AppShell authz={authz} title={title} subtitle={subtitle} breadcrumbs={breadcrumbs}>
      {!permitted ? (
        <div className="state state--blocked">
          <span className="badge badge--warn">Permission required</span>
          <p className="muted">
            You need the {requiredPermission} permission to use this module.
          </p>
        </div>
      ) : (
        <>
          <PhaseNote phase={phase} purpose={purpose} />
          {children}
          {blocked?.map((b) => (
            <BlockedExternal key={b.provider} provider={b.provider} requirement={b.requirement} />
          ))}
        </>
      )}
    </AppShell>
  );
}
