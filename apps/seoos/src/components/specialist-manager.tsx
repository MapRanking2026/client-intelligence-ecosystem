"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export interface SpecialistRow {
  id: string;
  name: string;
  email?: string;
  count: number;
}

/** Admin roster control: add specialists, see their client counts, remove them. */
export function SpecialistManager({ specialists }: { specialists: SpecialistRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/seo/specialists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email: email || undefined }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) setMessage((body && body.error) || "Add failed");
      else {
        setName("");
        setEmail("");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, label: string, count: number) {
    const note = count > 0 ? ` ${count} client(s) will become Unassigned.` : "";
    if (!window.confirm(`Remove specialist "${label}"?${note}`)) return;
    setBusy(true);
    try {
      await fetch(`/api/seo/specialists/${id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr><th>SEO specialist</th><th>Login email</th><th>Clients</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {specialists.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className="muted">{s.email || "— (links by name)"}</td>
                <td>{s.count === 0 ? <span className="muted">0</span> : s.count}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => remove(s.id, s.name, s.count)}
                    disabled={busy}
                    style={{ background: "transparent", color: "var(--danger)", border: "1px solid var(--border)" }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={add} className="toolbar" style={{ marginTop: 12, flexWrap: "wrap", gap: 8 }}>
        <input
          placeholder="New specialist name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ maxWidth: 220 }}
        />
        <input
          placeholder="Login email (optional)"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ maxWidth: 240 }}
        />
        <button type="submit" disabled={busy || !name.trim()}>{busy ? "Saving…" : "+ Add specialist"}</button>
        {message ? <span className="muted" style={{ fontSize: 12 }}>{message}</span> : null}
      </form>
      <p className="muted" style={{ fontSize: 12 }}>
        Clients auto-group by their ClickUp specialist (⭐ Responsable). Set a login email so that
        specialist&apos;s account is scoped to their clients; otherwise it links by name.
      </p>
    </div>
  );
}
