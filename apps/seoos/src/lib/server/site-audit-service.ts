import type { AuthzContextV1 } from "@cie/contracts";

import type { SeoProjectV1 } from "@/src/lib/domain/project";
import { crawlSite, normalizePhone, type CrawledPage, type CrawlResult, type StructuredNap } from "@/src/lib/server/sync/site-crawler";
import { getRuleNumber, getRuleRange } from "@/src/lib/server/rules-service";

/**
 * Site-wide technical audit + cross-page pattern recognition (spec M4 deeper
 * technical, M6.10 recurring-issue detection). Crawls the client's own pages
 * (read-only), then finds the patterns a single-page audit can't: duplicate
 * titles/metas across pages, site-wide thin content, pages buried past the
 * click-depth limit, non-indexable pages, broken internal pages. Thresholds
 * come from the Rule Library so editing a rule changes what this flags.
 *
 * Honest about scope: it audits the pages it can reach from the homepage within
 * the crawl budget; it is not a full commercial crawler and says so.
 */
export type IssueSeverity = "high" | "medium" | "low";

export interface SiteIssue {
  severity: IssueSeverity;
  code: string;
  label: string;
  count: number;
  detail: string;
  /** A few example page URLs (capped) so the specialist can act. */
  examples: string[];
}

export interface SiteAudit {
  ok: boolean;
  error?: string;
  startUrl: string;
  origin?: string;
  pagesCrawled: number;
  discoveredNotCrawled: number;
  reachedCap: boolean;
  cap: number;
  durationMs: number;
  /** Rule-driven thresholds actually applied, echoed for transparency. */
  thresholds: { titleRange: [number, number]; metaRange: [number, number]; h1Count: number; maxDepthClicks: number; thinWords: number };
  summary: {
    indexablePages: number;
    noindexPages: number;
    brokenPages: number;
    avgWordCount: number;
    maxDepthSeen: number;
  };
  issues: SiteIssue[];
  nap: NapConsistency;
  pages: CrawledPage[];
  notes: string[];
}

/**
 * NAP (Name / Address / Phone) consistency — the read-only half of M5. SEOOS
 * holds no structured phone/address, so the client's own website is the
 * authoritative source: we read the phone (tel: links) and structured NAP
 * (JSON-LD LocalBusiness) it publishes, and check the site is internally
 * consistent. Building/submitting external citations (BrightLocal etc.) is
 * outbound and stays deferred — this produces the master NAP + alignment plan.
 */
export interface NapConsistency {
  canonicalName: string;
  targetPct: number;
  phones: Array<{ phone: string; display: string; pages: number }>;
  primaryPhone?: string;
  phoneConsistent: boolean;
  pagesWithPhone: number;
  pagesScanned: number;
  structuredNapPresent: boolean;
  structuredNap?: StructuredNap;
  nameMatchesStructured?: boolean;
  issues: string[];
  directoryChecklist: Array<{ name: string; note: string }>;
}

const EX_CAP = 6;

const CITATION_DIRECTORIES = [
  "Google Business Profile",
  "Bing Places",
  "Apple Business Connect",
  "Facebook Page",
  "Yelp",
  "Better Business Bureau",
  "YellowPages",
  "Foursquare",
];

function displayPhone(digits: string): string {
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : digits;
}

function napNorm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function completeness(n: StructuredNap): number {
  return [n.name, n.telephone, n.street, n.locality, n.region, n.postalCode].filter(Boolean).length;
}

