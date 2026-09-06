"use client";

import { useEffect, useState } from "react";

const Highlighter = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 11l-6 6v3h3l6-6" />
    <path d="M14 5l5 5" />
    <path d="M17 2l5 5-9 9-5-5z" />
  </svg>
);

export function AnnotationsToggle() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    setOn(document.documentElement.getAttribute("data-annotations") === "on");
  }, []);

  function toggle() {
    const next = !on;
    setOn(next);
    if (next) document.documentElement.setAttribute("data-annotations", "on");
    else document.documentElement.removeAttribute("data-annotations");
    try {
      localStorage.setItem("seoos-annotations", next ? "on" : "off");
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent("seoos-annotations", { detail: next }));
  }

  return (
    <button
      className={`icon-btn ${on ? "on" : ""}`}
      onClick={toggle}
      aria-label="Toggle highlighter"
      aria-pressed={on}
      title={on ? "Highlighter on — key figures highlighted" : "Highlighter off"}
      type="button"
    >
      <Highlighter />
    </button>
  );
}
