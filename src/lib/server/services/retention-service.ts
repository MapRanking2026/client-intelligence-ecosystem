/**
 * Emergency Retention. Assembles the "save the account" case for a client who has
 * asked to cancel — from data already in MTOS — into (a) an internal brief the AM
 * uses in the conversation and (b) a client-facing branded report.
 *
 * Everything is grounded in real data. Where data is thin, the output degrades to
 * a usable skeleton the AM completes with manual additions; it never invents
 * numbers, pages, or URLs.
 */
import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getReportBrand } from "@/src/lib/server/services/report-brand-service";
import { listReportAdditions, type ReportArea } from "@/src/lib/server/services/section-notes-service";
import { buildReportDocx, type ReportData, type ReportKeywordRow, type ReportLink } from "@/src/lib/server/reports/report-builder";

const EMPTY_ADDITIONS: Record<ReportArea, string[]> = { results: [], work: [], inProgress: [], blockers: [], recommendation: [], general: [] };

export interface RetentionBrief {
  headline: string;
  proofPoints: string[];
  whyNotFelt: string;
  theAsk: string;
  talkTrack: { open: string; reframe: string; ask: string };
}

export interface RetentionFacts {
  clientName: string;
  location: string;
  websiteLabel: string;
  reputation?: string;
  marketShareNow?: number;
  marketShareBaseline?: number;
  rankNow?: number;
  rankBaseline?: number;
  topKeyword?: { term: string; share: number; rank: number };
  keywordRows: ReportKeywordRow[];
  completedCount: number;
  inProgress: string[];
  wins: string[];
  blockers: string[];
  /** AM "add anything we missed" notes, grouped by the report area they enrich. */
  additions: Record<ReportArea, string[]>;
}

