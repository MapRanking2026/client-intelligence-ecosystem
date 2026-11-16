"use client";

import { useSyncExternalStore } from "react";
import { Highlighter } from "lucide-react";

import { applyHighlightFacts, subscribeToAppearance } from "@/src/lib/appearance";
import { savePreference } from "@/src/lib/save-preference";

/**
 * The header's "Highlight facts" switch, saved against the account like the theme is.
 *
 * Applied to the document first, saved after, for the same reason the theme toggle does it in
 * that order: the switch has to feel instant, and a failed save must not undo what the AM pressed.
 */
export function AnnotationsToggle() {
  const on = useSyncExternalStore(
    subscribeToAppearance,
    () => document.documentElement.getAttribute("data-annotations") === "on",
    () => false,
  );

  function toggle() {
    const next = !on;
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
