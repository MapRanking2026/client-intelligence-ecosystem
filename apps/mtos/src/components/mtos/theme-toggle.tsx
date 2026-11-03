"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { applyTheme } from "@/src/lib/appearance";
import { savePreference } from "@/src/lib/save-preference";

/**
 * The header's light/dark switch.
 *
 * It writes the AM's saved preference as well as this browser's, so the theme follows them to
 * another computer. The attribute and local storage are set first and the save is sent after: a
 * theme switch has to feel instant, and a failed save should leave the switch they just pressed
 * looking pressed rather than snapping back.
 *
 * Only Light and Dark are offered here. `System` exists as a preference and is chosen in Settings,
 * because a two-state button cannot express a third state and a three-state header button is a
 * worse version of the dropdown that already exists.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.getAttribute("data-theme") === "dark");
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    const theme = next ? "dark" : "light";
    applyTheme(theme);
    void savePreference({ theme });
  }

  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      aria-label="Toggle light / dark theme"
      title={dark ? "Switch to light" : "Switch to dark"}
      type="button"
    >
      {dark ? <Sun /> : <Moon />}
    </button>
  );
}
