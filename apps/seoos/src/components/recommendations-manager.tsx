"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RecommendationV1 } from "@/src/lib/domain/recommendation";

export function RecommendationsManager({
  recommendations,
  canManage,
  canApprove,
}: {
  recommendations: RecommendationV1[];
  canManage: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function act(id: string, action: string) {
    setBusyId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/seo/recommendations/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) setMessage((json && json.error) || "Action failed");
      else {
        setMessage(action === "convert" ? "Converted to a work order." : `Recommendation ${action}d.`);
        router.refresh();
      }
    } finally {
      setBusyId(null);
    }
  }

  if (recommendations.length === 0) {
    return <p className="muted">No recommendations for this project yet.</p>;
  }

  return (
    <div>
      {message ? <p className="muted">{message}</p> : null}
      {recommendations.map((r) => {
        const busy = busyId === r.id;
        return (
          <div key={r.id} className="panel">
            <div className="panel-head">
              <h3 className="panel-title">{r.title}</h3>
              <span className={`badge status-${r.status}`}>{r.status}</span>
            </div>
            <div className="toolbar" style={{ marginBottom: 8 }}>
              <span className="badge">{r.type.replace(/_/g, " ")}</span>
              <span className="badge">impact: {r.expectedImpact}</span>
              <span className="badge">confidence: {r.confidence}</span>
              <span className="badge">effort: {r.estimatedEffort.toUpperCase()}</span>
              {r.requiresApproval ? <span className="badge badge--warn">approval required</span> : null}
              <span className="muted" style={{ fontSize: 12 }}>{r.evidence.length} evidence</span>
            </div>
            <p style={{ margin: "0 0 6px" }}>{r.rationale}</p>
            {r.clientSafeExplanation ? (
              <p className="muted" style={{ fontSize: 13 }}>
                <strong>Client-safe:</strong> {r.clientSafeExplanation}
              </p>
            ) : null}

            <div className="toolbar" style={{ marginTop: 8 }}>
              {canManage && r.status === "proposed" ? (
                <>
                  <button type="button" disabled={busy} onClick={() => act(r.id, "approve")}>Approve</button>
                  <button type="button" disabled={busy} onClick={() => act(r.id, "defer")} style={ghost}>Defer</button>
                  <button type="button" disabled={busy} onClick={() => act(r.id, "reject")} style={danger}>Reject</button>
                </>
              ) : null}
              {canManage && r.status === "deferred" ? (
                <button type="button" disabled={busy} onClick={() => act(r.id, "repropose")} style={ghost}>Re-propose</button>
              ) : null}
              {canApprove && r.status === "approved" ? (
                <button type="button" disabled={busy} onClick={() => act(r.id, "convert")}>Convert to work order</button>
              ) : null}
              {r.status === "approved" && !canApprove ? (
                <span className="muted" style={{ fontSize: 12 }}>Approved — needs seo.work.approve to convert.</span>
              ) : null}
              {r.status === "converted" && r.workOrderId ? (
                <span className="muted" style={{ fontSize: 12 }}>→ work order {r.workOrderId}</span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const ghost = { background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" } as const;
const danger = { background: "transparent", color: "var(--danger)", border: "1px solid var(--border)" } as const;
