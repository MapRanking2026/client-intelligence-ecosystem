"use client";

import { useEffect, useState } from "react";
import { Highlighter } from "lucide-react";

import { applyHighlightFacts } from "@/src/lib/appearance";
import { savePreference } from "@/src/lib/save-preference";

/**
 * The header's "Highlight facts" switch, saved against the account like the theme is.
 *
 * Applied to the document first, saved after, for the same reason the theme toggle does it in
 * that order: the switch has to feel instant, and a failed save must not undo what the AM pressed.
 */
export function AnnotationsToggle() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    setOn(document.documentElement.getAttribute("data-annotations") === "on");
  }, []);

  function toggle() {
    const next = !on;
    setOn(next);
    applyHighlightFacts(next);
    void savePreference({ highlightFacts: next });
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
