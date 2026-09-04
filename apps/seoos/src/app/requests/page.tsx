import Link from "next/link";

import { isSeoosRequestsEnabled } from "@/src/lib/flags";
import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, Panel, StatusPill, UnauthorizedPage } from "@/src/components/states";
import { RequestForm } from "@/src/components/request-form";
import { listRequests } from "@/src/lib/server/seo-engine";

export const dynamic = "force-dynamic";

const INBOX_ORDER = [
  "needs_input",
  "submitted",
  "queued",
  "processing",
  "qa_review",
  "ready",
  "delivered",
  "failed",
  "cancelled",
  "draft",
];

export default async function RequestInboxPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  if (!isSeoosRequestsEnabled()) {
    return (
      <AppShell authz={authz} title="Request Inbox" breadcrumbs={[{ label: "SEOOS" }, { label: "Requests" }]}>
        <div className="state state--blocked">
          <span className="badge badge--warn">Requests disabled</span>
        </div>
      </AppShell>
    );
  }

  const requests = await listRequests(authz.tenantId);
  const sorted = [...requests].sort(
    (a, b) => INBOX_ORDER.indexOf(a.status) - INBOX_ORDER.indexOf(b.status),
  );

  return (
    <AppShell
      authz={authz}
      title="Request Inbox"
      subtitle="SEO Intelligence requests from MTOS and SEOOS"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Requests" }]}
    >
      <RequestForm />

      <Panel title={`Requests (${requests.length})`}>
        {requests.length === 0 ? (
          <EmptyState title="No requests yet" message="Submit one above, or wait for an MTOS request." />
        ) : (
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Capability</th>
                  <th>Audience</th>
                  <th>Source</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.id}>
                    <td>{r.clientId}</td>
                    <td>{r.capability}</td>
                    <td className="muted">{r.intendedAudience}</td>
                    <td className="muted">{r.requestedByApp}</td>
                    <td>{r.priority}</td>
                    <td><StatusPill status={r.status} /></td>
                    <td className="muted">{r.createdAt.slice(0, 10)}</td>
                    <td><Link href={`/requests/${r.id}`}>view</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </AppShell>
  );
}
