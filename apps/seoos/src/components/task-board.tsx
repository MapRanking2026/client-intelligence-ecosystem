"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Task {
  id: string;
  title: string;
  phase: "phase1" | "phase2" | "recurring";
  cadence: string;
  period?: string;
  specialistName?: string;
  status: string;
  draftable: boolean;
  draft?: string;
  detail?: string;
  needsInfo?: string[];
  decisionNote?: string;
}

const PHASE_LABEL: Record<Task["phase"], string> = {
  phase1: "Phase 1 · Setup & Quick Wins",
  phase2: "Phase 2 · Website SEO",
  recurring: "Recurring · Steady State",
};
const PHASES: Task["phase"][] = ["phase1", "phase2", "recurring"];

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  drafting: "Drafting…",
  awaiting_approval: "Awaiting approval",
  needs_info: "Needs info",
  approved: "Approved",
  published: "Delivered",
  rejected: "Rejected",
  skipped: "Skipped",
};

export function TaskBoard({ tasks, canDecide }: { tasks: Task[]; canDecide: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  async function act(taskId: string, action: string, extra?: { note?: string; draft?: string }) {
    setBusy(`${action}:${taskId}`);
    setMsg(null);
    try {
      const res = await fetch(`/api/seo/tasks/${taskId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) setMsg((body && body.error) || "Failed");
      else router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {msg ? (
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <span className="muted" style={{ fontSize: 12 }}>{msg}</span>
        </div>
      ) : null}

      {PHASES.map((phase) => {
        const rows = tasks.filter((t) => t.phase === phase);
        if (!rows.length) return null;
        return (
          <section key={phase} className="panel" style={{ marginBottom: 14 }}>
            <div className="panel-head">
              <h2 className="panel-title">{PHASE_LABEL[phase]} ({rows.length})</h2>
            </div>
            <div className="ticket-list">
              {rows.map((t) => {
                const open = openId === t.id;
                const terminal = ["approved", "published", "skipped", "rejected"].includes(t.status);
                return (
                  <article key={t.id} className={`ticket${open ? " is-open" : ""}`}>
                    <button
                      type="button"
                      className="ticket-head"
                      onClick={() => setOpenId(open ? null : t.id)}
                      aria-expanded={open}
                    >
                      <span className="ticket-title">{t.title}</span>
                      <span className="ticket-meta">
                        <span className="gs-kind">{t.cadence}{t.period ? ` · ${t.period}` : ""}</span>
                        {t.specialistName ? <span className="muted">{t.specialistName}</span> : null}
                        <span className="gs-kind gs-kind--client">{STATUS_LABEL[t.status] ?? t.status}</span>
                        <span className="chevron" aria-hidden>{open ? "▾" : "▸"}</span>
                      </span>
                    </button>

                    {open ? (
                      <div className="ticket-body">
                        {!t.draftable ? (
                          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                            Done by hand — no AI draft. Mark it Approved once complete, or Skip if not applicable.
                          </p>
                        ) : null}

                        {t.detail ? <p className="muted" style={{ fontSize: 13 }}>{t.detail}</p> : null}

                        {t.needsInfo && t.needsInfo.length > 0 ? (
                          <div className="ticket-needs">
                            <div className="ticket-label">Needs info before this can go out</div>
                            <ul style={{ margin: "4px 0 0" }}>
                              {t.needsInfo.map((n, i) => <li key={i}>{n}</li>)}
                            </ul>
                          </div>
                        ) : null}

                        {t.draft ? (
                          <TaskDraft
                            task={t}
                            busy={busy}
                            canDecide={canDecide}
                            onSave={(draft) => act(t.id, "save", { draft })}
                            onApprove={(draft) => act(t.id, "approve", { draft })}
                            onReject={(note) => act(t.id, "reject", { note })}
                          />
                        ) : t.draftable ? (
                          <div className="ticket-draftbox muted">No draft yet.</div>
                        ) : null}

                        {canDecide ? (
                          <div className="toolbar" style={{ marginTop: 10 }}>
                            {t.draftable && !terminal ? (
                              <button type="button" onClick={() => act(t.id, "draft")} disabled={busy !== null}>
                                {busy === `draft:${t.id}` ? "Drafting…" : t.draft ? "Re-draft" : "Draft this task"}
                              </button>
                            ) : null}
                            {!t.draftable && !terminal ? (
                              <button type="button" className="btn-approve" onClick={() => act(t.id, "approve")} disabled={busy !== null}>
                                {busy === `approve:${t.id}` ? "Marking…" : "Mark approved"}
                              </button>
                            ) : null}
                            {!terminal ? (
                              <button
                                type="button"
                                onClick={() => act(t.id, "skip")}
                                disabled={busy !== null}
                                style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" }}
                              >
                                {busy === `skip:${t.id}` ? "Skipping…" : "Skip"}
                              </button>
                            ) : null}
                          </div>
                        ) : null}

                        {t.decisionNote ? (
                          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Note: {t.decisionNote}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TaskDraft({
  task,
  busy,
  canDecide,
  onSave,
  onApprove,
  onReject,
}: {
  task: Task;
  busy: string | null;
  canDecide: boolean;
  onSave: (draft: string) => void;
  onApprove: (draft: string) => void;
  onReject: (note: string) => void;
}) {
  const [draft, setDraft] = useState(task.draft ?? "");
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const decided = ["approved", "published", "rejected", "skipped"].includes(task.status);
  const dirty = draft !== (task.draft ?? "");

  return (
    <div className="ticket-draftbox">
      <div className="ticket-label">Drafted deliverable — staged here, nothing is live</div>
      <textarea
        className="ticket-draft"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={Math.min(20, Math.max(6, draft.split("\n").length + 1))}
        readOnly={decided || !canDecide}
      />
      {canDecide && !decided ? (
        <div className="toolbar" style={{ marginTop: 8 }}>
          <button type="button" className="btn-approve" onClick={() => onApprove(draft)} disabled={busy !== null || !draft.trim()}>
            {busy === `approve:${task.id}` ? "Approving…" : "Approve"}
          </button>
          <button
            type="button"
            onClick={() => onSave(draft)}
            disabled={busy !== null || !dirty}
            style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" }}
          >
            {busy === `save:${task.id}` ? "Saving…" : "Save edits"}
          </button>
          {!rejecting ? (
            <button
              type="button"
              onClick={() => setRejecting(true)}
              disabled={busy !== null}
              style={{ background: "transparent", color: "var(--danger)", border: "1px solid var(--border)" }}
            >
              Reject
            </button>
          ) : null}
        </div>
      ) : null}

      {rejecting && !decided ? (
        <div className="ticket-reject">
          <input
            type="text"
            placeholder="What was wrong? (this teaches the specialist's style)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="button" onClick={() => onReject(note)} disabled={busy !== null || !note.trim()}>
            {busy === `reject:${task.id}` ? "Rejecting…" : "Confirm reject"}
          </button>
          <button
            type="button"
            onClick={() => setRejecting(false)}
            style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" }}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}
