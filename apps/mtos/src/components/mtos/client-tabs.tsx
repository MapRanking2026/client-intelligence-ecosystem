"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

interface Tab {
  id: string;
  label: string;
  content: ReactNode;
}

export function ClientTabs({ tabs }: { tabs: Tab[] }) {
  const params = useSearchParams();
  const barRef = useRef<HTMLDivElement>(null);

  const active = Math.max(0, tabs.findIndex((tab) => tab.id === params.get("tab")));
  const previousTab = useRef(active);

  useEffect(() => {
    if (previousTab.current !== active) {
      previousTab.current = active;
      barRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [active]);

  function select(id: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", id);
    window.history.replaceState(null, "", url);
  }

  return (
    <div className="mt-6" ref={barRef}>
      <div className="segtabs">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            type="button"
            className={`segtab ${i === active ? "active" : ""}`}
            onClick={() => select(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-6">
        {tabs.map((t, i) => (
          <div key={t.id} style={{ display: i === active ? "block" : "none" }}>
            {t.content}
          </div>
        ))}
      </div>
    </div>
  );
}
