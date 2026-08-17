"use client";

import { useState, type ReactNode } from "react";

interface Tab {
  id: string;
  label: string;
  content: ReactNode;
}

export function ClientTabs({ tabs }: { tabs: Tab[] }) {
  const [active, setActive] = useState(0);

  return (
    <div className="mt-6">
      <div className="segtabs">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            type="button"
            className={`segtab ${i === active ? "active" : ""}`}
            onClick={() => setActive(i)}
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
