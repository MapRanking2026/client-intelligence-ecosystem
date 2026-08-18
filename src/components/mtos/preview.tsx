"use client";

import { useRef, useState, type ReactNode } from "react";

/**
 * §9 — a small contextual preview shown on hover/focus of a key reference.
 * Use selectively. Content and trigger are passed in so it stays presentational.
 */
export function Preview({ children, content }: { children: ReactNode; content: ReactNode }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show() {
    if (timer.current) clearTimeout(timer.current);
    setOpen(true);
  }
  function hide() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 130);
  }

  return (
    <span className="hint-wrap" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      <span className={`hint-pop ${open ? "on" : ""}`} role="tooltip" onMouseEnter={show} onMouseLeave={hide}>
        {content}
      </span>
    </span>
  );
}
