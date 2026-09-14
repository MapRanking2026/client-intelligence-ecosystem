/**
 * Bounded same-origin site crawler. Read-only: fetches a client's own public
 * pages (inbound reads, no outbound mutation) and returns per-page on-page SEO
 * signals plus the internal links it found. This is the data layer the deeper
 * technical audit (M4) and cross-page pattern recognition (M6.10) build on —
 * neither of which the single-page homepage audit can see.
 *
 * It is deliberately conservative: same registrable origin only, a hard page
 * cap, a per-page timeout, a total wall-clock budget, dedupe by pathname (so
 * faceted/query-string crawler traps can't blow the budget), and it skips
 * non-HTML assets. It never fabricates — a page that fails to fetch is recorded
 * with its error, not guessed.
 */

export interface CrawledPage {
  url: string;
  /** Clicks from the homepage (BFS depth). Homepage = 0. */
  depth: number;
  status: number;
  ok: boolean;
  contentType?: string;
  https: boolean;
  title?: string;
  titleLength?: number;
  metaDescription?: string;
  metaDescriptionLength?: number;
  h1Count?: number;
  hasCanonical: boolean;
  canonicalUrl?: string;
  robotsNoindex: boolean;
  wordCount?: number;
  /** Count of same-origin links found on this page. */
  internalLinks: number;
  /** Normalized phone numbers found on the page (from tel: links + JSON-LD). */
  phones: string[];
  /** Structured NAP from JSON-LD LocalBusiness/Organization, if present. */
  structuredNap?: StructuredNap;
  error?: string;
}

export interface StructuredNap {
  name?: string;
  telephone?: string;
  street?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
}

/** Digits-only US-normalized phone key (drops a leading country 1). Empty if unusable. */
export function normalizePhone(raw: string): string {
  const d = (raw || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) return d.slice(1);
  return d.length >= 7 ? d : "";
}

export interface CrawlResult {
  ok: boolean;
  error?: string;
  startUrl: string;
  finalStartUrl?: string;
  origin?: string;
  pages: CrawledPage[];
  pagesCrawled: number;
  /** Same-origin URLs discovered but not fetched (cap/budget/depth reached). */
  discoveredNotCrawled: number;
  reachedCap: boolean;
  cap: number;
  durationMs: number;
}

export interface CrawlOptions {
  /** Max pages to fetch. Default 30. */
  maxPages?: number;
  /** Max BFS depth to follow. Default 4. */
  maxDepth?: number;
  /** Per-page fetch timeout (ms). Default 12000. */
  perPageTimeoutMs?: number;
  /** Total wall-clock budget (ms). Default 55000 (route maxDuration is 60s). */
  totalBudgetMs?: number;
  /** Concurrent fetches. Default 4. */
  concurrency?: number;
}

const SKIP_EXT =
  /\.(jpe?g|png|gif|svg|webp|avif|ico|css|js|mjs|json|xml|rss|pdf|zip|gz|tar|mp4|webm|mov|mp3|wav|woff2?|ttf|otf|eot|dmg|exe|csv|xlsx?|docx?|pptx?)(\?|#|$)/i;

function normalizeStart(raw: string): string {
  const t = raw.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/** Dedupe key: origin + pathname, no trailing slash (root kept), query/hash dropped. */
function canonKey(u: URL): string {
  let path = u.pathname.replace(/\/+$/, "");
  if (path === "") path = "/";
  return `${u.origin}${path.toLowerCase()}`;
}

/** Public canonical key for a raw URL string (same rule the crawler dedupes on). */
export function canonicalKey(rawUrl: string): string | null {
  try {
    return canonKey(new URL(rawUrl));
  } catch {
    return null;
  }
}

function attr(html: string, re: RegExp): string | undefined {
  const m = html.match(re);
  return m?.[1]?.trim();
}

/** Walk a parsed JSON-LD value for the first node carrying NAP fields. */
function findNapNode(node: unknown): StructuredNap | undefined {
  if (!node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findNapNode(item);
      if (hit) return hit;
    }
    return undefined;
  }
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj["@graph"])) {
    const hit = findNapNode(obj["@graph"]);
    if (hit) return hit;
  }
  const telephone = typeof obj.telephone === "string" ? obj.telephone : undefined;
  const addr = obj.address;
  const hasNap = telephone || (addr && typeof addr === "object");
  if (hasNap) {
    const a = (typeof addr === "object" && addr ? addr : {}) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === "string" ? v : undefined);
    return {
      name: s(obj.name),
      telephone,
      street: s(a.streetAddress),
      locality: s(a.addressLocality),
      region: s(a.addressRegion),
      postalCode: s(a.postalCode),
    };
  }
  // Recurse into nested objects (e.g. a wrapper with a nested LocalBusiness).
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") {
      const hit = findNapNode(v);
      if (hit) return hit;
    }
  }
  return undefined;
}

