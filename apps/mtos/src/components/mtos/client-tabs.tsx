"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

interface Tab {
  id: string;
  label: string;
  content: ReactNode;
}

export function ClientTabs({ tabs }: { tabs: Tab[] }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const barRef = useRef<HTMLDivElement>(null);

  const indexFromUrl = () => {
    const id = params.get("tab");
    const i = tabs.findIndex((t) => t.id === id);
    return i >= 0 ? i : 0;
  };
  const [active, setActive] = useState(indexFromUrl);

  // Follow ?tab= changes (e.g. arriving from an internal link elsewhere) and
  // gently scroll the tabs into view so the destination isn't hidden below the fold.
  useEffect(() => {
    const i = indexFromUrl();
    if (i !== active) {
      setActive(i);
      barRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  function select(i: number, id: string) {
    setActive(i);
    const next = new URLSearchParams(params.toString());
    next.set("tab", id);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <div className="mt-6" ref={barRef}>
      <div className="segtabs">
        {tabs.map((t, i) => (
          <button
            key={t.id}
            type="button"
            className={`segtab ${i === active ? "active" : ""}`}
            onClick={() => select(i, t.id)}
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
