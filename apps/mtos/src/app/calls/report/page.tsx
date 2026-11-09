import Link from "next/link";
import { ArrowLeft, FileText, Palette } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import {
  ReportByNumber,
  ReportCallsTable,
  ReportCover,
  ReportFiguresTable,
  ReportFooterLine,
  ReportOverTime,
  ReportRecordingsSection,
  ReportSummaryPanel,
} from "@/src/components/mtos/call-client-report";
import { PrintReportButton } from "@/src/components/mtos/call-report-actions";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { buildCallTable, withLabelProvenance } from "@/src/lib/contracts/call-dashboard";
import {
  reportRecordings,
  reportSummaryLines,
  toReportRows,
} from "@/src/lib/contracts/call-client-report";
import {
  COMPARISON_MODE_LABEL,
  callMix,
  callsByNumber,
  callsInPeriod,
  callsOverTime,
  comparisonPeriod,
  headlineTiles,
  resolvePeriod,
  summariseCallers,
  toCallRecords,
  type ComparisonMode,
} from "@/src/lib/contracts/call-report";
import { LEAD_WINDOW_LABEL, type LeadWindowPreset } from "@/src/lib/mtos-data";
import { getClientsDirectoryView } from "@/src/lib/server/services/clients-service";
import { getStoredLeadVerification } from "@/src/lib/server/services/lead-verification-service";
import { getReportBrand } from "@/src/lib/server/services/report-brand-service";

/**
 * Rendered per request, never prerendered.
 *
 * Same reason as the dashboard it is reached from: this reads one tenant's data behind a session
 * cookie, so a build-time copy would be the wrong tenant's report for everybody -- and making it
 * would have the build reach Firestore, which is what failed the deploys of 2026-11-02 when the
 * daily read quota ran out. Next cannot infer it here, because the session read calls `cookies()`
 * inside a try/catch and skips it when the cookie secret is absent.
 */
export const dynamic = "force-dynamic";

const TABLE_LIMIT = 250;

/**
 * The client report: the dashboard's figures in the shape of a document.
 *
 * ## Two reads, both of them necessary
 *
 * The stored pull, and the tenant's report brand. Nothing else -- the comparison period is
 * answered out of the same stored pull, exactly as the dashboard does it, because a pull covers
 * one window and fetching a second one per page view is a bill against a read quota that has
 * taken deploys down once already.
 *
 * ## The label filter is deliberately not carried over
 *
 * `period`, `compare` and `number` arrive from the dashboard, because "the last 90 days" and
 * "this line only" are both honest subjects for a report. `label` is not: a client report filtered
 * to Good calls is a report that answers a question nobody asked, and a report filtered to Missed
 * is an accusation. The whole period, or one line of it, and nothing in between.
 *
 * ## Recordings
 *
 * Off unless Report Branding says otherwise, and off means absent rather than withheld: the
 * stripping happens in `toReportRows`, so the authenticated URL is gone from the data before any
 * of this markup sees it, and `reportRecordings` returns no count and no sentence, so the document
 * does not raise the subject at all. The caller was told the call was recorded when it connected;
 * a performance report is not where that gets discussed again.
 */
