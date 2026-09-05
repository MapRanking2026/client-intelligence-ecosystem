"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  WORK_ORDER_TRANSITIONS,
  type WorkOrderStatus,
  type WorkOrderV1,
} from "@/src/lib/domain/work-order";

export function WorkOrdersBoard({
  workOrders,
  projectId,
  clientId,
  canManage,
  canQa,
}: {
  workOrders: WorkOrderV1[];
  projectId: string;
  clientId: string;
  canManage: boolean;
  canQa: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [title, setTitle] = useState("");

  async function post(url: string, body: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setMessage((json && json.error) || "Action failed");
      return false;
    }
    return true;
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusyId("new");
    setMessage(null);
    const ok = await post("/api/seo/work-orders", {
      projectId,
      clientId,
      type: "custom",
      title,
    });
    setBusyId(null);
    if (ok) {
      setTitle("");
      setMessage("Work order created.");
      router.refresh();
    }
  }

  async function transition(id: string, to: WorkOrderStatus) {
    setBusyId(id);
    setMessage(null);
    const ok = await post(`/api/seo/work-orders/${id}`, { action: "transition", to });
    setBusyId(null);
    if (ok) router.refresh();
  }

  async function qa(id: string, result: "pass" | "revision") {
    setBusyId(id);
    setMessage(null);
    const ok = await post(`/api/seo/work-orders/${id}`, { action: "qa", result });
    setBusyId(null);
    if (ok) router.refresh();
  }

  return (
    <div>
      {canManage ? (
        <form className="toolbar" onSubmit={create}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New work order title…" style={{ maxWidth: 320 }} />
          <button type="submit" disabled={busyId === "new"}>+ Add</button>
        </form>
      ) : null}
      {message ? <p className="muted">{message}</p> : null}

      {workOrders.length === 0 ? (
        <p className="muted">No work orders yet.</p>
      ) : (
        workOrders.map((w) => {
          const busy = busyId === w.id;
          const nexts = WORK_ORDER_TRANSITIONS[w.status];
          return (
            <div key={w.id} className="panel">
              <div className="panel-head">
                <h3 className="panel-title">{w.title}</h3>
                <span className={`badge status-${w.status}`}>{w.status.replace(/_/g, " ")}</span>
              </div>
              <div className="toolbar" style={{ marginBottom: 6 }}>
                <span className="badge">{w.type.replace(/_/g, " ")}</span>
                <span className="badge">priority: {w.priority}</span>
                {w.requiresApproval ? <span className="badge badge--warn">approval required</span> : null}
                {w.sourceRecommendationId ? <span className="muted" style={{ fontSize: 12 }}>from {w.sourceRecommendationId}</span> : null}
              </div>
              {w.scope ? <p className="muted" style={{ fontSize: 13 }}>{w.scope}</p> : null}
              {w.qa ? (
                <p className="muted" style={{ fontSize: 12 }}>QA: {w.qa.result} by {w.qa.reviewerUserId}</p>
              ) : null}

              <div className="toolbar" style={{ marginTop: 8 }}>
                {w.status === "ready_for_qa" && canQa ? (
                  <>
                    <button type="button" disabled={busy} onClick={() => qa(w.id, "pass")}>QA pass</button>
                    <button type="button" disabled={busy} onClick={() => qa(w.id, "revision")} style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" }}>Request revision</button>
                  </>
                ) : null}
                {canManage && w.status !== "ready_for_qa"
                  ? nexts
                      .filter((n) => n !== "cancelled")
                      .map((n) => (
                        <button key={n} type="button" disabled={busy} onClick={() => transition(w.id, n)} style={{ background: "transparent", color: "var(--fg)", border: "1px solid var(--border)" }}>
                          → {n.replace(/_/g, " ")}
                        </button>
                      ))
                  : null}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
