import Link from "next/link";

import { isSeoosRequestsEnabled } from "@/src/lib/flags";
import { DEMO_TENANT } from "@/src/lib/server/context";
import { listRequests } from "@/src/lib/server/seo-engine";
import { RequestForm } from "@/src/components/request-form";

// In-memory store lives per server process; always render fresh.
export const dynamic = "force-dynamic";

export default function RequestsPage() {
  if (!isSeoosRequestsEnabled()) {
    return (
      <main className="wrap">
        <h1>Requests</h1>
        <div className="panel">
          <span className="badge">SEOOS requests disabled</span>
        </div>
      </main>
    );
  }

  const requests = listRequests(DEMO_TENANT);

  return (
    <main className="wrap">
      <p>
        <Link href="/">← SEOOS</Link>
      </p>
      <h1>SEO Intelligence Requests</h1>
      <p className="muted">
        Tenant <code>{DEMO_TENANT}</code> · auth is stubbed for this slice.
      </p>

      <RequestForm />

      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Recent requests</h2>
        {requests.length === 0 ? (
          <p className="muted">No requests yet. Submit one above.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)" }}>
                <th>Client</th>
                <th>Capability</th>
                <th>Status</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td>{r.clientId}</td>
                  <td>{r.capability}</td>
                  <td>
                    <span className="badge">{r.status}</span>
                  </td>
                  <td className="muted">{r.createdAt}</td>
                  <td>
                    <Link href={`/requests/${r.id}`}>view</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
