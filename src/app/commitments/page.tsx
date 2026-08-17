import Link from "next/link";
import { BadgeCheck } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { DataError } from "@/src/components/mtos/data-error";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import type { ClientRecord, CommitmentRecord } from "@/src/lib/mtos-data";

function statusTone(status: CommitmentRecord["status"]): "good" | "watch" | "risk" {
  if (status === "Overdue") return "risk";
  if (status === "Completed") return "good";
  return "watch";
}

export default async function CommitmentsPage() {
  const context = await resolveTenantContext();
  let clients: ClientRecord[];
  let commitments: CommitmentRecord[];
  try {
    const ds = getMtosDataSource(context);
    [clients, commitments] = await Promise.all([ds.getClients(), ds.getCommitments()]);
  } catch {
    return (
      <AppShell>
        <DataError title="Couldn't load your commitments" />
      </AppShell>
    );
  }

  const clientMap = new Map(clients.map((c) => [c.id, c.name]));
  const overdue = commitments.filter((c) => c.status === "Overdue").length;
  const inProgress = commitments.filter((c) => c.status === "Open" || c.status === "In Progress").length;
  const done = commitments.filter((c) => c.status === "Completed").length;

  const summary = [
    { label: "Overdue", value: overdue, tone: "risk" as const },
    { label: "Open / in progress", value: inProgress, tone: "watch" as const },
    { label: "Completed", value: done, tone: "good" as const },
  ];

  return (
    <AppShell>
      <div className="section-head" style={{ marginTop: 0 }}>
        <div>
          <div className="eyebrow muted">
            <BadgeCheck />
            <span>Promise tracker · nothing falls through</span>
          </div>
          <h2 className="h2 mt-2">Commitments</h2>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-4">
        {summary.map((s) => (
          <div key={s.label} className="card" style={{ padding: "16px 18px" }}>
            <div className="flex items-center justify-between">
              <span className="stat-label">{s.label}</span>
              <span className={`sig-dot ${s.tone}`} />
            </div>
            <div className="stat-val mt-3" style={{ color: `var(--${s.tone})` }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 8 }}>
        <div className="table-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Commitment</th>
                <th>Client</th>
                <th>Owner</th>
                <th>Category</th>
                <th>Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {commitments.map((c) => {
                const tone = statusTone(c.status);
                return (
                  <tr key={c.id} className="row-link">
                    <td style={{ maxWidth: 300 }}>
                      <Link href={`/clients/${c.clientId}`} style={{ color: "var(--text)", fontWeight: 500 }}>
                        {c.title}
                      </Link>
                      {c.sourceMeeting ? <div className="muted text-[0.72rem]">{c.sourceMeeting}</div> : null}
                    </td>
                    <td className="muted">{clientMap.get(c.clientId) ?? "—"}</td>
                    <td className="muted">{c.owner}</td>
                    <td className="muted">{c.category}</td>
                    <td className="muted">{c.dueDate}</td>
                    <td>
                      <span className={`chip ${tone}`}>{c.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
