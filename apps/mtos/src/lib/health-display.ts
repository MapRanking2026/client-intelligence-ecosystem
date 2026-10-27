import type { HealthTone } from "@/src/lib/mtos-data";

/**
 * One definition of how client health is rendered, shared by every screen.
 *
 * These maps previously existed as four near-identical copies (command centre, client roster, client
 * workspace, client hint). Copies drift, and a tone or threshold corrected in one place left the
 * others showing a different read of the same client -- which is how the app came to disagree with
 * itself about who was healthy.
 */
export type ToneClass = "good" | "watch" | "risk" | "muted";

export const TONE_CLASS: Record<HealthTone, ToneClass> = {
  excellent: "good",
  healthy: "good",
  needs_attention: "watch",
  at_risk: "risk",
  critical: "risk",
  unknown: "muted",
};

export const TONE_LABEL: Record<HealthTone, string> = {
  excellent: "Excellent",
  healthy: "Healthy",
  needs_attention: "Needs attention",
  at_risk: "At risk",
  critical: "Critical",
  unknown: "Not assessed",
};

/**
 * Triage order, worst first. "unknown" ranks after every assessed tone: an unassessed account is a
 * gap to fill, not an emergency, and ordering it as one buried the genuinely at-risk accounts.
 */
export const TONE_SEVERITY: Record<HealthTone, number> = {
  critical: 0,
  at_risk: 1,
  needs_attention: 2,
  healthy: 3,
  excellent: 4,
  unknown: 5,
};

/** True when something actually judged this account, as opposed to no health value existing. */
export function isAssessedTone(tone: HealthTone) {
  return tone !== "unknown";
}

/** Tones that should appear in an "needs attention" queue. Excludes unassessed accounts. */
export function needsAttention(tone: HealthTone) {
  return tone === "critical" || tone === "at_risk" || tone === "needs_attention";
}

/** Renders a possibly-absent score. An em dash reads as "no data" where a 0 would read as a verdict. */
export function formatScore(value: number | null) {
  return value === null ? "—" : String(value);
}

export function scoreToneClass(value: number | null): ToneClass {
  if (value === null) return "muted";
  if (value >= 75) return "good";
  if (value >= 60) return "watch";
  return "risk";
}

/**
 * Averages only the clients that have a score, and reports how many that was, so a portfolio figure
 * can say what it is based on instead of silently treating missing scores as zero.
 */
export function averageScore(values: (number | null)[]): { value: number | null; counted: number } {
  const present = values.filter((value): value is number => value !== null);
  if (!present.length) {
    return { value: null, counted: 0 };
  }
  return {
    value: Math.round(present.reduce((sum, value) => sum + value, 0) / present.length),
    counted: present.length,
  };
}