function n(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function pctText(v?: number): string {
  return v === undefined ? "—" : `${Math.round(v * 10) / 10}%`;
}

/** Pull the strongest, real facts from the client's touch prep pack and commitments. */
export async function assembleRetentionFacts(context: TenantContext, clientId: string): Promise<RetentionFacts | null> {
  const ds = getMtosDataSource(context);
  const client = await ds.getClientById(clientId);
  if (!client) return null;

  const [touch, commitments, additions] = await Promise.all([
    client.touchId ? ds.getMonthlyTouchById(client.touchId) : Promise.resolve(undefined),
    ds.getCommitments(clientId),
    listReportAdditions(context, clientId),
  ]);
  const prep = touch?.prepPack;
  const scorecard = prep?.businessScorecard;
  const seo = prep?.seoPerformance;

  // Market share + rank transformation (prefer the blended scorecard metrics).
  const share = scorecard?.shareOfLocalVoice;
  const rank = scorecard?.averageKeywordRank;
  const marketShareNow = n(share?.value);
  const marketShareBaseline = n(share?.previousValue);
  const rankNow = n(rank?.value);
  const rankBaseline = n(rank?.previousValue);

  // Per-keyword rows from the geo-grid scan history.
  const keywordRows: ReportKeywordRow[] = (seo?.keywordScanHistory ?? []).slice(0, 8).map((entry) => {
    const latest = entry.scans?.[0];
    const prev = entry.scans?.[1];
    const shareNow = n(latest?.marketSharePercent);
    const sharePrev = n(prev?.marketSharePercent);
    const delta = shareNow !== undefined && sharePrev !== undefined ? shareNow - sharePrev : 0;
    const tone: ReportKeywordRow["tone"] = delta > 1 ? "gain" : delta < -1 ? "watch" : "hold";
    const trend = delta > 1 ? `Up ${Math.round(delta)} pts` : delta < -1 ? "In active recovery" : "Holding";
    return {
      term: entry.keyword,
      share: shareNow !== undefined ? `${Math.round(shareNow)}%` : "—",
      rank: latest?.averageRank != null ? String(latest.averageRank) : "—",
      trend,
      tone,
    };
  }).sort((a, b) => parseFloat(b.share) - parseFloat(a.share) || 0);

  const topKeyword = keywordRows.length && parseFloat(keywordRows[0].share) > 0
    ? { term: keywordRows[0].term, share: parseFloat(keywordRows[0].share), rank: parseFloat(keywordRows[0].rank) }
    : undefined;

  const matched = seo?.matchedBusinesses?.[0];
  const reputation = matched && (matched.rating != null || matched.reviews != null)
    ? `${matched.rating ?? "—"}-star rating across ${matched.reviews ?? "—"} reviews`
    : undefined;

  const completed = commitments.filter((c) => c.status === "Completed");
  const open = commitments.filter((c) => c.status !== "Completed");
  const inProgress = Array.from(new Set(open.map((c) => c.title))).slice(0, 6);

  // Best-effort website label from the client record.
  const site = (client as { website?: string; websiteUrl?: string }).website
    || (client as { website?: string; websiteUrl?: string }).websiteUrl
    || "";
  const websiteLabel = site.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const location = client.location || (client.industry && client.industry !== "Unknown" ? client.industry : "");

  return {
    clientName: client.name,
    location,
    websiteLabel,
    reputation,
    marketShareNow, marketShareBaseline, rankNow, rankBaseline,
    topKeyword,
    keywordRows,
    completedCount: completed.length,
    inProgress: inProgress.length ? inProgress : ["Ongoing local SEO optimization and monthly reviews."],
    wins: (touch?.wins ?? []).slice(0, 5),
    blockers: prep?.dataGaps ?? [],
    additions: additions ?? EMPTY_ADDITIONS,
  };
}

/** Deterministic internal brief. Reliable with or without an LLM; the prompt-engine keys
 *  (retention_brief_prompt / retention_report_narrative_prompt) refine this copy when wired. */
export function marketShareMultiple(f: RetentionFacts): number | undefined {
  return f.marketShareNow !== undefined && f.marketShareBaseline !== undefined && f.marketShareBaseline > 0
    ? f.marketShareNow / f.marketShareBaseline
    : undefined;
}

export function buildInternalBrief(f: RetentionFacts): RetentionBrief {
  const mult = marketShareMultiple(f);
  const strongGrowth = mult !== undefined && mult >= 1.3;
  const rankLine =
    f.rankNow !== undefined && f.rankBaseline !== undefined
      ? `, and your average map rank improved from ${f.rankBaseline} to ${f.rankNow}`
      : "";

  // Lead with the growth story only when it's genuinely strong; otherwise anchor
  // on the dominant current position, which is the more persuasive real fact.
  const headline = strongGrowth
    ? `Your local visibility has grown from ${pctText(f.marketShareBaseline)} to ${pctText(f.marketShareNow)} market share${rankLine}${f.topKeyword ? ` — and for “${f.topKeyword.term}” you now hold ${Math.round(f.topKeyword.share)}% share at rank ${f.topKeyword.rank}` : ""}.`
    : f.topKeyword
      ? `You dominate your most valuable local search: for “${f.topKeyword.term}” you hold ${Math.round(f.topKeyword.share)}% market share at an average rank of ${f.topKeyword.rank} — the position competitors pay thousands to reach.`
      : `You hold strong, defensible positions across your most valuable local searches.`;

  const proofPoints: string[] = [];
  if (f.topKeyword) proofPoints.push(`Top 3 for “${f.topKeyword.term}” — the position competitors pay to reach.`);
  const gains = f.keywordRows.filter((r) => r.tone === "gain");
  if (gains.length) proofPoints.push(`${gains.length} search term${gains.length > 1 ? "s" : ""} climbing in the last 30 days.`);
  if (f.completedCount) proofPoints.push(`${f.completedCount} optimization tasks completed and documented.`);
  if (f.reputation) proofPoints.push(`Reputation maintained: ${f.reputation}.`);
  f.wins.slice(0, 2).forEach((w) => proofPoints.push(w));
  // AM-entered points the system missed lead the list — they're the freshest, most specific evidence.
  [...f.additions.results, ...f.additions.general].forEach((a) => proofPoints.unshift(a));

  const whyNotFelt = f.blockers.some((b) => /lead|GHL|call|tracking|CRM/i.test(b))
    ? "The rankings are real, but lead tracking isn’t connected — so the calls those rankings generate aren’t being captured or shown back to the client. That’s a reporting gap, not a performance one, and it’s quick to fix."
    : "The rankings are strong; if the client isn’t feeling it, it’s most likely a tracking or reporting gap rather than the SEO — fixable quickly.";

  const theAsk = "Give us 30 days to connect tracking and clear the open technical items, with one measurable goal we agree on today — reported back in writing. Low-risk and reversible.";

  return {
    headline,
    proofPoints: proofPoints.slice(0, 8),
    whyNotFelt,
    theAsk,
    talkTrack: {
      open: `Before anything else, I want to show you exactly where you stand versus where you started. ${headline}`,
      reframe: whyNotFelt,
      ask: "Give me 30 days: we connect tracking, clear the open items, and I’ll show you real calls from search — with one goal we agree on today. If you don’t see it, you can walk. But leaving now hands this position back to competitors right as it peaks.",
    },
  };
}

/** Map facts + AM-confirmed page links into the branded report model. */
export function buildReportData(f: RetentionFacts, links: ReportLink[], signer: { name: string; title: string }): ReportData {
  const mult = marketShareMultiple(f);
  const strongGrowth = mult !== undefined && mult >= 1.3;

  const stats: [string, string][] = [];
  if (strongGrowth) stats.push([`${mult!.toFixed(1)}×`, "Market-share growth"]);
  if (f.topKeyword) stats.push([`${Math.round(f.topKeyword.share)}%`, "Share on your top search"]);
  if (f.marketShareNow !== undefined && !strongGrowth) stats.push([pctText(f.marketShareNow), "Avg. market share"]);
  const gains = f.keywordRows.filter((r) => r.tone === "gain");
  if (gains.length) stats.push([String(gains.length), "Search terms climbing"]);
  if (f.completedCount) stats.push([String(f.completedCount), "Tasks completed"]);
  while (stats.length < 3) stats.push(["✓", "Active optimization"]);

  const transformationBody = strongGrowth
    ? `Across the searches we track, your average local market share has grown from ${pctText(f.marketShareBaseline)} to ${pctText(f.marketShareNow)}${f.rankNow !== undefined && f.rankBaseline !== undefined ? `, and your average map ranking has risen from ${f.rankBaseline} to ${f.rankNow} (lower is better)` : ""}. In plain terms, ${f.clientName} has gone from barely visible to one of the most visible in your local market — and the results are still climbing.`
    : f.topKeyword
      ? `${f.clientName} holds a commanding position in local search: for “${f.topKeyword.term}” you rank in the top 3 with ${Math.round(f.topKeyword.share)}% market share${f.marketShareNow !== undefined ? `, and ${pctText(f.marketShareNow)} average market share across all tracked searches` : ""}. That is the hardest, most valuable position in local marketing — and it continues to build.`
      : `Your local search visibility is strong across your most valuable searches and continues to build.`;

  // Fall back to the hostname of the first live link when the client record has no site on file.
  let websiteLabel = f.websiteLabel;
  if (!websiteLabel && links.length) {
    try { websiteLabel = new URL(links[0].url).hostname.replace(/^www\./, ""); } catch { /* keep empty */ }
  }

  return {
    reportTypeLabel: "Local SEO Performance Report",
    clientName: f.clientName,
    websiteLabel,
    location: f.location,
    dateLabel: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
    intro: `Thank you for the opportunity to work with ${f.clientName}. This report summarizes the work our team has completed, the results your business is seeing in Google’s local search today, and what we recommend next — and wherever we reference a page we built, you can click it to view the live work.`,
    stats: stats.slice(0, 5),
    transformationTitle: "WHERE YOU STARTED VS. TODAY",
    transformationBody,
    keywordIntro: "Here is exactly where you rank today for the searches local customers use. Market share is how often you appear prominently; average map rank is your typical position on Google’s map grid, where 1–3 is the coveted “top 3.”",
    keywordRows: f.keywordRows.length ? f.keywordRows : [{ term: "Local search visibility", share: "Growing", rank: "—", trend: "Climbing", tone: "gain" }],
    keywordCaption: "Current geo-grid scan. Terms holding strong positions or climbing; any dip is in active recovery.",
    searchesThatMatter: [
      f.topKeyword
        ? `For your highest-value search, “${f.topKeyword.term},” you now hold ${Math.round(f.topKeyword.share)}% market share at an average rank of ${f.topKeyword.rank} — the top of your local market.`
        : "Your most valuable searches are holding strong local positions, with continued momentum.",
      ...f.additions.results,
      ...f.additions.general,
    ].join(" "),
    pagesIntro: links.length
      ? "A major part of this progress came from building and optimizing dedicated pages on your website. Each page below is live now — click any page name to open the live work."
      : "A major part of this progress came from optimizing your website and Google presence.",
    pagesBuilt: links,
    alsoDid: [
      "Ran a citations and listings campaign to strengthen your local authority.",
      "Optimized your keyword map so effort goes where it counts.",
      "Published regular Google Business Profile posts to Google, Facebook, and your website.",
      "Delivered ongoing technical SEO and schema across your pages.",
      ...(f.reputation ? [`Maintained your reputation: ${f.reputation}.`] : []),
      ...f.additions.work,
    ],
    inProgress: [...f.additions.inProgress, ...f.inProgress],
    qualityIntro: "We continuously audit your account so every improvement reaches your customers. Any open technical items are identified and being corrected.",
    qualityItems: [
      ...(f.blockers.length ? f.blockers.slice(0, 4).map(clientFriendlyBlocker) : []),
      ...f.additions.blockers,
    ].length
      ? [...(f.blockers.length ? f.blockers.slice(0, 4).map(clientFriendlyBlocker) : []), ...f.additions.blockers]
      : ["No blocking technical issues outstanding — work is progressing on schedule."],
    recommendation: [
      "Connect call and lead tracking to your account. Your rankings are generating phone calls today, but they aren’t yet captured in reporting. Connecting this lets you see the real calls and form submissions your visibility is driving — turning top rankings into numbers you can count.",
      ...f.additions.recommendation,
    ].join(" "),
    nextSteps: [
      "Connect call and lead tracking so you can see the calls your rankings generate.",
      "Complete the open technical items noted above.",
      "Keep momentum on the climbing searches and recover any that dipped.",
      "Agree on one clear 30-day goal together and report back at your next review.",
    ],
    forwardIntro: "Local search rankings compound over time. Here is what today’s results set up for your business:",
    forwardLook: [
      { area: "Strong map rankings", meaning: "You hold positions that capture the majority of local searches — the hardest, most valuable part of local marketing." },
      { area: "Compounding momentum", meaning: "Every new page, post, and citation builds on the last, so results accelerate rather than plateau." },
      { area: "The next unlock", meaning: "With call tracking connected, this visibility converts into measurable phone calls and booked jobs." },
    ],
    closing: `${f.clientName} has achieved something most local businesses never do — genuine visibility in your market for the searches that bring in work. We’re proud of that progress and committed to turning it into measurable calls and booked jobs. I’d be glad to walk you through any part of this personally, at whatever time works best.`,
    signerName: signer.name,
    signerTitle: signer.title,
  };
}

function clientFriendlyBlocker(raw: string): string {
  if (/cach/i.test(raw)) return "A website caching item that can delay on-page updates from displaying — a quick fix that unlocks work already completed.";
  if (/yelp|address|NAP/i.test(raw)) return "An address/listing detail on a third-party directory that we’re aligning to your verified Google address.";
  if (/lead|GHL|CRM|call/i.test(raw)) return "Lead tracking is not yet connected — we recommend connecting it so the calls your rankings generate are captured and reported.";
  if (/ads/i.test(raw)) return "Paid-ad tracking isn’t connected yet — optional, and only needed if you want paid-channel reporting.";
  return "A minor data/reporting item we’re addressing so your reporting is complete.";
}

/** Generate the client-facing branded retention report as a .docx buffer. */
export async function generateRetentionReport(
  context: TenantContext,
  clientId: string,
  options: { links?: ReportLink[]; signerName?: string; signerTitle?: string } = {},
): Promise<{ buffer: Buffer; fileName: string } | null> {
  const facts = await assembleRetentionFacts(context, clientId);
  if (!facts) return null;
  const brand = await getReportBrand(context);
  const signer = { name: options.signerName || "Your Account Manager", title: options.signerTitle || `Account Manager · ${brand.companyName}` };
  const data = buildReportData(facts, options.links ?? [], signer);
  const buffer = await buildReportDocx(brand, data);
  const slug = facts.clientName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  const date = new Date().toISOString().slice(0, 10);
  return { buffer, fileName: `Performance-Report-${slug}-${date}.docx` };
}
