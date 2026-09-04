"use client";

import { useEffect, useState } from "react";
import { Highlighter } from "lucide-react";

export function AnnotationsToggle() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    setOn(document.documentElement.getAttribute("data-annotations") === "on");
  }, []);

  function toggle() {
    const next = !on;
    setOn(next);
    if (next) {
      document.documentElement.setAttribute("data-annotations", "on");
    } else {
      document.documentElement.removeAttribute("data-annotations");
    }
    try {
      localStorage.setItem("mtos-annotations", next ? "on" : "off");
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      className={`icon-btn ${on ? "on" : ""}`}
      onClick={toggle}
      aria-label="Toggle annotations"
      aria-pressed={on}
      title={on ? "Annotations on" : "Annotations off"}
      type="button"
    >
      <Highlighter />
    </button>
  );
}