function extractNap(html: string): { phones: string[]; structuredNap?: StructuredNap } {
  const phoneSet = new Set<string>();
  // tel: links are the reliable phone signal (visible-text patterns are too noisy).
  const telRe = /href=["']tel:([^"']+)["']/gi;
  let t: RegExpExecArray | null;
  while ((t = telRe.exec(html)) !== null) {
    const n = normalizePhone(decodeURIComponent(t[1]));
    if (n) phoneSet.add(n);
  }
  // JSON-LD LocalBusiness/Organization structured NAP.
  let structuredNap: StructuredNap | undefined;
  const ldRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = ldRe.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const nap = findNapNode(parsed);
      if (nap) {
        if (!structuredNap) structuredNap = nap;
        if (nap.telephone) {
          const n = normalizePhone(nap.telephone);
          if (n) phoneSet.add(n);
        }
      }
    } catch {
      /* invalid JSON-LD — skip */
    }
  }
  return { phones: [...phoneSet], structuredNap };
}

function analyze(html: string): Pick<
  CrawledPage,
  | "title"
  | "titleLength"
  | "metaDescription"
  | "metaDescriptionLength"
  | "h1Count"
  | "hasCanonical"
  | "canonicalUrl"
  | "robotsNoindex"
  | "wordCount"
  | "phones"
  | "structuredNap"
> & { links: string[] } {
  const title = attr(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescription = attr(
    html,
    /<meta[^>]+name=["']description["'][^>]*content=["']([\s\S]*?)["']/i,
  );
  const h1Count = (html.match(/<h1[\s>]/gi) ?? []).length;
  const canonicalUrl = attr(html, /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  const robotsNoindex = /<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const wordCount = text ? text.split(" ").length : 0;
  const { phones, structuredNap } = extractNap(html);

  const links: string[] = [];
  const linkRe = /<a\b[^>]*\shref=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1].trim();
    if (!href || /^(mailto:|tel:|javascript:|#|data:)/i.test(href)) continue;
    links.push(href);
  }

  return {
    title,
    titleLength: title?.length,
    metaDescription,
    metaDescriptionLength: metaDescription?.length,
    h1Count,
    hasCanonical: Boolean(canonicalUrl),
    canonicalUrl,
    robotsNoindex,
    wordCount,
    phones,
    structuredNap,
    links,
  };
}

async function fetchPage(
  url: string,
  depth: number,
  timeoutMs: number,
): Promise<{ page: CrawledPage; sameOriginLinks: URL[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const origin = new URL(url).origin;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "SEOOS-Audit/1.0 (+seo site audit; read-only)" },
      cache: "no-store",
    });
    const finalUrl = res.url || url;
    const contentType = res.headers.get("content-type") ?? undefined;
    const isHtml = !contentType || /text\/html|application\/xhtml/i.test(contentType);
    const https = finalUrl.startsWith("https://");

    if (!isHtml) {
      return {
        page: {
          url: finalUrl,
          depth,
          status: res.status,
          ok: res.ok,
          contentType,
          https,
          hasCanonical: false,
          robotsNoindex: false,
          internalLinks: 0,
          phones: [],
        },
        sameOriginLinks: [],
      };
    }

    const html = await res.text();
    const a = analyze(html);
    const sameOriginLinks: URL[] = [];
    for (const href of a.links) {
      try {
        const abs = new URL(href, finalUrl);
        if ((abs.protocol === "http:" || abs.protocol === "https:") && abs.origin === origin && !SKIP_EXT.test(abs.pathname + abs.search)) {
          sameOriginLinks.push(abs);
        }
      } catch {
        /* malformed href — skip */
      }
    }

    return {
      page: {
        url: finalUrl,
        depth,
        status: res.status,
        ok: res.ok,
        contentType,
        https,
        title: a.title,
        titleLength: a.titleLength,
        metaDescription: a.metaDescription,
        metaDescriptionLength: a.metaDescriptionLength,
        h1Count: a.h1Count,
        hasCanonical: a.hasCanonical,
        canonicalUrl: a.canonicalUrl,
        robotsNoindex: a.robotsNoindex,
        wordCount: a.wordCount,
        internalLinks: sameOriginLinks.length,
        phones: a.phones,
        structuredNap: a.structuredNap,
      },
      sameOriginLinks,
    };
  } catch (e) {
    return {
      page: {
        url,
        depth,
        status: 0,
        ok: false,
        https: url.startsWith("https://"),
        hasCanonical: false,
        robotsNoindex: false,
        internalLinks: 0,
        phones: [],
        error: e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message) : "fetch_failed",
      },
      sameOriginLinks: [],
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function crawlSite(rawUrl: string, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const started = Date.now();
  const cap = opts.maxPages ?? 30;
  const maxDepth = opts.maxDepth ?? 4;
  const perPageTimeoutMs = opts.perPageTimeoutMs ?? 12000;
  const totalBudgetMs = opts.totalBudgetMs ?? 55000;
  const concurrency = opts.concurrency ?? 4;

  if (!rawUrl?.trim()) {
    return { ok: false, error: "This client has no website set.", startUrl: "", pages: [], pagesCrawled: 0, discoveredNotCrawled: 0, reachedCap: false, cap, durationMs: 0 };
  }

  const startUrl = normalizeStart(rawUrl);
  let origin: string;
  try {
    origin = new URL(startUrl).origin;
  } catch {
    return { ok: false, error: "Invalid website URL.", startUrl, pages: [], pagesCrawled: 0, discoveredNotCrawled: 0, reachedCap: false, cap, durationMs: Date.now() - started };
  }

  const seen = new Set<string>();
  const pages: CrawledPage[] = [];
  let discoveredNotCrawled = 0;
  let finalStartUrl: string | undefined;

  // BFS frontier of {url, depth}. Dedupe by canonical key up front.
  let frontier: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }];
  seen.add(canonKey(new URL(startUrl)));

  while (frontier.length > 0 && pages.length < cap && Date.now() - started < totalBudgetMs) {
    const remaining = cap - pages.length;
    const batch = frontier.slice(0, Math.min(concurrency, remaining));
    frontier = frontier.slice(batch.length);

    const results = await Promise.all(batch.map((item) => fetchPage(item.url, item.depth, perPageTimeoutMs)));

    for (const { page, sameOriginLinks } of results) {
      if (!finalStartUrl) finalStartUrl = page.url;
      pages.push(page);
      const nextDepth = page.depth + 1;
      if (nextDepth > maxDepth) continue;
      for (const link of sameOriginLinks) {
        const key = canonKey(link);
        if (seen.has(key)) continue;
        seen.add(key);
        // Strip hash; keep path+search for the actual fetch.
        link.hash = "";
        frontier.push({ url: link.toString(), depth: nextDepth });
      }
    }
  }

  discoveredNotCrawled = frontier.length;
  const reachedCap = pages.length >= cap && discoveredNotCrawled > 0;

  return {
    ok: true,
    startUrl,
    finalStartUrl,
    origin,
    pages,
    pagesCrawled: pages.length,
    discoveredNotCrawled,
    reachedCap,
    cap,
    durationMs: Date.now() - started,
  };
}

