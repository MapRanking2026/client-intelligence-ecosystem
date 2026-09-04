"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.getAttribute("data-theme") === "dark");
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    try {
      localStorage.setItem("mtos-theme", next ? "dark" : "light");
    } catch {
      /* ignore */
    }
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
