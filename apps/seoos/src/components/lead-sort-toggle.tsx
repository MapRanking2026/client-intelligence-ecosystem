"use client";

import { useRouter, useSearchParams } from "next/navigation";

/** Newest/Oldest control. Default is newest (desc). Server does the real sort. */
export function LeadSortToggle() {
  const router = useRouter();
  const params = useSearchParams();
  const dir = params.get("dir") === "asc" ? "asc" : "desc";

  function set(next: "asc" | "desc") {
    const sp = new URLSearchParams(params.toString());
    sp.set("dir", next);
    router.push(`/lead-verification?${sp.toString()}`);
  }

  return (
    <div className="toolbar" role="group" aria-label="Sort order">
      <span className="muted" style={{ fontSize: 12 }}>Sort:</span>
      <button
        type="button"
        onClick={() => set("desc")}
        style={dir === "desc" ? {} : { background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" }}
      >
        Newest first
      </button>
      <button
        type="button"
        onClick={() => set("asc")}
        style={dir === "asc" ? {} : { background: "transparent", color: "var(--muted)", border: "1px solid var(--border)" }}
      >
        Oldest first
      </button>
    </div>
  );
}
