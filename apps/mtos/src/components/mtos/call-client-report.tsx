import { DonutChart, ColumnsChart } from "@/src/components/mtos/brief-chart";
import { ReportRecordingPlayers } from "@/src/components/mtos/call-report-actions";
import { CALL_LABELS, CALL_LABEL_LABEL, CALL_LABEL_TONE } from "@/src/lib/contracts/call-labels";
import {
  describeChangeInWords,
  reportDateline,
  reportFooter,
  type ReportRecordings,
  type ReportRow,
  type ReportSummary,
} from "@/src/lib/contracts/call-client-report";
import type {
  CallMix,
  CallPeriod,
  HeadlineTile,
  NumbersBreakdown,
  TimeBucket,
  TimeBucketSize,
} from "@/src/lib/contracts/call-report";
import type { ReportBrand } from "@/src/lib/server/services/report-brand-service";

/**
 * The printable client report.
 *
 * ## Why this is not the dashboard with a print stylesheet over it
 *
 * The dashboard is an instrument: filter tabs, a label dropdown on every row, "decided by", Reset.
 * None of that survives being printed and none of it belongs in a client's hands. What is shared
 * is the arithmetic -- one stored pull, the same contracts -- not the markup. So this file renders
 * the same figures in the shape a document wants: a cover, a paragraph in words, then the evidence.
 *
 * ## The brand is the tenant's, including on paper
 *
 * Colours come from Report Branding as hex without a `#`, so every use here is `#${...}`. They are
 * applied inline rather than through CSS variables because a printed page is often printed from a
 * different machine, and because the brand is per tenant while the stylesheet is not.
 *
 * `print-color-adjust: exact` on the cover is what keeps the dark strip dark: browsers drop
 * backgrounds when printing unless told otherwise, and a cover whose background vanishes leaves
 * white text on white paper.
 *
 * ## Direction is in words, not colour
 *
 * The dashboard colours its arrows by whether the movement is good news. On paper half the
 * readers print in black and white, so the comparison is a sentence -- "7 fewer missed calls than
 * the previous 30 days" -- which survives a fax machine.
 */

function hex(value: string): string {
  return value.startsWith("#") ? value : `#${value}`;
}