export interface SitemapResult {
  found: boolean;
  /** Declared page URLs (deduped, capped). */
  urls: string[];
  /** Sitemap files actually read (robots.txt Sitemap: lines + /sitemap.xml). */
  sources: string[];
  truncated: boolean;
}

async function fetchText(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "SEOOS-Audit/1.0 (+seo site audit; read-only)" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const v = m[1].trim().replace(/&amp;/g, "&");
    if (v) out.push(v);
  }
  return out;
}

/**
 * Fetch the site's declared URL inventory from its sitemap(s). Read-only.
 * Reads robots.txt for Sitemap: directives, falls back to /sitemap.xml, and
 * resolves one level of sitemap-index nesting. Bounded on files, URLs, and time;
 * gzipped sitemaps (.xml.gz) are skipped (noted by the caller). Never fabricates
 * — returns found:false if no sitemap is readable.
 */
export async function fetchSitemap(
  rawUrl: string,
  opts: { maxUrls?: number; maxSitemaps?: number; perFetchTimeoutMs?: number } = {},
): Promise<SitemapResult> {
  const maxUrls = opts.maxUrls ?? 3000;
  const maxSitemaps = opts.maxSitemaps ?? 12;
  const timeoutMs = opts.perFetchTimeoutMs ?? 10000;
  const empty: SitemapResult = { found: false, urls: [], sources: [], truncated: false };
  if (!rawUrl?.trim()) return empty;

  let origin: string;
  try {
    origin = new URL(normalizeStart(rawUrl)).origin;
  } catch {
    return empty;
  }

  // 1) Candidate sitemap URLs: robots.txt Sitemap: lines, then /sitemap.xml.
  const candidates: string[] = [];
  const robots = await fetchText(`${origin}/robots.txt`, timeoutMs);
  if (robots) {
    for (const line of robots.split(/\r?\n/)) {
      const m = line.match(/^\s*sitemap:\s*(\S+)/i);
      if (m) candidates.push(m[1].trim());
    }
  }
  if (candidates.length === 0) candidates.push(`${origin}/sitemap.xml`);

  const sources: string[] = [];
  const urlSet = new Set<string>();
  let fetched = 0;
  let truncated = false;
  const queue = [...candidates];
  const seenSitemaps = new Set<string>();

  while (queue.length && fetched < maxSitemaps && urlSet.size < maxUrls) {
    const sm = queue.shift()!;
    if (seenSitemaps.has(sm) || /\.gz(\?|$)/i.test(sm)) continue;
    seenSitemaps.add(sm);
    const xml = await fetchText(sm, timeoutMs);
    fetched++;
    if (!xml) continue;
    sources.push(sm);
    const isIndex = /<sitemapindex[\s>]/i.test(xml);
    const locs = extractLocs(xml);
    if (isIndex) {
      for (const child of locs) if (!seenSitemaps.has(child)) queue.push(child);
    } else {
      for (const u of locs) {
        if (urlSet.size >= maxUrls) { truncated = true; break; }
        urlSet.add(u);
      }
    }
  }
  if (queue.length && (fetched >= maxSitemaps || urlSet.size >= maxUrls)) truncated = true;

  return { found: sources.length > 0, urls: [...urlSet], sources, truncated };
}
