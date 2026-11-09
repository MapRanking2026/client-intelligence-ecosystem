import { PhoneIncoming, PieChart, BarChart3, Users, Hash, GitCompareArrows } from "lucide-react";

import { ColumnsChart, DonutChart } from "@/src/components/mtos/brief-chart";
import { CALL_LABELS, CALL_LABEL_LABEL, CALL_LABEL_TONE } from "@/src/lib/contracts/call-labels";
import { callersNote } from "@/src/lib/contracts/call-dashboard";
import type {
  CallMix,
  CallersSummary,
  Change,
  HeadlineTile,
  MeasureRow,
  NumberComparisonRow,
  NumbersBreakdown,
  TimeBucket,
  TimeBucketSize,
} from "@/src/lib/contracts/call-report";

/**
 * The read-only half of the call dashboard: tiles, donut, columns, callers, numbers, comparison.
 *
 * Server components throughout. Nothing here holds state, nothing fetches, and every figure
 * arrives already computed by `contracts/call-report.ts` -- so this file decides appearance and
 * nothing else. That split is what lets the arithmetic be tested without a browser.
 *
 * ## The one rule this file could break on its own
 *
 * The app's `.trend.up` class is green and `.trend.down` is red, which is direction-coloured. For
 * four of the five labels that is exactly backwards: a FALL in missed calls is the good news. So
 * nothing here uses those classes. The arrow glyph follows the direction, the colour follows
 * `change.good`, and the two disagree on purpose.
 */

function Delta({ change }: { change?: Change }) {
  // No comparison means no delta at all -- not a zero, and not a flat arrow against a period
  // nobody pulled.
  if (!change) return null;
  if (change.direction === "flat") {
    return (
      <span className="text-[0.74rem]" style={{ fontWeight: 650, color: "var(--slate-400)" }}>
        — no change
      </span>
    );
  }
  const colour = change.good ? "var(--good)" : "var(--risk)";
  const size =
    change.percent === undefined
      ? `${change.absolute > 0 ? "+" : ""}${change.absolute.toLocaleString("en-US")}`
      : `${Math.abs(Math.round(change.percent * 100))}%`;
  return (
    <span className="text-[0.74rem]" style={{ fontWeight: 650, color: colour }}>
      {change.direction === "up" ? "▲" : "▼"} {size}
    </span>
  );
}

