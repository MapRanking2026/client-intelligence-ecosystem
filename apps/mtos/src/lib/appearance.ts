import type { ThemeChoice } from "@/src/lib/contracts/user-preferences";

/**
 * The two preferences that change what the page looks like, applied in the browser.
 *
 * These live apart from the rest of the preference code because of the pre-paint script in the
 * root layout. That script runs during HTML parsing, reads local storage and sets the attributes
 * before the first paint -- which is the only way to avoid a flash of the wrong theme on a hard
 * navigation. It cannot read Firestore. So the saved preference is mirrored into local storage,
 * and the script keeps being the thing that applies it on the way in.
 *
 * Which makes the account the source of truth and local storage a cache of it: `applyAppearance`
 * is called with the saved preferences when the chrome mounts, and again when Settings saves.
 */

export const THEME_STORAGE_KEY = "mtos-theme";
export const ANNOTATIONS_STORAGE_KEY = "mtos-annotations";

/** What `system` means right now. Light when the browser has no opinion. */
export function resolveSystemTheme(): "light" | "dark" {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function effectiveTheme(choice: ThemeChoice): "light" | "dark" {
  return choice === "system" ? resolveSystemTheme() : choice;
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A browser with storage blocked still gets the attribute; only the no-flash pre-paint path
    // is lost, and that degrades to a light first paint.
  }
}

/**
 * Apply the theme and mirror the AM's *choice* into local storage.
 *
 * `system` is stored as `system`, never as the colour it resolved to: storing the resolved colour
 * would freeze the choice at whatever the device happened to be set to that day.
 */
export function applyTheme(choice: ThemeChoice) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", effectiveTheme(choice));
  remember(THEME_STORAGE_KEY, choice);
}

export function applyHighlightFacts(on: boolean) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (on) {
    root.setAttribute("data-annotations", "on");
  } else {
    root.removeAttribute("data-annotations");
  }
  remember(ANNOTATIONS_STORAGE_KEY, on ? "on" : "off");
}

/**
 * Both at once, for the two callers that know both values: the chrome on mount, and Settings
 * after a save. The header's toggles each call only their own, so pressing the highlight switch
 * cannot quietly rewrite a `system` theme into the colour it is showing right now.
 */
export function applyAppearance(preferences: { theme: ThemeChoice; highlightFacts: boolean }) {
  applyTheme(preferences.theme);
  applyHighlightFacts(preferences.highlightFacts);
}
