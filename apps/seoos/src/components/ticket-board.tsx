"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

interface Ticket {
  id: string;
  externalId: string;
  url?: string;
  title: string;
  body?: string;
  category: string;
  department?: string;
  clientName?: string;
  specialistName?: string;
  clickupStatus?: string;
  dueDate?: string;
  status: string;
  draft?: string;
  detail?: string;
  needsInfo?: string[];
  decisionNote?: string;
}

const STATUS_ORDER = [
  "needs_info",
  "awaiting_approval",
  "drafting",
  "new",
  "approved",
  "published",
  "rejected",
];

const STATUS_LABEL: Record<string, string> = {
  new: "New",
  drafting: "Drafting…",
  awaiting_approval: "Awaiting approval",
  needs_info: "Needs info",
  approved: "Approved",
  published: "Delivered",
  rejected: "Rejected",
};

export function TicketBoard({
  tickets,
  isAdmin,
}: {
  tickets: Ticket[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const groups = useMemo(() => {
    const by = new Map<string, Ticket[]>();
    for (const t of tickets) {
      const arr = by.get(t.status) ?? [];
      arr.push(t);
      by.set(t.status, arr);
    }
    return STATUS_ORDER.filter((s) => by.get(s)?.length).map((s) => ({
      status: s,
      items: by.get(s)!,
    }));
  }, [tickets]);

  async function sync() {
    setBusy("sync");
    setMsg(null);
    try {
      const res = await fetch("/api/seo/tickets", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) setMsg((body && body.error) || "Sync failed");
      else {
        const d = body.data;
        setMsg(
          `Synced from ClickUp: +${d.created} new, ${d.updated} updated, ${d.drafted} drafted` +
            (d.skipped ? ` · ${d.skipped} skipped (assignee not a specialist)` : "") +
            ".",
        );
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  async function act(ticketId: string, action: string, extra?: { note?: string; draft?: string }) {
    setBusy(`${action}:${ticketId}`);
    setMsg(null);
    try {
      const res = await fetch(`/api/seo/tickets/${ticketId}`, {
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
      <div className="toolbar" style={{ marginBottom: 12 }}>
        {isAdmin ? (
          <button type="button" onClick={sync} disabled={busy !== null}>
            {busy === "sync" ? "Syncing from ClickUp…" : "Sync tickets now"}
          </button>
        ) : null}
        <span className="muted" style={{ fontSize: 12 }}>Auto-syncs from ClickUp every 2 hours.</span>
        {msg ? <span className="muted" style={{ fontSize: 12 }}>{msg}</span> : null}
      </div>

      {groups.length === 0 ? (
        <div className="panel">
          <p className="muted" style={{ margin: 0 }}>
            No tickets yet.{" "}
            {isAdmin
              ? "Click “Sync tickets from ClickUp” to pull them in."
              : "Assigned ClickUp tickets will appear here once synced."}
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.status} className="panel" style={{ marginBottom: 14 }}>
            <div className="panel-head">
              <h2 className="panel-title">
                {STATUS_LABEL[g.status] ?? g.status} ({g.items.length})
              </h2>
            </div>
            <div className="ticket-list">
              {g.items.map((t) => {
                const open = openId === t.id;
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
                        {t.department ? <span className="gs-kind">{t.department}</span> : null}
                        <span className={`gs-kind gs-kind--client`}>{t.category.replace(/_/g, " ")}</span>
                        {t.clientName ? <span className="muted">{t.clientName}</span> : null}
                        {t.specialistName ? <span className="muted">· {t.specialistName}</span> : null}
                        <span className="chevron" aria-hidden>{open ? "▾" : "▸"}</span>
                      </span>
                    </button>

                    {open ? (
                      <div className="ticket-body">
                        {t.body ? (
                          <div className="ticket-ask">
                            <div className="ticket-label">The ask (from ClickUp)</div>
                            <p style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{t.body}</p>
                          </div>
                        ) : null}

                        {t.detail ? (
                          <p className="muted" style={{ fontSize: 13 }}>{t.detail}</p>
                        ) : null}

                        {t.needsInfo && t.needsInfo.length > 0 ? (
                          <div className="ticket-needs">
                            <div className="ticket-label">Needs info before this can go out</div>
                            <ul style={{ margin: "4px 0 0" }}>
                              {t.needsInfo.map((n, i) => (
                                <li key={i}>{n}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {t.draft ? (
                          <TicketDraft
                            ticket={t}
                            busy={busy}
                            onSave={(draft) => act(t.id, "save", { draft })}
                            onApprove={(draft) => act(t.id, "approve", { draft })}
                            onReject={(note) => act(t.id, "reject", { note })}
                          />
                        ) : (
                          <div className="ticket-draftbox muted">No draft yet.</div>
                        )}

                        <div className="toolbar" style={{ marginTop: 10 }}>
                          {t.status === "new" || t.status === "needs_info" || t.status === "rejected" ? (
                            <button
                              type="button"
                              onClick={() => act(t.id, "draft")}
                              disabled={busy !== null}
                            >
                              {busy === `draft:${t.id}` ? "Drafting…" : t.draft ? "Re-draft" : "Draft this ticket"}
                            </button>
                          ) : null}
                          {t.url ? (
                            <a
                              className="muted"
                              href={t.url}
                              target="_blank"
                              rel="noreferrer"
                              style={{ fontSize: 12, alignSelf: "center" }}
                            >
                              Open in ClickUp ↗
                            </a>
                          ) : null}
                        </div>

                        {t.decisionNote ? (
                          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                            Note: {t.decisionNote}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function TicketDraft({
  ticket,
  busy,
  onSave,
  onApprove,
  onReject,
}: {
  ticket: Ticket;
  busy: string | null;
  onSave: (draft: string) => void;
  onApprove: (draft: string) => void;
  onReject: (note: string) => void;
}) {
  const [draft, setDraft] = useState(ticket.draft ?? "");
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const decided = ticket.status === "approved" || ticket.status === "published" || ticket.status === "rejected";
  const dirty = draft !== (ticket.draft ?? "");

  return (
    <div className="ticket-draftbox">
      <div className="ticket-label">Drafted deliverable — staged here, nothing is live</div>
      <textarea
        className="ticket-draft"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={Math.min(20, Math.max(6, draft.split("\n").length + 1))}
        readOnly={decided}
      />
      {!decided ? (
        <div className="toolbar" style={{ marginTop: 8 }}>
          <button
            type="button"
            className="btn-approve"
            onClick={() => onApprove(draft)}
            disabled={busy !== null || !draft.trim()}
          >
            {busy === `approve:${ticket.id}` ? "Approving…" : "Approve"}
          </button>
          <button
            type="button"
            onClick={() => onSave(draft)}
            disabled={busy !== null || !dirty}
            style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" }}
          >
            {busy === `save:${ticket.id}` ? "Saving…" : "Save edits"}
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
            {busy === `reject:${ticket.id}` ? "Rejecting…" : "Confirm reject"}
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