function computeNap(htmlPages: CrawledPage[], businessName: string, targetPct: number): NapConsistency {
  // Phone: count how many pages each distinct number appears on.
  const phoneCounts = new Map<string, number>();
  let pagesWithPhone = 0;
  for (const p of htmlPages) {
    if (p.phones.length) pagesWithPhone++;
    for (const raw of p.phones) {
      const n = normalizePhone(raw);
      if (n) phoneCounts.set(n, (phoneCounts.get(n) ?? 0) + 1);
    }
  }
  const phones = [...phoneCounts.entries()]
    .map(([phone, pages]) => ({ phone, display: displayPhone(phone), pages }))
    .sort((a, b) => b.pages - a.pages);
  const primaryPhone = phones[0]?.display;
  const phoneConsistent = phones.length <= 1;

  // Structured NAP: pick the most complete JSON-LD node seen anywhere.
  let structuredNap: StructuredNap | undefined;
  for (const p of htmlPages) {
    if (p.structuredNap && (!structuredNap || completeness(p.structuredNap) > completeness(structuredNap))) {
      structuredNap = p.structuredNap;
    }
  }
  const structuredNapPresent = Boolean(structuredNap);
  const nameMatchesStructured = structuredNap?.name
    ? napNorm(structuredNap.name).includes(napNorm(businessName)) || napNorm(businessName).includes(napNorm(structuredNap.name))
    : undefined;

  const issues: string[] = [];
  if (phones.length > 1) {
    issues.push(`Site shows ${phones.length} different phone numbers (${phones.map((p) => p.display).join(", ")}). Pick one and make it consistent everywhere — the M5 target is ${targetPct}%.`);
  } else if (phones.length === 0) {
    issues.push("No phone number found on the site (no tel: link or JSON-LD telephone). Add a clickable phone so it can be verified against citations.");
  }
  if (!structuredNapPresent) {
    issues.push("No LocalBusiness structured data (JSON-LD) found — add it so Google reads the business name, address, and phone unambiguously.");
  } else if (nameMatchesStructured === false) {
    issues.push(`Structured-data business name "${structuredNap!.name}" differs from the tracked name "${businessName}". Align them before building citations.`);
  }
  if (!structuredNap?.street || !structuredNap?.postalCode) {
    issues.push("No full street address in structured data — the master NAP address can't be locked from the site alone. Confirm it from the client's records.");
  }

  const directoryChecklist = CITATION_DIRECTORIES.map((name) => ({
    name,
    note: "Match to the master NAP. Verification/submission runs after the outbound lock lifts (needs the citation tool).",
  }));

  return {
    canonicalName: businessName,
    targetPct,
    phones,
    primaryPhone,
    phoneConsistent,
    pagesWithPhone,
    pagesScanned: htmlPages.length,
    structuredNapPresent,
    structuredNap,
    nameMatchesStructured,
    issues,
    directoryChecklist,
  };
}

function examples(pages: CrawledPage[]): string[] {
  return pages.slice(0, EX_CAP).map((p) => p.url);
}

/** Group HTML pages by a normalized text value; return groups with >1 member. */
function duplicateGroups(pages: CrawledPage[], pick: (p: CrawledPage) => string | undefined): Map<string, CrawledPage[]> {
  const byValue = new Map<string, CrawledPage[]>();
  for (const p of pages) {
    const v = pick(p)?.trim().toLowerCase();
    if (!v) continue;
    (byValue.get(v) ?? byValue.set(v, []).get(v)!).push(p);
  }
  const dupes = new Map<string, CrawledPage[]>();
  for (const [v, group] of byValue) if (group.length > 1) dupes.set(v, group);
  return dupes;
}

