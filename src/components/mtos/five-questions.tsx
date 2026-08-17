"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export interface QStep {
  n: number;
  title: string;
  tone: "good" | "watch" | "risk" | "info";
  summary: string;
  content: ReactNode;
}

export function FiveQuestions({ steps }: { steps: QStep[] }) {
  const [open, setOpen] = useState(0);

  return (
    <div className="qflow">
      {steps.map((s, i) => {
        const isOpen = i === open;
        return (
          <div key={s.n} className={`qstep ${isOpen ? "open" : ""}`}>
            <button type="button" className="qstep-head" onClick={() => setOpen(isOpen ? -1 : i)}>
              <div className="qstep-num">{s.n}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="h4" style={{ fontSize: "1.02rem" }}>
                    {s.title}
                  </span>
                  <span className={`sig-dot ${s.tone === "info" ? "" : s.tone}`} style={s.tone === "info" ? { background: "var(--info)" } : undefined} />
                </div>
                <div className="muted mt-1 text-[0.82rem]">{s.summary}</div>
              </div>
              <span className="chev">
                <ChevronDown style={{ width: 18, height: 18 }} />
              </span>
            </button>
            {isOpen ? <div className="qstep-body">{s.content}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
