import { createHash } from "node:crypto";

/** Stable short hash for deterministic ids / fingerprints. */
export function stableHash(input: string, len = 24): string {
  return createHash("sha256").update(input).digest("hex").slice(0, len);
}

/** Canonical JSON (sorted keys) so fingerprints don't depend on key order. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * Exponential backoff with full jitter: random in [0, min(cap, base·2^attempt)].
 * A provider Retry-After (ms) acts as a floor.
 */
export function backoffMs(attempt: number, opts: { baseMs?: number; capMs?: number; retryAfterMs?: number; random?: () => number } = {}): number {
  const base = opts.baseMs ?? 2000;
  const cap = opts.capMs ?? 120000;
  const rnd = opts.random ?? Math.random;
  const ceiling = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  const jittered = Math.floor(rnd() * ceiling);
  return Math.max(jittered, opts.retryAfterMs ?? 0, 250);
}

/** RFC 4180 CSV cell; also neutralizes spreadsheet formula injection. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n");
}

export function pct(v: number | null | undefined, digits = 0): string {
  return v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`;
}

export function usd(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v < 0.01 && v > 0 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

/** ISO week key, e.g. 2026-W43 (scheduler period). */
export function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
