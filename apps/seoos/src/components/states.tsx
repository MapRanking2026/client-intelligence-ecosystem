import type { ReactNode } from "react";
import Link from "next/link";

/** Standard empty state for a list/section with no data yet. */
export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="state state--empty">
      <div className="state-title">{title}</div>
      <p className="muted">{message}</p>
      {action}
    </div>
  );
}

/** A capability blocked only by an unavailable external credential/source. */
export function BlockedExternal({
  provider,
  requirement,
}: {
  provider: string;
  requirement: string;
}) {
  return (
    <div className="state state--blocked">
      <div className="state-title">
        <span className="badge badge--warn">Blocked · external</span> {provider}
      </div>
      <p className="muted">
        Internal domain model, adapter boundary, and UI states are in place. Live
        data requires: {requirement}.
      </p>
    </div>
  );
}

/** Honest status marker for a foundation module still being deepened. */
export function PhaseNote({ phase, purpose }: { phase: string; purpose: string }) {
  return (
    <div className="phase-note">
      <span className="badge">{phase}</span>
      <span className="muted"> {purpose}</span>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {hint ? <div className="stat-hint muted">{hint}</div> : null}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`badge status-${status}`}>{status.replace(/_/g, " ")}</span>;
}

export function Panel({
  title,
  children,
  actions,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="panel">
      {title || actions ? (
        <div className="panel-head">
          {title ? <h2 className="panel-title">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Full-page unauthorized state (rendered without the app chrome). */
export function UnauthorizedPage() {
  return (
    <main className="wrap">
      <div className="panel">
        <span className="badge badge--warn">No SEOOS access</span>
        <h1>Access required</h1>
        <p className="muted">
          Your account is signed in to the tenant but has no SEOOS membership.
          SEOOS access is granted explicitly and is never implicit. Ask a tenant
          administrator to add a SEOOS membership for your user.
        </p>
        <p>
          <Link href="/sign-in">Return to sign-in</Link>
        </p>
      </div>
    </main>
  );
}