export async function getSiteAudit(
  authz: AuthzContextV1,
  project: SeoProjectV1,
): Promise<SiteAudit> {
  const tenantId = authz.tenantId;
  const [titleRange, metaRange, h1Count, maxDepthClicks, napTargetPct] = await Promise.all([
    getRuleRange(tenantId, "content.meta_title.char_range", 55, 60),
    getRuleRange(tenantId, "content.meta_description.char_range", 150, 160),
    getRuleNumber(tenantId, "content.heading_rules.h1_count", 1),
    getRuleNumber(tenantId, "architecture.max_depth_clicks", 3),
    getRuleNumber(tenantId, "citations.nap_consistency_target_pct", 100),
  ]);
  const thinWords = 200;
  const thresholds = { titleRange, metaRange, h1Count, maxDepthClicks, thinWords };

  const crawl: CrawlResult = await crawlSite(project.website ?? "", {
    maxDepth: maxDepthClicks + 1, // one past the limit so we can flag pages that violate it
  });

  if (!crawl.ok) {
    return {
      ok: false,
      error: crawl.error,
      startUrl: crawl.startUrl,
      pagesCrawled: 0,
      discoveredNotCrawled: 0,
      reachedCap: false,
      cap: crawl.cap,
      durationMs: crawl.durationMs,
      thresholds,
      summary: { indexablePages: 0, noindexPages: 0, brokenPages: 0, avgWordCount: 0, maxDepthSeen: 0 },
      issues: [],
      nap: computeNap([], project.businessName, napTargetPct),
      pages: [],
      notes: [],
    };
  }

  const all = crawl.pages;
  const html = all.filter((p) => p.ok && (p.title !== undefined || p.wordCount !== undefined) && !p.contentType?.includes("json"));
  const reachable = all.filter((p) => p.ok);
  const broken = all.filter((p) => !p.ok);
  const noindex = html.filter((p) => p.robotsNoindex);
  // Indexable HTML pages are the population most on-page rules apply to.
  const indexable = html.filter((p) => !p.robotsNoindex);

  const issues: SiteIssue[] = [];

  // --- Broken / unreachable pages (linked internally but failed to load). ---
  if (broken.length) {
    issues.push({
      severity: "high",
      code: "broken_pages",
      label: "Broken or unreachable internal pages",
      count: broken.length,
      detail: "Pages linked from the site that returned an error or timed out. Fix the link or restore the page.",
      examples: broken.map((p) => `${p.url} (${p.error ?? p.status})`).slice(0, EX_CAP),
    });
  }

  // --- Non-HTTPS pages. ---
  const insecure = reachable.filter((p) => !p.https);
  if (insecure.length) {
    issues.push({
      severity: "high",
      code: "non_https",
      label: "Pages not served over HTTPS",
      count: insecure.length,
      detail: "Every page should load over HTTPS. Check redirects and mixed-content links.",
      examples: examples(insecure),
    });
  }

  // --- Duplicate title tags across pages (M6.10 pattern). ---
  const dupTitles = duplicateGroups(indexable, (p) => p.title);
  if (dupTitles.size) {
    const affected = [...dupTitles.values()].reduce((n, g) => n + g.length, 0);
    const ex = [...dupTitles.entries()].slice(0, 3).map(([v, g]) => `"${v.slice(0, 40)}" ×${g.length}`);
    issues.push({
      severity: "medium",
      code: "duplicate_titles",
      label: "Duplicate title tags",
      count: affected,
      detail: `${dupTitles.size} title${dupTitles.size === 1 ? "" : "s"} shared across ${affected} pages. Each page needs a unique title.`,
      examples: ex,
    });
  }

  // --- Duplicate meta descriptions across pages. ---
  const dupMetas = duplicateGroups(indexable, (p) => p.metaDescription);
  if (dupMetas.size) {
    const affected = [...dupMetas.values()].reduce((n, g) => n + g.length, 0);
    issues.push({
      severity: "low",
      code: "duplicate_metas",
      label: "Duplicate meta descriptions",
      count: affected,
      detail: `${dupMetas.size} meta description${dupMetas.size === 1 ? "" : "s"} reused across ${affected} pages.`,
      examples: [...dupMetas.values()].flatMap((g) => g.map((p) => p.url)).slice(0, EX_CAP),
    });
  }

  // --- Missing / out-of-range titles. ---
  const missingTitle = indexable.filter((p) => !p.title);
  if (missingTitle.length) {
    issues.push({ severity: "medium", code: "missing_title", label: "Missing title tag", count: missingTitle.length, detail: "These indexable pages have no <title>.", examples: examples(missingTitle) });
  }
  const titleOutOfRange = indexable.filter((p) => p.title && (p.titleLength! < titleRange[0] || p.titleLength! > titleRange[1]));
  if (titleOutOfRange.length) {
    issues.push({ severity: "low", code: "title_length", label: `Title length outside ${titleRange[0]}–${titleRange[1]} chars`, count: titleOutOfRange.length, detail: "Titles too short or long may be rewritten by Google.", examples: titleOutOfRange.map((p) => `${p.url} (${p.titleLength})`).slice(0, EX_CAP) });
  }

  // --- Missing / out-of-range meta descriptions. ---
  const missingMeta = indexable.filter((p) => !p.metaDescription);
  if (missingMeta.length) {
    issues.push({ severity: "medium", code: "missing_meta", label: "Missing meta description", count: missingMeta.length, detail: "Indexable pages with no meta description.", examples: examples(missingMeta) });
  }
  const metaOutOfRange = indexable.filter((p) => p.metaDescription && (p.metaDescriptionLength! < metaRange[0] || p.metaDescriptionLength! > metaRange[1]));
  if (metaOutOfRange.length) {
    issues.push({ severity: "low", code: "meta_length", label: `Meta description outside ${metaRange[0]}–${metaRange[1]} chars`, count: metaOutOfRange.length, detail: "Out-of-range descriptions are often truncated or rewritten.", examples: metaOutOfRange.map((p) => `${p.url} (${p.metaDescriptionLength})`).slice(0, EX_CAP) });
  }

  // --- H1 problems. ---
  const missingH1 = indexable.filter((p) => (p.h1Count ?? 0) === 0);
  if (missingH1.length) {
    issues.push({ severity: "medium", code: "missing_h1", label: "Missing H1", count: missingH1.length, detail: "Indexable pages with no H1 heading.", examples: examples(missingH1) });
  }
  const multiH1 = indexable.filter((p) => (p.h1Count ?? 0) > h1Count);
  if (multiH1.length) {
    issues.push({ severity: "low", code: "multiple_h1", label: `More than ${h1Count} H1`, count: multiH1.length, detail: `Pages with more than the expected ${h1Count} H1 heading.`, examples: multiH1.map((p) => `${p.url} (${p.h1Count})`).slice(0, EX_CAP) });
  }

  // --- Missing canonical. ---
  const missingCanonical = indexable.filter((p) => !p.hasCanonical);
  if (missingCanonical.length) {
    issues.push({ severity: "low", code: "missing_canonical", label: "Missing canonical tag", count: missingCanonical.length, detail: "A canonical tag prevents duplicate-URL dilution.", examples: examples(missingCanonical) });
  }

  // --- Thin content (site-wide). ---
  const thin = indexable.filter((p) => (p.wordCount ?? 0) < thinWords);
  if (thin.length) {
    issues.push({ severity: "medium", code: "thin_content", label: `Thin content (<${thinWords} words)`, count: thin.length, detail: "Pages with little text tend to under-rank. Expand or consolidate.", examples: thin.map((p) => `${p.url} (${p.wordCount})`).slice(0, EX_CAP) });
  }

  // --- Click-depth violations (architecture.max_depth_clicks). ---
  const tooDeep = indexable.filter((p) => p.depth > maxDepthClicks);
  if (tooDeep.length) {
    issues.push({ severity: "medium", code: "too_deep", label: `Buried past ${maxDepthClicks} clicks from home`, count: tooDeep.length, detail: `Pages more than ${maxDepthClicks} clicks deep (architecture.max_depth_clicks). Link them higher.`, examples: tooDeep.map((p) => `${p.url} (depth ${p.depth})`).slice(0, EX_CAP) });
  }

  // --- Noindex pages (informational — intentional for some, a bug for others). ---
  if (noindex.length) {
    issues.push({ severity: "low", code: "noindex", label: "Pages set to noindex", count: noindex.length, detail: "Confirm each is meant to be excluded from search.", examples: examples(noindex) });
  }

  // Severity order for display.
  const order: Record<IssueSeverity, number> = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count);

  const avgWordCount = indexable.length
    ? Math.round(indexable.reduce((s, p) => s + (p.wordCount ?? 0), 0) / indexable.length)
    : 0;
  const maxDepthSeen = all.reduce((m, p) => Math.max(m, p.depth), 0);

  const notes: string[] = [];
  if (crawl.reachedCap) {
    notes.push(`Crawl stopped at the ${crawl.cap}-page cap; ${crawl.discoveredNotCrawled}+ more pages were discovered but not audited.`);
  }
  notes.push("Crawls pages reachable from the homepage within the time budget — not a full commercial crawler. Rendering-only issues (JS-injected content, CWV, image alts) aren't covered yet.");

  return {
    ok: true,
    startUrl: crawl.startUrl,
    origin: crawl.origin,
    pagesCrawled: crawl.pagesCrawled,
    discoveredNotCrawled: crawl.discoveredNotCrawled,
    reachedCap: crawl.reachedCap,
    cap: crawl.cap,
    durationMs: crawl.durationMs,
    thresholds,
    summary: {
      indexablePages: indexable.length,
      noindexPages: noindex.length,
      brokenPages: broken.length,
      avgWordCount,
      maxDepthSeen,
    },
    issues,
    nap: computeNap(html, project.businessName, napTargetPct),
    pages: all,
    notes,
  };
}
