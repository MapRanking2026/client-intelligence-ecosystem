import Link from "next/link";
import { AlertTriangle, Check, CircleSlash, Plug } from "lucide-react";

import {
  permissionsNeedingAttention,
  permissionSummary,
  type PermissionStatus,
  type PermissionView,
} from "@/src/lib/contracts/integration-permissions";

/**
 * What MTOS is allowed to do on the AM's behalf, read from the scopes their connections hold.
 *
 * Written in capabilities rather than scopes, because an AM deciding whether to reconnect needs to
 * know what they get, not which string Google wants. Each row says what it is for and, when it is
 * missing, what MTOS does instead -- so a missing permission reads as a known limit rather than
 * something broken.
 *
 * A server component: it only renders what the page already read, and there is nothing to click
 * except the link to the provider, which is the existing Integrations surface.
 */

const LOOK: Record<PermissionStatus, { chip: string; icon: typeof Check; label: string }> = {
  granted: { chip: "good", icon: Check, label: "Granted" },
  needs_reconsent: { chip: "watch", icon: AlertTriangle, label: "Reconnect to grant" },
  not_connected: { chip: "muted", icon: Plug, label: "Not connected" },
  not_requested: { chip: "muted", icon: CircleSlash, label: "Not asked for yet" },
};

export function IntegrationPermissions({ permissions }: { permissions: PermissionView[] }) {
  const attention = permissionsNeedingAttention(permissions);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="muted text-[0.83rem]">{permissionSummary(permissions)}</span>
        {attention.length ? (
          <span className="chip watch">
            <AlertTriangle />
            {attention.length} need{attention.length === 1 ? "s" : ""} attention
          </span>
        ) : (
          <span className="chip good">
            <Check />
            Nothing waiting on you
          </span>
        )}
      </div>

      <ul className="grid gap-2">
        {permissions.map((permission) => {
          const look = LOOK[permission.status];
          const Icon = look.icon;
          return (
            <li key={permission.id} className="list-row items-start">
              <span className={`chip ${look.chip}`} style={{ flexShrink: 0 }}>
                <Icon />
                {look.label}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.86rem] font-semibold" style={{ color: "var(--text)" }}>
                  {permission.label}
                </span>
                <span className="muted block text-[0.8rem] leading-6">{permission.purpose}</span>
                <span className="block text-[0.8rem] leading-6" style={{ color: "var(--text-2)" }}>
                  {permission.detail}
                </span>
                <span className="muted block text-[0.76rem]">Used by {permission.usedBy}.</span>
              </span>
            </li>
          );
        })}
      </ul>

      <p className="muted text-[0.78rem]">
        Granting is done on the provider&rsquo;s own consent screen — MTOS reads what your connection
        holds and never changes it. <Link href="#integration-providers" className="ilink">Reconnect a provider below.</Link>
      </p>
    </div>
  );
}
