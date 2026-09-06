"use client";

import Link from "next/link";
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
}

type Col = { key: keyof ClientRow; label: string; numeric?: boolean };

const COLUMNS: Col[] = [
  { key: "businessName", label: "Business" },
  { key: "pod", label: "Pod" },
  { key: "status", label: "Status" },
  { key: "health", label: "Health" },
  { key: "setup", label: "Setup %", numeric: true },
  { key: "services", label: "Projects", numeric: true },
  { key: "avgRanking", label: "Avg rank" },
  { key: "stage", label: "Stage" },
];

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

export function ClientsTable({ rows }: { rows: ClientRow[] }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<keyof ClientRow>("businessName");
  const [dir, setDir] = useState<"asc" | "desc">("asc");

  function onSort(key: keyof ClientRow) {
    if (key === sortKey) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDir("asc");
    }
  }

  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? rows.filter((r) =>
          [r.businessName, r.pod, r.status, r.health, r.stage, r.avgRanking]
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : rows;
    const col = COLUMNS.find((c) => c.key === sortKey);
    const sorted = [...filtered].sort((a, b) => compare(a, b, sortKey, Boolean(col?.numeric)));
    return dir === "asc" ? sorted : sorted.reverse();
  }, [rows, query, sortKey, dir]);

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
              {COLUMNS.map((c) => (
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
