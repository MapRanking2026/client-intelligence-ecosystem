"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CornerDownLeft, Loader2, Search } from "lucide-react";

import {
  MIN_QUERY_LENGTH,
  SEARCH_PAGES,
  type MatchRange,
  type SearchGroupResult,
  type SearchHit,
} from "@/src/lib/contracts/global-search";

/**
 * ⌘K: one box over everything MTOS holds.
 *
 * Four things it does deliberately:
 *
 *  - **Opens on ⌘K, Ctrl K and `/`, but never while you are writing.** `/` is the fastest key to
 *    reach and the most dangerous to claim: an AM typing a date into the notes must not have the
 *    palette swallow the slash, so it is ignored inside any input, textarea or editable region.
 *  - **Searches the server, not a copy in the browser.** The endpoint reads the same data source
 *    the screens do, so a client renamed a minute ago is findable by its new name.
 *  - **Keeps the keyboard honest.** Arrow keys move through the flattened list across groups,
 *    Enter opens the highlighted row, Esc closes. The highlighted row is scrolled into view,
 *    because a selection you cannot see is worse than none.
 *  - **Says when it found nothing, and when it could not look.** An empty result and a failed read
 *    are different sentences: the second one names what could not be read, so a thin list is never
 *    mistaken for a true one.
 */

/** The rows shown before anything is typed: the app's own screens, in their own order. */
const DEFAULT_GROUPS: SearchGroupResult[] = [
  {
    id: "pages",
    label: "Jump to",
    more: 0,
    hits: SEARCH_PAGES.slice(0, 8).map((page) => ({
      id: `page:${page.href}`,
      group: "pages" as const,
      title: page.title,
      subtitle: page.subtitle,
      href: page.href,
      score: 1,
      titleRanges: [],
    })),
  },
];