export function ReportCover({
  brand,
  clientName,
  clientSite,
  period,
  label,
}: {
  brand: ReportBrand;
  clientName: string;
  clientSite?: string;
  period: CallPeriod;
  label: string;
}) {
  return (
    <section
      className="report-cover"
      style={{
        background: hex(brand.colors.navy),
        color: "#fff",
        borderRadius: 16,
        padding: "34px 30px",
        textAlign: "center",
        fontFamily: brand.font,
        // Without this the browser strips the background when printing and the white text lands on
        // white paper. Both spellings: the unprefixed property is newer than the engines in use.
        WebkitPrintColorAdjust: "exact",
        printColorAdjust: "exact",
      }}
    >
      {brand.logoDataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={brand.logoDataUrl}
          alt={brand.companyName}
          style={{ width: 56, height: 56, objectFit: "contain", margin: "0 auto 14px" }}
        />
      ) : (
        <div
          style={{
            width: 56,
            height: 56,
            margin: "0 auto 14px",
            borderRadius: 12,
            background: "rgba(255,255,255,0.12)",
            display: "grid",
            placeItems: "center",
            fontWeight: 800,
            fontSize: "1.3rem",
          }}
        >
          {(brand.companyName || "M").slice(0, 1)}
        </div>
      )}
      <div
        style={{
          color: hex(brand.colors.bluePale),
          fontSize: "0.64rem",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <h1 style={{ fontSize: "1.7rem", fontWeight: 800, margin: "8px 0 0" }}>{clientName}</h1>
      {clientSite ? (
        <div style={{ color: hex(brand.colors.bluePale), fontSize: "0.82rem", marginTop: 4 }}>{clientSite}</div>
      ) : null}
      <div style={{ color: hex(brand.colors.bluePale), fontSize: "0.8rem", marginTop: 12 }}>
        {reportDateline(period)}
      </div>
    </section>
  );
}

/** The paragraph: the headline figure, the sentences under it, and the good-call ring beside them. */
export function ReportSummaryPanel({
  summary,
  mix,
  brand,
}: {
  summary: ReportSummary;
  mix: CallMix;
  brand: ReportBrand;
}) {
  return (
    <section className="card report-block">
      <div className="grid items-center gap-5 lg:grid-cols-[minmax(0,1fr)_200px]">
        <div>
          <h2 className="h3" style={{ color: hex(brand.colors.blueDeep) }}>
            {summary.headline}
          </h2>
          <div className="mt-2.5 grid gap-2">
            {summary.lines.map((line) => (
              <p key={line} className="text-[0.92rem]" style={{ color: "var(--text-2)", lineHeight: 1.55 }}>
                {line}
              </p>
            ))}
          </div>
        </div>
        {mix.total > 0 ? (
          <div style={{ justifySelf: "center" }}>
            <DonutChart
              donut={{
                slices: mix.slices.map((slice) => ({
                  label: slice.name,
                  value: slice.count,
                  color: slice.tone,
                })),
                centreValue: summary.goodCallRate,
                centreLabel: "good calls",
              }}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The figures table.
 *
 * A table rather than tiles: six tiles across a sheet of A4 become six tiles down it, and a reader
 * comparing two numbers wants them in one column. The right-hand column is the comparison written
 * out, or an em dash where there was nothing to compare against -- never a zero.
 */
export function ReportFiguresTable({
  tiles,
  comparisonLabel,
  brand,
}: {
  tiles: HeadlineTile[];
  comparisonLabel?: string;
  brand: ReportBrand;
}) {
  return (
    <section className="card report-block">
      <div className="card-head">
        <div className="card-title" style={{ color: hex(brand.colors.blueDeep) }}>
          The figures
        </div>
        {comparisonLabel ? <span className="muted text-[0.76rem]">compared with {comparisonLabel.toLowerCase()}</span> : null}
      </div>
      <div className="table-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>What</th>
              <th>This period</th>
              <th>{comparisonLabel ? "Against the comparison" : "Comparison"}</th>
            </tr>
          </thead>
          <tbody>
            {tiles.map((tile) => {
              const words = comparisonLabel
                ? describeChangeInWords(tile.change, tile.label.toLowerCase(), comparisonLabel)
                : undefined;
              return (
                <tr key={tile.key}>
                  <td style={{ fontWeight: 600, color: "var(--text)" }}>
                    {tile.tone ? (
                      <span className="sig-dot mr-1.5" style={{ background: tile.tone }} />
                    ) : null}
                    {tile.label}
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "var(--text)" }}>
                    {tile.value.toLocaleString("en-US")}
                  </td>
                  <td className="muted text-[0.84rem]">
                    {words || (
                      <span title="No earlier pull covers the comparison window, so there is nothing to compare this against.">
                        —
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** When the calls came in. The same stacked columns as the dashboard, with the legend spelled out. */
export function ReportOverTime({
  buckets,
  size,
  brand,
}: {
  buckets: TimeBucket[];
  size: TimeBucketSize;
  brand: ReportBrand;
}) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.total, 0);
  if (total === 0) return null;

  return (
    <section className="card report-block">
      <div className="card-head">
        <div className="card-title" style={{ color: hex(brand.colors.blueDeep) }}>
          When they came in
        </div>
        <span className="muted text-[0.76rem]">by {size}</span>
      </div>
      <ColumnsChart
        columns={{
          legend: CALL_LABELS.map((label) => ({
            key: label,
            label: CALL_LABEL_LABEL[label],
            color: CALL_LABEL_TONE[label],
          })),
          buckets: buckets.map((bucket) => ({
            key: bucket.key,
            label: bucket.label,
            segments: CALL_LABELS.map((label) => ({
              key: label,
              label: CALL_LABEL_LABEL[label],
              value: bucket.counts[label],
              color: CALL_LABEL_TONE[label],
            })),
          })),
        }}
      />
    </section>
  );
}

/**
 * One row per tracking line.
 *
 * The section disappears entirely when the pull captured no lines, rather than printing a warning
 * about our own data collection. The dashboard shows that warning, because it is addressed to us.
 */
export function ReportByNumber({ numbers, brand }: { numbers: NumbersBreakdown; brand: ReportBrand }) {
  if (numbers.blocks.length === 0) return null;

  return (
    <section className="card report-block">
      <div className="card-head">
        <div className="card-title" style={{ color: hex(brand.colors.blueDeep) }}>
          By phone number
        </div>
      </div>
      <div className="table-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>Line</th>
              <th>Calls</th>
              <th>Callers</th>
              <th>Good calls</th>
            </tr>
          </thead>
          <tbody>
            {numbers.blocks.map((block) => (
              <tr key={block.phoneNumber}>
                <td style={{ fontWeight: 600, color: "var(--text)" }}>
                  {block.friendlyName || block.phoneNumber}
                  {block.friendlyName ? <div className="muted text-[0.74rem]">{block.phoneNumber}</div> : null}
                </td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>{block.total.toLocaleString("en-US")}</td>
                <td style={{ fontVariantNumeric: "tabular-nums" }}>{block.uniqueCallers.toLocaleString("en-US")}</td>
                <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--good)", fontWeight: 600 }}>
                  {block.goodCalls.toLocaleString("en-US")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {numbers.callsWithoutNumber > 0 ? (
        <p className="muted mt-2.5 text-[0.78rem]">
          {numbers.callsWithoutNumber.toLocaleString("en-US")} of the calls in this period were recorded before
          we began capturing which line they arrived on, so they are counted in the totals above but not
          against a line here.
        </p>
      ) : null}
    </section>
  );
}

/**
 * Every call.
 *
 * Six columns, and the three the dashboard has that this does not are the point: no label
 * dropdown, no "decided by", no Reset. The label is shown; who set it is ours.
 */
export function ReportCallsTable({
  rows,
  limitNote,
  brand,
}: {
  rows: ReportRow[];
  /** Said out loud when the table was capped, so nobody reconciles 250 rows against 340 calls. */
  limitNote?: string;
  brand: ReportBrand;
}) {
  if (rows.length === 0) return null;

  return (
    <section className="card report-block">
      <div className="card-head">
        <div className="card-title" style={{ color: hex(brand.colors.blueDeep) }}>
          Every call
        </div>
        <span className="muted text-[0.76rem]">{rows.length.toLocaleString("en-US")} listed</span>
      </div>
      <div className="table-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>When</th>
              <th>Caller</th>
              <th>Line called</th>
              <th>Length</th>
              <th>How we read it</th>
              <th>What it was about</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={{ whiteSpace: "nowrap" }}>
                  <time dateTime={row.at}>{row.when}</time>
                </td>
                <td>
                  <span style={{ color: "var(--text)", fontWeight: 600 }}>{row.caller}</span>
                  {row.callerPhone ? <div className="muted text-[0.74rem]">{row.callerPhone}</div> : null}
                </td>
                <td>
                  {row.calledNumber || (
                    <span className="muted" title="This call was recorded before we began capturing which line it arrived on.">
                      —
                    </span>
                  )}
                </td>
                <td style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {row.duration || <span className="muted">—</span>}
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <span className="sig-dot mr-1.5" style={{ background: row.labelTone }} />
                  {row.labelName}
                </td>
                <td className="muted text-[0.82rem]">
                  {row.topic || <span title="Nothing has been written about this call yet.">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {limitNote ? <p className="muted mt-2.5 text-[0.78rem]">{limitNote}</p> : null}
      <p className="muted mt-1.5 text-[0.78rem]" style={{ color: hex(brand.colors.blueMid) }}>
        If any of these readings looks wrong to you, tell us which call and we will listen to it again.
      </p>
    </section>
  );
}

/**
 * The recordings, when there are any to show.
 *
 * One outcome, not two. Switched on, the players appear twenty-five at a time. Switched off, there
 * is no section: no players, no count, no sentence about recordings being held back. The guard
 * below is belt and braces -- `reportRecordings` already returns nothing to render when the
 * setting is off -- because this is the component that would do the leaking.
 */
export function ReportRecordingsSection({
  recordings,
  brand,
}: {
  recordings: ReportRecordings;
  brand: ReportBrand;
}) {
  if (!recordings.included || recordings.available === 0) return null;

  return (
    <section className="card report-block">
      <div className="card-head">
        <div className="card-title" style={{ color: hex(brand.colors.blueDeep) }}>
          Recordings
        </div>
      </div>
      {recordings.note ? (
        <p className="text-[0.88rem]" style={{ color: "var(--text-2)" }}>
          {recordings.note}
        </p>
      ) : null}
      {recordings.included ? (
        <div className="mt-3">
          <ReportRecordingPlayers rows={recordings.rows} />
        </div>
      ) : null}
    </section>
  );
}

/** The line at the bottom of the report, and at the bottom of every printed page. */
export function ReportFooterLine({
  brand,
  generatedAt,
}: {
  brand: ReportBrand;
  generatedAt: string;
}) {
  return (
    <p className="muted report-footer text-[0.76rem]" style={{ textAlign: "center" }}>
      {reportFooter(brand.companyName, generatedAt)}
      {brand.footerText ? ` · ${brand.footerText}` : ""}
    </p>
  );
}
