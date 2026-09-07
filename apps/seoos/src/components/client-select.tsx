"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Option {
  id: string;
  businessName: string;
}

/**
 * Client picker used on every per-client page. A searchable combobox: the list
 * is alphabetized, and opening it reveals a search field at the top so a client
 * can be found by typing instead of scrolling. Navigates to
 * `${basePath}?projectId=${id}` on select.
 */
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const sorted = useMemo(
    () => [...projects].sort((a, b) => a.businessName.localeCompare(b.businessName)),
    [projects],
  );
  const selected = sorted.find((p) => p.id === selectedId);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((p) => p.businessName.toLowerCase().includes(q));
  }, [sorted, query]);

  // Focus the search field when the menu opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Close on outside click.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function choose(opt: Option) {
    setOpen(false);
    if (opt.id !== selectedId) router.push(`${basePath}?projectId=${opt.id}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[active];
      if (opt) choose(opt);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="toolbar" style={{ marginBottom: 12 }}>
      <span className="muted" style={{ fontSize: 12 }}>Client:</span>
      <div className="client-combo" ref={boxRef}>
        <button
          type="button"
          className="client-combo-trigger"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className={selected ? "" : "muted"}>
            {selected ? selected.businessName : "Select a client"}
          </span>
          <span className="client-combo-caret" aria-hidden>▾</span>
        </button>

        {open ? (
          <div className="client-combo-menu">
            <div className="client-combo-search">
              <span aria-hidden>⌕</span>
              <input
                ref={inputRef}
                type="text"
                placeholder="Type a client name…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                aria-label="Search clients"
              />
            </div>
            <div className="client-combo-list" role="listbox">
              {filtered.length === 0 ? (
                <div className="client-combo-empty">No matches</div>
              ) : (
                filtered.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={p.id === selectedId}
                    className={`client-combo-item${i === active ? " is-active" : ""}${
                      p.id === selectedId ? " is-selected" : ""
                    }`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(p)}
                  >
                    {p.businessName}
                  </button>
                ))
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
