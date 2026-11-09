import Link from "next/link";
import { ArrowLeft, FileText, Palette, PhoneIncoming } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { ClientHint } from "@/src/components/mtos/client-hint";
import {
  ByNumberPanel,
  CallMixPanel,
  CallersPanel,
  CallsOverTimePanel,
  ComparisonPanel,
  HeadlineTiles,
  PeriodChip,
} from "@/src/components/mtos/call-dashboard";
import { CallDashboardToolbar } from "@/src/components/mtos/call-dashboard-toolbar";
import { CallTable } from "@/src/components/mtos/call-table";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { CALL_LABELS, type CallLabel } from "@/src/lib/contracts/call-labels";
import {
  buildCallTable,
  numberFilterOptions,
  withLabelProvenance,
} from "@/src/lib/contracts/call-dashboard";
import {
  COMPARISON_MODE_LABEL,
  callMix,
  callsByNumber,
  callsInPeriod,
  callsOverTime,
  compareNumbers,
  comparisonMeasures,
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

/**
 * Rendered per request, never prerendered.
 *
 * Same reason as the lead & call verification page it sits beside: this reads one tenant's data
 * behind a session cookie, so a build-time copy would be the wrong tenant's page for everybody --
 * and making it would have the build reach Firestore, which is what failed the deploys of
 * 2026-11-02 when the daily read quota ran out. Next cannot infer it here, because the session
 * read calls `cookies()` inside a try/catch and skips it when the cookie secret is absent.
 */
export const dynamic = "force-dynamic";

/**
 * The call dashboard: one stored read, every figure derived from it.
 *
 * ## Why this is a new route rather than a rewrite of /calls
 *
 * The guardrails say only add. `/calls` is the page AMs use today to pull a window, vet lead by
 * lead and play recordings, and it works -- so it keeps working, untouched, and this sits beside
 * it. The two read the same stored review from the same place, so nothing has to be pulled twice
 * and nobody has to choose which page is "right".
 *
 * ## One read, and no second one
 *
 * `getStoredLeadVerification` is the only Firestore call here apart from the client directory, and
 * the comparison period is answered from the SAME stored pull rather than by fetching the earlier
 * window separately. That is deliberate: a pull covers one window, so a comparison only has data
 * behind it when the stored window is long enough to contain both halves. Where it is not, the
 * comparison says it has nothing to compare against instead of quietly showing zeroes -- see
 * `ComparisonPanel`. Fetching the earlier window would mean a second pull per page view, against
 * a read quota that has already taken deploys down once.
 */
export default async function CallDashboardPage({
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
  const labelFilter = CALL_LABELS.includes(one("label") as CallLabel)
    ? (one("label") as CallLabel)
    : undefined;

  if (!selected) {
    return (
      <AppShell>
        <div className="section-head">
          <div>
            <div className="eyebrow muted">
              <PhoneIncoming />
              <span>Call dashboard</span>
            </div>
            <div className="h3 mt-1.5">Choose a client</div>
          </div>
          <Link href="/calls" className="btn btn-ghost btn-sm">
            <ArrowLeft />
            Lead &amp; call verification
          </Link>
        </div>
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {clients.map((client) => (
            <Link
              key={client.id}
              href={`/calls/dashboard?client=${client.id}`}
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

  let review = null;
  let loadError = false;
  try {
    review = await getStoredLeadVerification(context, selected.id);
  } catch {
    // A read-quota error must not take the page down; the empty states below say what is missing.
    loadError = true;
  }

  const { calls, skippedNoCallEvidence } = toCallRecords(review?.leads || []);
  const period = resolvePeriod(preset, new Date());
  const earlier = comparisonPeriod(period, comparison);

  // The filter narrows what every panel below counts, so "this line's month" is a real view of the
  // whole dashboard rather than only of the table.
  const subject = numberFilter
    ? calls.filter((call) => {
        const digits = (call.calledNumber || "").replace(/\D/g, "").slice(-10);
        return digits === numberFilter;
      })
    : calls;

  const inPeriod = callsInPeriod(subject, period);
  const beforeRaw = earlier ? callsInPeriod(subject, earlier) : [];
  // An empty earlier window means no pull covered it, not that nobody rang. Passing it on as data
  // would report every caller as new and every tile as doubled.
  const before = beforeRaw.length > 0 ? beforeRaw : undefined;

  const tiles = headlineTiles(inPeriod, before);
  const mix = callMix(inPeriod);
  const overTime = callsOverTime(inPeriod, period);
  const callers = summariseCallers(inPeriod, before);
  const numbers = callsByNumber(inPeriod);
  const measures = comparisonMeasures(inPeriod, before);
  const numberComparison = before
    ? compareNumbers(numbers, callsByNumber(before))
    : undefined;

  /*
    The table is built from the UNFILTERED calls so its tab counts can narrow themselves, and then
    given the leads so each row can say which layer set its label and why. `everPulled` is the one
    thing the contract cannot work out: a client with no stored review and a client whose stored
    review covers a silent month both arrive as an empty array, and those are different sentences.
  */
  const table = withLabelProvenance(
    buildCallTable(
      calls,
      period,
      { label: labelFilter, number: numberFilter },
      { everPulled: Boolean(review), limit: 250 },
    ),
    review?.leads || [],
  );

  const periodLabel = LEAD_WINDOW_LABEL[preset];
  const comparisonLabel = COMPARISON_MODE_LABEL[comparison];

  return (
    <AppShell>
      <div className="section-head">
        <div>
          <div className="eyebrow muted">
            <PhoneIncoming />
            <span>Call dashboard</span>
          </div>
          <div className="h3 mt-1.5">
            <ClientHint client={selected} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/*
            The report carries the period, the comparison and the number filter across, but NOT
            the label filter: a client report filtered to one label answers a question nobody
            asked, and filtered to Missed it is an accusation.
          */}
          <Link
            href={`/calls/report?client=${selected.id}&period=${preset}&compare=${comparison}${
              numberFilter ? `&number=${numberFilter}` : ""
            }`}
            className="btn btn-ghost btn-sm"
          >
            <FileText />
            Client report
          </Link>
          <Link href="/settings/report-brand" className="btn btn-ghost btn-sm">
            <Palette />
            Report branding
          </Link>
          <Link href={`/calls?client=${selected.id}`} className="btn btn-ghost btn-sm">
            <ArrowLeft />
            Pull, verify &amp; listen
          </Link>
        </div>
      </div>

      <div className="card" style={{ padding: "15px 17px" }}>
        <CallDashboardToolbar
          clientId={selected.id}
          preset={preset}
          comparison={comparison}
          number={numberFilter}
          numbers={numberFilterOptions(calls)}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <PeriodChip label={periodLabel} calls={inPeriod.length} />
        {skippedNoCallEvidence > 0 ? (
          <span className="chip" title="These records carry no duration, status, direction or recording, so there is no evidence a call happened.">
            {skippedNoCallEvidence.toLocaleString("en-US")} record(s) set aside — not calls
          </span>
        ) : null}
        {!review && !loadError ? <span className="chip">Never pulled</span> : null}
        {loadError ? <span className="chip watch">Stored calls could not be read just now</span> : null}
      </div>

      <div className="mt-4">
        <HeadlineTiles tiles={tiles} />
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <CallMixPanel mix={mix} />
        <CallsOverTimePanel buckets={overTime.buckets} size={overTime.size} />
      </div>

      <div className="mt-4 grid items-start gap-4">
        <CallersPanel callers={callers} />
        <ByNumberPanel numbers={numbers} comparison={numberComparison} />
        <ComparisonPanel
          measures={measures}
          periodLabel={periodLabel}
          comparisonLabel={comparisonLabel}
        />
        <CallTable clientId={selected.id} table={table} totalInPeriod={inPeriod.length} />
      </div>
    </AppShell>
  );
}