function Highlighted({ text, ranges }: { text: string; ranges?: MatchRange[] }) {
  if (!ranges?.length) return <>{text}</>;
  const pieces: React.ReactNode[] = [];
  let at = 0;
  ranges.forEach((range, index) => {
    if (range.start > at) pieces.push(text.slice(at, range.start));
    pieces.push(
      <mark key={`${range.start}-${index}`} style={{ background: "var(--accent-soft)", color: "inherit", padding: 0 }}>
        {text.slice(range.start, range.end)}
      </mark>,
    );
    at = range.end;
  });
  if (at < text.length) pieces.push(text.slice(at));
  return <>{pieces}</>;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function CommandPalette() {
  const router = useRouter();
  const params = useParams();
  const touchId = typeof params?.touchId === "string" ? params.touchId : "";

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroupResult[]>([]);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const searching = query.trim().length >= MIN_QUERY_LENGTH;
  const shown = searching ? groups : DEFAULT_GROUPS;
  const flat = useMemo(() => shown.flatMap((group) => group.hits), [shown]);

  /*
    Where each group's first row sits in the flattened list, so a row can know its own keyboard
    index without a counter being advanced during the render.
  */
  const offsets = useMemo(() => {
    const out: number[] = [];
    let at = 0;
    for (const group of shown) {
      out.push(at);
      at += group.hits.length;
    }
    return out;
  }, [shown]);

  // The shortcut listener. Registered once, on the window, because the palette has to open from
  // anywhere on the page including a screen that has focus inside a form.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
      const isSlash = event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (isShortcut || (isSlash && !isTyping(event.target))) {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const run = useCallback(
    async (text: string, signal: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const url = `/api/search?q=${encodeURIComponent(text)}${touchId ? `&touchId=${encodeURIComponent(touchId)}` : ""}`;
        const response = await fetch(url, { signal, headers: { accept: "application/json" } });
        const payload = (await response.json().catch(() => null)) as
          | { data?: { groups?: SearchGroupResult[]; unavailable?: string[] }; error?: string }
          | null;
        if (!response.ok) throw new Error(payload?.error || "The search did not run.");
        setGroups(payload?.data?.groups || []);
        setUnavailable(payload?.data?.unavailable || []);
        setActive(0);
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "The search did not run.");
        setGroups([]);
      } finally {
        setLoading(false);
      }
    },
    [touchId],
  );

  // One request per pause in typing, and the previous one aborted: without the abort, a slow
  // answer to "oak" can land after the answer to "oakline" and replace it with the wider list.
  useEffect(() => {
    const text = query.trim();
    /*
      Nothing is cleared here on purpose. The results of the last real query stay in state while
      the query is too short to search, and `shown` ignores them -- which means deleting a letter
      and typing it again shows the previous list for a moment instead of flashing empty.
    */
    if (!open || text.length < MIN_QUERY_LENGTH) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void run(text, controller.signal), 160);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, run]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function close() {
    setOpen(false);
    setQuery("");
    setGroups([]);
    setError("");
  }

  function go(target: SearchHit | undefined) {
    if (!target) return;
    close();
    // An absolute url is a real ClickUp task, which belongs in its own tab rather than replacing
    // the workspace the AM is standing in.
    if (/^https?:\/\//.test(target.href)) {
      window.open(target.href, "_blank", "noopener,noreferrer");
      return;
    }
    router.push(target.href);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (flat.length ? (index + 1) % flat.length : 0));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (flat.length ? (index - 1 + flat.length) % flat.length : 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      go(flat[active]);
    }
  }

  return (
    <>
      <button
        type="button"
        className="search"
        onClick={() => setOpen(true)}
        aria-label="Search MTOS"
        style={{ cursor: "text", textAlign: "left" }}
      >
        <Search />
        <span>Search clients, touches, tickets, pages…</span>
        <span className="kbd">⌘K</span>
      </button>

      {open ? (
        <div
          className="drawer-scrim"
          onClick={close}
          style={{ display: "grid", placeItems: "start center", paddingTop: "10vh", zIndex: 80 }}
        >
          <div
            className="card"
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            onClick={(event) => event.stopPropagation()}
            style={{ width: "min(680px, 92vw)", padding: 0, overflow: "hidden" }}
          >
            <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "var(--hair)" }}>
              {loading ? <Loader2 className="animate-spin" style={{ width: 17, height: 17, color: "var(--slate-400)" }} /> : <Search style={{ width: 17, height: 17, color: "var(--slate-400)" }} />}
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Search clients, touches, commitments, tickets, brief sections, pages…"
                aria-label="Search"
                style={{
                  flex: 1,
                  border: 0,
                  outline: "none",
                  background: "transparent",
                  color: "var(--text)",
                  fontSize: "0.95rem",
                }}
              />
              <span className="kbd">Esc</span>
            </div>

            <div ref={listRef} style={{ maxHeight: "58vh", overflow: "auto", padding: "8px 8px 12px" }}>
              {error ? (
                <p role="alert" className="px-3 py-4 text-[0.84rem]" style={{ color: "var(--risk)" }}>
                  {error}
                </p>
              ) : null}

              {searching && unavailable.length ? (
                <p className="muted px-3 pb-1 pt-2 text-[0.78rem]">
                  Could not read {unavailable.join(", ")}, so those are missing from these results rather than empty.
                </p>
              ) : null}

              {!error && searching && !shown.length && !loading ? (
                <p className="muted px-3 py-4 text-[0.84rem]">
                  Nothing matches “{query.trim()}”.
                </p>
              ) : null}

              {shown.map((group, groupIndex) => (
                <div key={group.id} className="mt-2">
                  <div className="eyebrow muted px-3 pb-1">{group.label}</div>
                  {group.hits.map((item, rowIndex) => {
                    const index = (offsets[groupIndex] || 0) + rowIndex;
                    const on = index === active;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-index={index}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => go(item)}
                        className="list-row w-full items-start text-left"
                        style={{
                          background: on ? "var(--accent-soft)" : "transparent",
                          borderRadius: 10,
                          border: 0,
                          cursor: "pointer",
                        }}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[0.87rem] font-semibold" style={{ color: "var(--text)" }}>
                            <Highlighted text={item.title} ranges={item.titleRanges} />
                          </span>
                          {item.subtitle ? (
                            <span className="muted block truncate text-[0.79rem]">
                              <Highlighted text={item.subtitle} ranges={item.subtitleRanges} />
                            </span>
                          ) : null}
                        </span>
                        {item.chips?.length ? (
                          <span className="flex shrink-0 flex-wrap gap-1">
                            {item.chips.filter(Boolean).map((chip) => (
                              <span key={chip} className="chip muted">
                                {chip}
                              </span>
                            ))}
                          </span>
                        ) : null}
                        {on ? <CornerDownLeft style={{ width: 15, height: 15, color: "var(--slate-400)", flexShrink: 0 }} /> : null}
                      </button>
                    );
                  })}
                  {group.more ? (
                    <div className="muted px-3 pt-1 text-[0.76rem]">and {group.more} more</div>
                  ) : null}
                </div>
              ))}
            </div>

            <div
              className="muted flex items-center gap-3 border-t px-4 py-2 text-[0.74rem]"
              style={{ borderColor: "var(--hair)" }}
            >
              <span>↑↓ to move</span>
              <span>Enter to open</span>
              <span>Esc to close</span>
              <span className="ml-auto">/ opens this too</span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
