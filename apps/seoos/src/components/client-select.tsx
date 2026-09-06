"use client";

import { useRouter } from "next/navigation";

interface Option {
  id: string;
  businessName: string;
}

/** Compact client picker used on per-client pages (keywords, rankings, …). */
export function ClientSelect({
  projects,
  selectedId,
  basePath,
}: {
  projects: Option[];
  selectedId?: string;
  basePath: string;
}) {
  const router = useRouter();
  return (
    <div className="toolbar" style={{ marginBottom: 12 }}>
      <label htmlFor="client-select" className="muted" style={{ fontSize: 12 }}>
        Client:
      </label>
      <select
        id="client-select"
        value={selectedId ?? ""}
        onChange={(e) => router.push(`${basePath}?projectId=${e.target.value}`)}
        style={{ maxWidth: 320 }}
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.businessName}
          </option>
        ))}
      </select>
    </div>
  );
}
