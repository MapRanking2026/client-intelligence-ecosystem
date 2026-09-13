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
  error?: string;
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

function attr(html: string, re: RegExp): string | undefined {
  const m = html.match(re);
  return m?.[1]?.trim();
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
