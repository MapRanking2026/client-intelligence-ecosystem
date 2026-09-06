"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export interface ClientRow {
  id: string;
  businessName: string;
  clientId: string;
  pod: string;
  health: string;
  setup: number;
  status: string;
  services: number;
  avgRanking: string;
  stage: string;
  /** Direct assignment (assignments.seoSpecialistUserId) or "" when following pod. */
  specialistUserId: string;
  /** Effective specialist display name (direct override, else pod, else Unassigned). */
  specialistName: string;
  /** The pod's specialist name, for the "Auto (pod)" option label. */
  podSpecialistName: string;
}

export interface SpecialistOption {
  userId: string;
  name: string;
}

type Col = { key: keyof ClientRow; label: string; numeric?: boolean };

function columns(admin: boolean): Col[] {
  const base: Col[] = [{ key: "businessName", label: "Business" }];
  if (admin) base.push({ key: "specialistName", label: "Specialist" });
  return [
    ...base,
    { key: "pod", label: "Pod" },
    { key: "status", label: "Status" },
    { key: "health", label: "Health" },
    { key: "setup", label: "Setup %", numeric: true },
    { key: "services", label: "Projects", numeric: true },
    { key: "avgRanking", label: "Avg rank" },
    { key: "stage", label: "Stage" },
  ];
}

function compare(a: ClientRow, b: ClientRow, key: keyof ClientRow, numeric: boolean): number {
  const av = a[key];
  const bv = b[key];
  if (numeric) return Number(av) - Number(bv);
  const an = Number(av);
  const bn = Number(bv);
  if (Number.isFinite(an) && Number.isFinite(bn) && String(av) !== "" && String(bv) !== "") {
    return an - bn;
  }
  return String(av).localeCompare(String(bv), undefined, { sensitivity: "base" });
}

export function ClientsTable({
  rows,
  admin = false,
  specialists = [],
}: {
  rows: ClientRow[];
  admin?: boolean;
  specialists?: SpecialistOption[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<keyof ClientRow>("businessName");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [busyId, setBusyId] = useState<string | null>(null);

  const cols = columns(admin);

  function onSort(key: keyof ClientRow) {
    if (key === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDir("asc");
    }
  }

  async function assign(projectId: string, specialistUserId: string) {
    setBusyId(projectId);
    try {
      await fetch(`/api/seo/projects/${projectId}/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ specialistUserId: specialistUserId || null }),
      });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? rows.filter((r) =>
          [r.businessName, r.pod, r.status, r.health, r.stage, r.avgRanking, r.specialistName]
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : rows;
    const col = cols.find((c) => c.key === sortKey);
    const sorted = [...filtered].sort((a, b) => compare(a, b, sortKey, Boolean(col?.numeric)));
    return dir === "asc" ? sorted : sorted.reverse();
  }, [rows, query, sortKey, dir, cols]);

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <input
          type="search"
          placeholder="Search clients…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 280 }}
        />
        <span className="muted" style={{ fontSize: 12 }}>
          {view.length} of {rows.length}
        </span>
      </div>
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              {cols.map((c) => (
                <th
                  key={c.key}
                  onClick={() => onSort(c.key)}
                  style={{ cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}
                  title="Click to sort"
                >
                  {c.label}
                  {sortKey === c.key ? (dir === "asc" ? " ▲" : " ▼") : " ↕"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/clients/${r.id}`}>{r.businessName}</Link></td>
                {admin ? (
                  <td>
                    <select
                      value={r.specialistUserId}
                      disabled={busyId === r.id}
                      onChange={(e) => assign(r.id, e.target.value)}
                      style={{ maxWidth: 200 }}
                    >
                      <option value="">
                        Auto — pod: {r.podSpecialistName || "unassigned"}
                      </option>
                      {specialists.map((s) => (
                        <option key={s.userId} value={s.userId}>{s.name}</option>
                      ))}
                    </select>
                  </td>
                ) : null}
                <td className="muted">{r.pod || "—"}</td>
                <td>{r.status || "—"}</td>
                <td>{r.health || "—"}</td>
                <td>{r.setup}%</td>
                <td>{r.services}</td>
                <td className="muted">{r.avgRanking || "—"}</td>
                <td className="muted">{r.stage}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
