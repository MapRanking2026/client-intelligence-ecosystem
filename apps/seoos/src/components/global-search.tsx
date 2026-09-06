"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface SearchHit {
  kind: "client" | "page";
  label: string;
  sub?: string;
  href: string;
}

/**
 * App-wide search in the top bar, available to everyone. Queries /api/search
 * (results are scoped server-side to what the viewer may see), shows a live
 * dropdown, and supports keyboard navigation. Selecting a result navigates.
 */
export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced fetch as the query changes.
  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const body = (await res.json()) as { data?: SearchHit[] };
        setHits(body.data ?? []);
        setActive(0);
        setOpen(true);
      } catch {
        /* aborted or offline — ignore */
      }
    }, 160);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  // Close on outside click.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Cmd/Ctrl+K focuses the search.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function go(hit: SearchHit) {
    setOpen(false);
    setQ("");
    setHits([]);
    router.push(hit.href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || !hits.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[active];
      if (hit) go(hit);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="global-search" ref={boxRef}>
      <span className="global-search-icon" aria-hidden>
        ⌕
      </span>
      <input
        ref={inputRef}
        className="global-search-input"
        type="search"
        placeholder="Search clients, pages, anything…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        onKeyDown={onKeyDown}
        aria-label="Search the app"
      />
      {open && hits.length > 0 ? (
        <div className="global-search-menu" role="listbox">
          {hits.map((hit, i) => (
            <button
              key={`${hit.kind}-${hit.href}-${i}`}
              type="button"
              className={`global-search-item${i === active ? " is-active" : ""}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(hit)}
            >
              <span className={`gs-kind gs-kind--${hit.kind}`}>
                {hit.kind === "client" ? "Client" : "Page"}
              </span>
              <span className="gs-label">{hit.label}</span>
              {hit.sub ? <span className="gs-sub">{hit.sub}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {open && q.trim() && hits.length === 0 ? (
        <div className="global-search-menu">
          <div className="global-search-empty">No matches for “{q.trim()}”.</div>
        </div>
      ) : null}
    </div>
  );
}
