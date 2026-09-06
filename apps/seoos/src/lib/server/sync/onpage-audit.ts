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

function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

function attr(html: string, re: RegExp): string | undefined {
  const m = html.match(re);
  return m?.[1]?.trim();
}

export async function auditUrl(rawUrl: string): Promise<OnPageAudit> {
  if (!rawUrl?.trim()) {
    return { ok: false, error: "This client has no website set.", checks: [] };
  }
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
      status: !title ? "fail" : title.length < 15 || title.length > 65 ? "warn" : "pass",
      detail: title ? `${title.length} chars` : "missing",
    });
    checks.push({
      label: "Meta description",
      status: !metaDescription ? "fail" : metaDescription.length < 50 || metaDescription.length > 165 ? "warn" : "pass",
      detail: metaDescription ? `${metaDescription.length} chars` : "missing",
    });
    checks.push({
      label: "Single H1",
      status: h1Count === 1 ? "pass" : h1Count === 0 ? "fail" : "warn",
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