/** The six tiles: total calls, then one per label. */
export function HeadlineTiles({ tiles }: { tiles: HeadlineTile[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      {tiles.map((tile) => (
        <div key={tile.key} className="card" style={{ padding: "15px 16px" }}>
          <div className="stat-label">
            {tile.tone ? <span className="sig-dot" style={{ background: tile.tone }} /> : null}
            {tile.label}
          </div>
          <div className="stat-val mt-2.5">{tile.value.toLocaleString("en-US")}</div>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-1.5">
            <Delta change={tile.change} />
            {tile.previous !== undefined ? (
              <span className="muted text-[0.72rem]">was {tile.previous.toLocaleString("en-US")}</span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CallMixPanel({ mix }: { mix: CallMix }) {
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">
          <PieChart />
          What the calls were
        </div>
        <span className="muted text-[0.76rem]">{mix.total.toLocaleString("en-US")} calls</span>
      </div>
      {mix.total === 0 ? (
        <p className="muted text-[0.84rem]">No calls in this period, so there is no mix to show.</p>
      ) : (
        <DonutChart
          donut={{
            slices: mix.slices.map((slice) => ({
              label: slice.name,
              value: slice.count,
              color: slice.tone,
            })),
            // A rate over no calls is absent, not 0%. `mix.total === 0` is handled above, so this
            // is only ever undefined if the contract says so.
            centreValue:
              mix.goodCallRate === undefined ? undefined : `${Math.round(mix.goodCallRate * 100)}%`,
            centreLabel: "good calls",
          }}
        />
      )}
    </div>
  );
}

export function CallsOverTimePanel({
  buckets,
  size,
}: {
  buckets: TimeBucket[];
  size: TimeBucketSize;
}) {
  const total = buckets.reduce((sum, bucket) => sum + bucket.total, 0);
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">
          <BarChart3 />
          When they came in
        </div>
        <span className="muted text-[0.76rem]">by {size}</span>
      </div>
      {total === 0 ? (
        <p className="muted text-[0.84rem]">No calls in this period.</p>
      ) : (
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
      )}
    </div>
  );
}

function CallerTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ padding: "11px 13px", borderRadius: "var(--r-md)", border: "1px solid var(--hair)", background: "var(--surface-2)" }}>
      <div className="stat-label">{label}</div>
      <div className="mt-1.5 text-[1.15rem]" style={{ fontWeight: 700, color: "var(--text)" }}>
        {value}
      </div>
      {sub ? <div className="muted mt-0.5 text-[0.72rem]">{sub}</div> : null}
    </div>
  );
}

export function CallersPanel({ callers }: { callers: CallersSummary }) {
  const rows = callers.rows.slice(0, 12);
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">
          <Users />
          Who called
        </div>
        <span className="muted text-[0.76rem]">{callers.rows.length.toLocaleString("en-US")} in the table</span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <CallerTile label="Unique callers" value={callers.uniqueCallers.toLocaleString("en-US")} />
        <CallerTile label="Rang again" value={callers.repeatCallers.toLocaleString("en-US")} sub="more than once in a cycle" />
        <CallerTile label="Saved in the CRM" value={callers.savedCallers.toLocaleString("en-US")} />
        {/* An em dash, never a zero: "we cannot tell" is not "none". */}
        <CallerTile
          label="New"
          value={callers.newCallers === undefined ? "—" : callers.newCallers.toLocaleString("en-US")}
          sub={callers.newCallers === undefined ? "needs an earlier pull" : "no earlier call on record"}
        />
      </div>

      <p className="muted mt-3 text-[0.76rem]">{callersNote(callers.newCallers, callers.unidentifiedCalls)}</p>

      {rows.length ? (
        <div className="table-scroll mt-3">
          <table className="tbl">
            <thead>
              <tr>
                <th>Caller</th>
                <th>Calls</th>
                <th>Cycles</th>
                <th>Last call</th>
                <th>Known by</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td style={{ color: "var(--text)", fontWeight: 600 }}>
                    {row.name || row.phone || "Not recorded"}
                    {row.name && row.phone ? (
                      <div className="muted text-[0.74rem]" style={{ fontWeight: 400 }}>
                        {row.phone}
                      </div>
                    ) : null}
                  </td>
                  <td>{row.calls}</td>
                  <td>{row.cycles.length}</td>
                  <td>{new Date(row.lastCallAt).toLocaleDateString("en-US", { timeZone: "UTC" })}</td>
                  <td>
                    <span className="chip">{row.identifiedBy === "contact" ? "CRM contact" : "Phone number"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {callers.rows.length > rows.length ? (
        <p className="muted mt-2 text-[0.74rem]">
          Showing the {rows.length} busiest of {callers.rows.length.toLocaleString("en-US")} callers.
        </p>
      ) : null}
    </div>
  );
}

export function ByNumberPanel({
  numbers,
  comparison,
}: {
  numbers: NumbersBreakdown;
  comparison?: NumberComparisonRow[];
}) {
  const previousByNumber = new Map((comparison || []).map((row) => [row.phoneNumber, row]));
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">
          <Hash />
          By tracking number
        </div>
        <span className="muted text-[0.76rem]">{numbers.blocks.length} line(s)</span>
      </div>

      {/*
        The banner is the whole point of this section when the data is missing. Three different
        kinds of nothing look identical without it, and the contract writes the right sentence.
      */}
      {numbers.warning ? (
        <div className="insight watch mb-3" style={{ gridTemplateColumns: "auto 1fr" }}>
          <div className="insight-icon">
            <Hash />
          </div>
          <p className="text-[0.84rem]" style={{ color: "var(--text-2)" }}>
            {numbers.warning}
          </p>
        </div>
      ) : null}

      {numbers.blocks.length === 0 ? null : (
        <div className="grid gap-3">
          {numbers.blocks.map((block) => {
            const before = previousByNumber.get(block.phoneNumber);
            const goodRate = block.total ? Math.round((block.goodCalls / block.total) * 100) : undefined;
            return (
              <div
                key={block.phoneNumber}
                style={{ padding: "13px 15px", borderRadius: "var(--r-md)", border: "1px solid var(--hair)", background: "var(--surface-2)" }}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <span style={{ fontWeight: 650, color: "var(--text)" }}>
                      {block.friendlyName || block.phoneNumber}
                    </span>
                    {block.friendlyName ? (
                      <span className="muted ml-2 text-[0.76rem]">{block.phoneNumber}</span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-baseline gap-3 text-[0.78rem]">
                    <span style={{ color: "var(--text)", fontWeight: 650 }}>
                      {block.total.toLocaleString("en-US")} calls
                    </span>
                    <span className="muted">{block.uniqueCallers.toLocaleString("en-US")} callers</span>
                    {/* A rate over no calls is absent, not 0%. */}
                    <span className="muted">{goodRate === undefined ? "—" : `${goodRate}% good`}</span>
                    {before ? <Delta change={before.change} /> : null}
                  </div>
                </div>

                {block.total > 0 ? (
                  <div className="catbar mt-2.5">
                    {CALL_LABELS.filter((label) => block.counts[label] > 0).map((label) => (
                      <span
                        key={label}
                        style={{
                          width: `${(block.counts[label] / block.total) * 100}%`,
                          background: CALL_LABEL_TONE[label],
                        }}
                        title={`${CALL_LABEL_LABEL[label]}: ${block.counts[label]}`}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="muted mt-2 text-[0.76rem]">This line took no calls in the period.</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ComparisonPanel({
  measures,
  periodLabel,
  comparisonLabel,
}: {
  measures: MeasureRow[];
  periodLabel: string;
  comparisonLabel: string;
}) {
  const hasComparison = measures.some((row) => row.previous !== undefined);
  const format = (row: MeasureRow, value: number) =>
    row.format === "percent" ? `${Math.round(value * 100)}%` : value.toLocaleString("en-US");

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">
          <GitCompareArrows />
          Against the period before
        </div>
        <span className="muted text-[0.76rem]">{comparisonLabel}</span>
      </div>

      {!hasComparison ? (
        <p className="muted text-[0.84rem]">
          There is nothing to compare against — no pull covers {comparisonLabel.toLowerCase()}. The figures
          above stand on their own rather than being measured against a period nobody looked at.
        </p>
      ) : (
        <div className="table-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Measure</th>
                <th>{periodLabel}</th>
                <th>{comparisonLabel}</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {measures.map((row) => (
                <tr key={row.key}>
                  <td style={{ color: "var(--text)", fontWeight: 600 }}>{row.label}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{format(row, row.value)}</td>
                  <td className="muted" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {row.previous === undefined ? "—" : format(row, row.previous)}
                  </td>
                  <td>
                    <Delta change={row.change} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The chip above the tiles saying what window is on screen and how many calls it holds. */
export function PeriodChip({ label, calls }: { label: string; calls: number }) {
  return (
    <span className="chip">
      <PhoneIncoming style={{ width: 13, height: 13 }} />
      {label} · {calls.toLocaleString("en-US")} calls
    </span>
  );
}
