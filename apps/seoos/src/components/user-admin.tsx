"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

type ManagedUser = {
  userId: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  disabled: boolean;
  mustResetPassword: boolean;
};

/** Admin: create login users (with a one-time temp password) and manage roles/resets. */
export function UserAdmin({ users }: { users: ManagedUser[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [admin, setAdmin] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [temp, setTemp] = useState<{ email: string; tempPassword: string } | null>(null);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setTemp(null);
    try {
      const res = await fetch("/api/seo/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", email, displayName: name, admin }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg((body && body.error) || "Create failed");
        return;
      }
      setTemp({ email: body.data.email, tempPassword: body.data.tempPassword });
      setEmail("");
      setName("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function act(userId: string, patch: Record<string, unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/seo/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "update", userId, ...patch }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) setMsg((body && body.error) || "Update failed");
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <form onSubmit={create} className="row" style={{ alignItems: "end", gap: 10, marginBottom: 12 }}>
        <div>
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Frank Segura" required />
        </div>
        <div>
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@mapranking.com" required />
        </div>
        <label style={{ display: "flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} style={{ width: "auto" }} /> Admin
        </label>
        <button type="submit" disabled={busy}>{busy ? "Creating…" : "Create user"}</button>
      </form>

      {temp ? (
        <div className="panel" style={{ marginBottom: 12 }}>
          <p style={{ margin: 0 }}>
            Created <strong>{temp.email}</strong>. One-time password (they must set their own on first login):
          </p>
          <p style={{ margin: "6px 0 0", fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 16 }}>
            <strong>{temp.tempPassword}</strong>
          </p>
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Copy it now — it won&apos;t be shown again.</p>
        </div>
      ) : null}
      {msg ? <p className="muted">{msg}</p> : null}

      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Role</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.userId}>
                <td>{u.displayName || u.userId}</td>
                <td className="muted">{u.email}</td>
                <td>
                  {u.isAdmin ? <span className="badge badge--ok">Admin</span> : "Specialist"}
                  {u.mustResetPassword ? <span className="badge badge--warn" style={{ marginLeft: 6 }}>reset pending</span> : null}
                </td>
                <td>
                  {!u.isAdmin ? (
                    <button type="button" onClick={() => act(u.userId, { makeAdmin: true })} disabled={busy} style={{ padding: "3px 8px", marginRight: 6 }}>
                      Make admin
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => act(u.userId, { forceReset: true })}
                    disabled={busy}
                    style={{ padding: "3px 8px", background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" }}
                  >
                    Force reset
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
