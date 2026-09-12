/**
 * Native on-page SEO audit — fetches the client's homepage and checks the core
 * technical/on-page signals. No external crawl license needed. Read-only fetch
 * of a public page; never fabricates results.
 */
export interface OnPageAudit {
  ok: boolean;
  error?: string;
  url?: string;
  finalUrl?: string;
  status?: number;
  https?: boolean;
  title?: string;
  titleLength?: number;
  metaDescription?: string;
  metaDescriptionLength?: number;
  h1Count?: number;
  hasCanonical?: boolean;
  hasViewport?: boolean;
  robotsNoindex?: boolean;
  wordCount?: number;
  checks: Array<{ label: string; status: "pass" | "warn" | "fail"; detail?: string }>;
}

/** On-page thresholds, normally sourced from the Rule Library (content.* keys). */
export interface AuditThresholds {
  titleRange: [number, number];
  metaRange: [number, number];
  h1Count: number;
}

const DEFAULT_THRESHOLDS: AuditThresholds = {
  titleRange: [55, 60],
  metaRange: [150, 160],
  h1Count: 1,
};

function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

/** pass within [lo,hi], warn if present but outside (soft, per 6.5), fail if missing. */
function rangeStatus(len: number | undefined, [lo, hi]: [number, number]): "pass" | "warn" | "fail" {
  if (len == null) return "fail";
  return len >= lo && len <= hi ? "pass" : "warn";
}

function attr(html: string, re: RegExp): string | undefined {
  const m = html.match(re);
  return m?.[1]?.trim();
}

export async function auditUrl(rawUrl: string, thresholds: AuditThresholds = DEFAULT_THRESHOLDS): Promise<OnPageAudit> {
  if (!rawUrl?.trim()) {
    return { ok: false, error: "This client has no website set.", checks: [] };
  }
  const { titleRange, metaRange, h1Count: h1Target } = thresholds;
  const url = normalizeUrl(rawUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "SEOOS-Audit/1.0 (+seo audit)" },
      cache: "no-store",
    });
    const finalUrl = res.url || url;
    const html = await res.text();

    const title = attr(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const metaDescription = attr(
      html,
      /<meta[^>]+name=["']description["'][^>]*content=["']([\s\S]*?)["']/i,
    );
    const h1Count = (html.match(/<h1[\s>]/gi) ?? []).length;
    const hasCanonical = /<link[^>]+rel=["']canonical["']/i.test(html);
    const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
    const robotsNoindex = /<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const wordCount = text ? text.split(" ").length : 0;
    const https = finalUrl.startsWith("https://");

    const checks: OnPageAudit["checks"] = [];
    checks.push({ label: "Reachable (HTTP 200)", status: res.ok ? "pass" : "fail", detail: `Status ${res.status}` });
    checks.push({ label: "HTTPS", status: https ? "pass" : "fail" });
    checks.push({
      label: "Title tag",
      status: rangeStatus(title?.length, titleRange),
      detail: title ? `${title.length} chars (target ${titleRange[0]}-${titleRange[1]})` : "missing",
    });
    checks.push({
      label: "Meta description",
      status: rangeStatus(metaDescription?.length, metaRange),
      detail: metaDescription ? `${metaDescription.length} chars (target ${metaRange[0]}-${metaRange[1]})` : "missing",
    });
    checks.push({
      label: `H1 count (${h1Target} expected)`,
      status: h1Count === h1Target ? "pass" : h1Count === 0 ? "fail" : "warn",
      detail: `${h1Count} found`,
    });
    checks.push({ label: "Canonical tag", status: hasCanonical ? "pass" : "warn" });
    checks.push({ label: "Mobile viewport", status: hasViewport ? "pass" : "fail" });
    checks.push({ label: "Indexable (no noindex)", status: robotsNoindex ? "fail" : "pass" });
    checks.push({
      label: "Content depth",
      status: wordCount >= 500 ? "pass" : wordCount >= 200 ? "warn" : "fail",
      detail: `${wordCount} words`,
    });

    return {
      ok: true,
      url,
      finalUrl,
      status: res.status,
      https,
      title,
      titleLength: title?.length,
      metaDescription,
      metaDescriptionLength: metaDescription?.length,
      h1Count,
      hasCanonical,
      hasViewport,
      robotsNoindex,
      wordCount,
      checks,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "fetch_failed", url, checks: [] };
  } finally {
    clearTimeout(timeout);
  }
}
