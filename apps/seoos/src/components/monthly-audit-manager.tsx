"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  MONTHLY_AUDIT_TRANSITIONS,
  type AuditResult,
  type MonthlyAuditStatus,
  type MonthlyAuditV1,
} from "@/src/lib/domain/monthly-audit";

const RESULTS: AuditResult[] = [
  "pending",
  "pass",
  "warning",
  "fail",
  "not_applicable",
  "data_unavailable",
];

function thisMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function MonthlyAuditManager({
  projectId,
  audit,
  canManage,
  canQa,
}: {
  projectId: string;
  audit: MonthlyAuditV1 | null;
  canManage: boolean;
  canQa: boolean;
}) {
  const router = useRouter();
  const [period, setPeriod] = useState(thisMonth());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function post(url: string, body: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setMessage((json && json.error) || "Action failed");
      return null;
    }
    return json;
  }

  async function create() {
    setBusy(true);
    setMessage(null);
    const r = await post("/api/seo/monthly-audits", { projectId, period });
    setBusy(false);
    if (r) {
      setMessage(`Audit for ${period} ready.`);
      router.refresh();
    }
  }

  async function updateItem(key: string, patch: Record<string, unknown>) {
    if (!audit) return;
    setBusy(true);
    const r = await post(`/api/seo/monthly-audits/${audit.id}`, { action: "update_item", key, ...patch });
    setBusy(false);
    if (r) router.refresh();
  }

  async function transition(to: MonthlyAuditStatus) {
    if (!audit) return;
    setBusy(true);
    const r = await post(`/api/seo/monthly-audits/${audit.id}`, { action: "transition", to });
    setBusy(false);
    if (r) router.refresh();
  }

  if (!audit) {
    return (
      <div className="panel">
        <h2 className="panel-title">Start a monthly audit</h2>
        {canManage ? (
          <div className="toolbar" style={{ marginTop: 8 }}>
            <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="YYYY-MM" style={{ maxWidth: 120 }} />
            <button type="button" onClick={create} disabled={busy}>Create audit</button>
            <span className="muted" style={{ fontSize: 12 }}>Unresolved items carry forward from the prior month.</span>
          </div>
        ) : (
          <p className="muted">No audit yet for this project.</p>
        )}
        {message ? <p className="muted">{message}</p> : null}
      </div>
    );
  }

  const counts = audit.items.reduce<Record<string, number>>((acc, i) => {
    acc[i.result] = (acc[i.result] ?? 0) + 1;
    return acc;
  }, {});
  const nexts = MONTHLY_AUDIT_TRANSITIONS[audit.status];

  return (
    <div>
      <div className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Audit · {audit.period}</h2>
          <span className={`badge status-${audit.status}`}>{audit.status.replace(/_/g, " ")}</span>
        </div>
        <div className="toolbar" style={{ marginBottom: 8 }}>
          <span className="badge status-pass">pass {counts.pass ?? 0}</span>
          <span className="badge status-warning">warning {counts.warning ?? 0}</span>
          <span className="badge status-fail">fail {counts.fail ?? 0}</span>
          <span className="badge">pending {counts.pending ?? 0}</span>
        </div>
        <div className="toolbar">
          {nexts.map((n) => {
            const isReview = n === "qa" || n === "published";
            const allowed = isReview ? canQa : canManage;
            return allowed ? (
              <button key={n} type="button" disabled={busy} onClick={() => transition(n)}
                style={n === "published" ? {} : { background: "transparent", color: "var(--fg)", border: "1px solid var(--border)" }}>
                {n === "in_review" ? "Submit for review" : n === "qa" ? "Send to QA" : n === "published" ? "Publish" : `→ ${n}`}
              </button>
            ) : null;
          })}
          {audit.status === "published" ? <span className="muted" style={{ fontSize: 12 }}>Published{audit.publishedAt ? ` ${audit.publishedAt.slice(0, 10)}` : ""}.</span> : null}
        </div>
        {message ? <p className="muted">{message}</p> : null}
      </div>

      <div className="panel">
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th>Check</th>
                <th>Category</th>
                <th>Result</th>
                <th>Notes</th>
                <th>Remediation</th>
              </tr>
            </thead>
            <tbody>
              {audit.items.map((item) => (
                <tr key={item.key}>
                  <td>
                    {item.label}
                    {item.carriedForward ? <span className="badge badge--warn" style={{ marginLeft: 6 }}>carried</span> : null}
                  </td>
                  <td className="muted">{item.category}</td>
                  <td>
                    <select
                      aria-label={`Result for ${item.label}`}
                      value={item.result}
                      disabled={!canManage || busy || audit.status === "published"}
                      onChange={(e) => updateItem(item.key, { result: e.target.value })}
                      style={{ maxWidth: 150 }}
                    >
                      {RESULTS.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`Notes for ${item.label}`}
                      defaultValue={item.notes ?? ""}
                      disabled={!canManage || audit.status === "published"}
                      onBlur={(e) => { if (e.target.value !== (item.notes ?? "")) updateItem(item.key, { notes: e.target.value }); }}
                      style={{ minWidth: 160 }}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Remediation for ${item.label}`}
                      defaultValue={item.remediation ?? ""}
                      disabled={!canManage || audit.status === "published"}
                      onBlur={(e) => { if (e.target.value !== (item.remediation ?? "")) updateItem(item.key, { remediation: e.target.value }); }}
                      style={{ minWidth: 160 }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
