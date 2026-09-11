"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Admin action: learn each specialist's writing style from their own ClickUp
 * comments and seed their style profile. "Seed" only fills empty profiles;
 * "Re-seed all" re-analyzes everyone (keeping their learned corrections).
 * Renders only for admins (the parent gates on tenant-wide visibility).
 */
type Row = { specialistId: string; name: string; samples: number; seeded: boolean; note?: string };

export function SeedStylesButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);

  async function run(force: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/seo/specialists/seed-styles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage((body && body.error) || "Seeding failed");
        return;
      }
      const d = body.data;
      if (!d?.ok) {
        setMessage(d?.error ?? "Seeding error");
        return;
      }
      const list: Row[] = d.perSpecialist ?? [];
      setRows(list);
      const seeded = list.filter((r) => r.seeded).length;
      setMessage(`Scanned ${d.scannedTasks} ClickUp task(s). Seeded ${seeded} of ${list.length} specialist(s).`);
      router.refresh();
    } catch {
      setMessage("Seeding failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="toolbar">
        <button type="button" onClick={() => run(false)} disabled={busy}>
          {busy ? "Learning styles…" : "Seed styles from ClickUp"}
        </button>
        <button
          type="button"
          onClick={() => run(true)}
          disabled={busy}
          title="Re-analyze every specialist, even those who already have a profile. Learned corrections are kept."
          style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" }}
        >
          Re-seed all
        </button>
        {message ? <span className="muted" style={{ fontSize: 12 }}>{message}</span> : null}
      </div>
      {rows && rows.length ? (
        <div className="table-scroll" style={{ marginTop: 8 }}>
          <table className="data">
            <thead>
              <tr><th>Specialist</th><th>Samples</th><th>Result</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.specialistId}>
                  <td>{r.name}</td>
                  <td className="muted">{r.samples}</td>
                  <td>
                    {r.seeded ? (
                      <span className="badge badge--ok">seeded ✓</span>
                    ) : (
                      <span className="muted">{r.note ?? "skipped"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