export default async function CallReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await resolveTenantContext();
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const { clients } = await getClientsDirectoryView(context);
  const clientId = one("client");
  const selected = clients.find((client) => client.id === clientId);

  const brand = await getReportBrand(context);

  if (!selected) {
    return (
      <AppShell>
        <div className="section-head">
          <div>
            <div className="eyebrow muted">
              <FileText />
              <span>Client report</span>
            </div>
            <div className="h3 mt-1.5">Choose a client</div>
          </div>
          <Link href="/calls/dashboard" className="btn btn-ghost btn-sm">
            <ArrowLeft />
            Call dashboard
          </Link>
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {clients.map((client) => (
            <Link
              key={client.id}
              href={`/calls/report?client=${client.id}`}
              className="card is-hover"
              style={{ padding: "15px 17px" }}
            >
              <div style={{ fontWeight: 650, color: "var(--text)" }}>{client.name}</div>
              <div className="muted text-[0.78rem]">{client.industry}</div>
            </Link>
          ))}
        </div>
      </AppShell>
    );
  }

  const preset = (
    ["last_7_days", "last_30_days", "last_90_days", "this_month", "last_month"] as LeadWindowPreset[]
  ).includes(one("period") as LeadWindowPreset)
    ? (one("period") as LeadWindowPreset)
    : "last_30_days";
  const comparison = (
    ["previous_period", "same_period_last_year", "none"] as ComparisonMode[]
  ).includes(one("compare") as ComparisonMode)
    ? (one("compare") as ComparisonMode)
    : "previous_period";
  const numberFilter = one("number");

  let review = null;
  let loadError = false;
  try {
    review = await getStoredLeadVerification(context, selected.id);
  } catch {
    // A read-quota error must not take the page down. The notice below says what is missing.
    loadError = true;
  }

  const { calls } = toCallRecords(review?.leads || []);
  const period = resolvePeriod(preset, new Date());
  const earlier = comparisonPeriod(period, comparison);

  const subject = numberFilter
    ? calls.filter((call) => (call.calledNumber || "").replace(/\D/g, "").slice(-10) === numberFilter)
    : calls;

  const inPeriod = callsInPeriod(subject, period);
  const beforeRaw = earlier ? callsInPeriod(subject, earlier) : [];
  // An empty earlier window means no pull covered it, not that nobody rang. Passing it on as data
  // would report every caller as new and every figure as doubled.
  const before = beforeRaw.length > 0 ? beforeRaw : undefined;

  const tiles = headlineTiles(inPeriod, before);
  const mix = callMix(inPeriod);
  const overTime = callsOverTime(inPeriod, period);
  const callers = summariseCallers(inPeriod, before);
  const numbers = callsByNumber(inPeriod);

  const table = withLabelProvenance(
    buildCallTable(
      calls,
      period,
      { number: numberFilter },
      { everPulled: Boolean(review), limit: TABLE_LIMIT },
    ),
    review?.leads || [],
  );

  const rows = toReportRows(table.rows, brand.includeRecordings);
  const recordings = reportRecordings(rows, brand.includeRecordings);

  const periodLabel = LEAD_WINDOW_LABEL[preset];
  // "No comparison" has to stay absent rather than become a label, or the figures table grows a
  // column of em dashes under a heading that promises one.
  const comparisonLabel = before ? COMPARISON_MODE_LABEL[comparison] : undefined;

  const summary = reportSummaryLines({ mix, tiles, callers, periodLabel, comparisonLabel });

  const limitNote =
    inPeriod.length > table.rows.length
      ? `This list shows the first ${table.rows.length.toLocaleString("en-US")} of ${inPeriod.length.toLocaleString("en-US")} calls in the period. The figures above count all of them.`
      : undefined;

  return (
    <AppShell>
      <div className="section-head no-print">
        <div>
          <div className="eyebrow muted">
            <FileText />
            <span>Client report</span>
          </div>
          <div className="h3 mt-1.5">{selected.name}</div>
          <p className="muted mt-1 text-[0.82rem]">
            {periodLabel}
            {numberFilter ? " · one line only" : ""} · recordings{" "}
            {brand.includeRecordings ? "included" : "left out, as set in Report Branding"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PrintReportButton />
          <Link href="/settings/report-brand" className="btn btn-ghost btn-sm">
            <Palette />
            Report branding
          </Link>
          <Link href={`/calls/dashboard?client=${selected.id}`} className="btn btn-ghost btn-sm">
            <ArrowLeft />
            Call dashboard
          </Link>
        </div>
      </div>

      {loadError ? (
        <div className="insight watch no-print" style={{ gridTemplateColumns: "1fr" }}>
          <div>
            <div className="h4">The stored calls could not be read just now</div>
            <p className="muted mt-1.5 text-[0.85rem]">
              The data store returned an error, often a read-quota limit. Nothing below is wrong, but it
              may be empty — try again shortly before sending this to anybody.
            </p>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4">
        <ReportCover
          brand={brand}
          clientName={selected.name}
          period={period}
          label="Call Performance Report"
        />
        <ReportSummaryPanel summary={summary} mix={mix} brand={brand} />
        <ReportFiguresTable tiles={tiles} comparisonLabel={comparisonLabel} brand={brand} />
        <ReportOverTime buckets={overTime.buckets} size={overTime.size} brand={brand} />
        <ReportByNumber numbers={numbers} brand={brand} />
        <ReportCallsTable rows={rows} limitNote={limitNote} brand={brand} />
        <ReportRecordingsSection recordings={recordings} brand={brand} />
        {review?.generatedAt ? (
          <p className="muted text-[0.76rem]" style={{ textAlign: "center" }}>
            Call data last refreshed from GoHighLevel on{" "}
            {new Intl.DateTimeFormat("en-US", {
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            }).format(new Date(review.generatedAt))}
            .
          </p>
        ) : null}
        <ReportFooterLine brand={brand} generatedAt={new Date().toISOString()} />
      </div>
    </AppShell>
  );
}
