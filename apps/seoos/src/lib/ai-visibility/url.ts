/** URL helpers shared by extraction, citations and website suggestions. */

const TRACKING_PARAMS = /^(utm_|gclid$|fbclid$|msclkid$|mc_|ref$|ref_src$|srsltid$)/i;

/** Lowercase host without a leading "www.". Returns "" for unparsable input. */
export function hostOf(raw: string): string {
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Normalize a bare domain input ("https://www.Foo.com/bar" → "foo.com"). */
export function normalizeDomain(raw: string): string {
  return hostOf(raw.trim());
}

/** True when `host` is `domain` or a subdomain of it. */
export function hostMatchesDomain(host: string, domain: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  const d = domain.toLowerCase().replace(/^www\./, "");
  if (!h || !d) return false;
  return h === d || h.endsWith(`.${d}`);
}

/**
 * Canonical form used to deduplicate citations: https scheme, no www, no
 * fragment, tracking params removed, no trailing slash.
 */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    const keep = new URLSearchParams();
    for (const [k, v] of u.searchParams) if (!TRACKING_PARAMS.test(k)) keep.append(k, v);
    const qs = keep.toString();
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    let path = u.pathname.replace(/\/+$/, "");
    if (!path) path = "";
    return `https://${host}${path}${qs ? `?${qs}` : ""}`;
  } catch {
    return raw.trim();
  }
}

/** Only http(s) URLs may be rendered as links (never javascript:, data:, …). */
export function isSafeHttpUrl(raw: string | undefined): raw is string {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
