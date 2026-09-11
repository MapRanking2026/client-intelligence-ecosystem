"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Super-admin (dev): open the app as any SEO specialist to verify their view. */
export function ImpersonationPanel({ specialists }: { specialists: { id: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function viewAs(id: string) {
    setBusy(id);
    try {
      await fetch("/api/seo/impersonate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ specialistId: id }),
      });
      router.push("/");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="table-scroll">
      <table className="data">
        <thead>
          <tr><th>Specialist</th><th></th></tr>
        </thead>
        <tbody>
          {specialists.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>
                <button type="button" onClick={() => viewAs(s.id)} disabled={busy !== null} style={{ padding: "4px 10px" }}>
                  {busy === s.id ? "Opening…" : "View as"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
