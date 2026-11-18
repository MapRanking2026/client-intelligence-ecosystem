import type { PresentationSlide } from "@/src/lib/mtos-data";

/**
 * The two things an account manager can have in front of them while a slide is on the client's
 * screen, and the difference between them.
 *
 * **Notes** are reminders: what this slide is about, the caveat to respect, the number to
 * reconcile before claiming anything. They are written to be *read*, so they are shown as bullets
 * -- a paragraph of prose on a live call is something the AM has to parse while a client waits.
 *
 * **The script** is the words themselves. Not a summary of what to cover, not stage directions:
 * the actual sentences, which an AM can read aloud as they stand and sound like themselves. That
 * is why it is generated separately from the deck and held separately on the slide. The deck says
 * what is true; the script says it out loud, in the second person, in terms of what the figures
 * mean for the client's own business.
 *
 * Both are presenter-side only. Neither ever renders on the client screen -- see the client-screen
 * component and the full-screen surface in presentation-viewer.
 */

export const SCRIPT_LIMITS = {
  /** Roughly 90 seconds of speech. Longer than this and the AM is reading, not presenting. */
  perSlide: 1600,
  bullet: 300,
  bullets: 12,
} as const;

/**
 * Presenter notes as scannable bullets.
 *
 * Every sentence survives as its own bullet rather than being condensed: a note that said
 * "reconcile the check-in figure before saying more" is exactly the kind of caveat a shortened
 * summary drops, and dropping it on a live call is how a client hears a number nobody verified.
 * The job here is to make the notes readable at a glance, not to decide what matters.
 */
export function notesBullets(notes: string | undefined): string[] {
  if (!(notes || "").trim()) return [];
  return (notes || "")
    .split(/\n+/)
    .flatMap((line) =>
      // Split on sentence ends, but not on the dot inside "Nov 17, 2026." style dates or "e.g."
      line.split(/(?<=[.!?])\s+(?=[A-Z0-9“"'])/),
    )
    .map((line) => line.replace(/^[\s•\-*]+/, "").trim())
    .filter(Boolean)
    .map((line) => (line.length > SCRIPT_LIMITS.bullet ? `${line.slice(0, SCRIPT_LIMITS.bullet - 1)}…` : line))
    .slice(0, SCRIPT_LIMITS.bullets);
}

/** The script split into the paragraphs it is read in. Blank lines are the speaker's breaths. */
export function scriptParagraphs(script: string | undefined): string[] {
  if (!(script || "").trim()) return [];
  return (script || "")
    .split(/\n{2,}/)
    .map((block) => block.replace(/\s+\n/g, "\n").trim())
    .filter(Boolean);
}

/** Roughly how long this script takes to say, at an unhurried 140 words a minute. */
export function speakingSeconds(script: string | undefined): number {
  const words = (script || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.round((words / 140) * 60);
}

export function formatSpeakingTime(script: string | undefined): string {
  const seconds = speakingSeconds(script);
  if (!seconds) return "";
  if (seconds < 60) return `about ${seconds}s to say`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `about ${minutes}m${rest ? ` ${rest}s` : ""} to say`;
}

/** True when any slide in the deck still has no spoken script. */
export function slidesMissingScript(slides: PresentationSlide[] | undefined): number {
  return (slides || []).filter((slide) => !(slide.presenterScript || "").trim()).length;
}
