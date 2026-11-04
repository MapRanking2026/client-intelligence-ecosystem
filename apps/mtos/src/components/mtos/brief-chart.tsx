import { SourceChips } from "@/src/components/mtos/source-chip";
import type {
  BriefChart,
  ChartCard,
  ChartCompareRow,
  ChartFunnelRow,
  ChartGoal,
  ChartLineSeries,
  ChartRankRow,
  ChartStackSegment,
  ChartTone,
} from "@/src/lib/contracts/brief-charts";

/**
 * A chart in the review brief, drawn above the paragraph that explains it.
 *
 * Deliberately plain: inline SVG and divs, no charting library. Seven shapes, each only ever asked
 * to draw between two and six values, is not what a charting dependency is for -- and these render
 * on the server inside a page that already loads a client's whole month, so the bundle is the one
 * cost worth refusing.
 *
 * Colours come from the app's CSS variables rather than the hex values in the prototype, which
 * means the charts follow the dark theme like everything else on the page. The prototype could
 * hardcode them because it only ever rendered light.
 *
 * Every panel carries its own source chips. A chart is the most quotable thing on the screen, so
 * "where did this come from" has to be answerable without scrolling to the section's own chips.
 */

const TONE_INK: Record<ChartTone, string> = {
  good: "var(--good)",
  watch: "var(--watch)",
  risk: "var(--risk)",
  info: "var(--info)",
  muted: "var(--slate-300)",
  teal: "var(--teal-400)",
};

const TONE_WASH: Record<ChartTone, string> = {
  good: "var(--good-bg)",
  watch: "var(--watch-bg)",
  risk: "var(--risk-bg)",
  info: "var(--info-bg)",
  muted: "var(--surface-3)",
  teal: "var(--accent-soft)",
};

/** The scale the rank chart is read against: first page of the map pack, with the top three shaded. */
const RANK_FLOOR = 20;

function Panel({ chart, children }: { chart: BriefChart; children: React.ReactNode }) {
  return (
    <figure
      className="mt-4 mb-1"
      style={{
        border: "1px solid var(--hair)",
        borderRadius: "var(--r-lg)",
        padding: "14px 16px",
        background: "var(--surface-2)",
        margin: 0,
      }}
    >
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[0.84rem]" style={{ fontWeight: 650, color: "var(--text)" }}>
          {chart.title}
        </span>
        {chart.period ? (
          <span className="text-[0.74rem]" style={{ color: "var(--slate-400)" }}>
            {chart.period}
          </span>
        ) : null}
      </figcaption>
      {children}
      <div className="mt-3">
        <SourceChips chips={chart.chips} />
      </div>
    </figure>
  );
}

function Cards({ cards }: { cards: ChartCard[] }) {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.label}
          style={{
            padding: "11px 13px",
            borderRadius: "var(--r-md)",
            border: "1px solid var(--hair)",
            background: "var(--surface)",
          }}
        >
          <div className="stat-label">{card.label}</div>
          <div className="mt-1.5 text-[1.15rem]" style={{ fontWeight: 700, color: "var(--text)" }}>
            {card.value}
          </div>
          {card.detail ? (
            <div className="mt-0.5 text-[0.74rem]" style={{ fontWeight: 650, color: TONE_INK[card.tone] }}>
              {card.detail}
            </div>
          ) : null}
          {card.bar !== undefined ? (
            <div
              className="mt-2"
              style={{ height: 6, borderRadius: 6, background: "var(--surface-3)", overflow: "hidden" }}
            >
              <div
                style={{
                  width: `${card.bar}%`,
                  height: "100%",
                  borderRadius: 6,
                  background: TONE_INK[card.barTone || card.tone],
                }}
              />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * Rank movement on a #1–#20 scale, with the top three shaded.
 *
 * Drawn against a fixed scale rather than scaled to the data, because the question is never "did
 * it move" -- a bar chart of 7 and 3 answers that -- it is "are we on the map pack yet", and only a
 * fixed scale with the top three marked answers that at a glance. Lower is better throughout, so
 * the arrow points left when the month went well.
 */
function Rank({ rows }: { rows: ChartRankRow[] }) {
  const position = (value: number) => `${Math.min(100, Math.max(0, ((value - 1) / (RANK_FLOOR - 1)) * 100))}%`;
  return (
    <div className="grid gap-3">
      {rows.map((row) => {
        const better = row.to < row.from;
        const same = row.to === row.from;
        const tone: ChartTone = same ? "muted" : better ? "good" : "risk";
        return (
          <div key={row.label}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[0.8rem]" style={{ color: "var(--text-2)" }}>
                {row.label}
              </span>
              <span className="text-[0.76rem]" style={{ fontWeight: 650, color: TONE_INK[tone] }}>
                {row.from.toFixed(1)} {same ? "·" : better ? "→" : "→"} {row.to.toFixed(1)}
                {same ? " no change" : ""}
              </span>
            </div>
            <div
              className="relative mt-1.5"
              style={{ height: 16, borderRadius: 8, background: "var(--surface-3)", overflow: "hidden" }}
            >
              {/* The top three: the only positions that win clicks. */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: position(3),
                  background: "var(--accent-soft)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: position(row.from),
                  top: 4,
                  width: 8,
                  height: 8,
                  marginLeft: -4,
                  borderRadius: "50%",
                  background: "var(--slate-400)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: position(row.to),
                  top: 2,
                  width: 12,
                  height: 12,
                  marginLeft: -6,
                  borderRadius: "50%",
                  background: TONE_INK[tone],
                }}
              />
            </div>
          </div>
        );
      })}
      <p className="text-[0.72rem]" style={{ color: "var(--slate-400)" }}>
        Position 1 on the left, 20 on the right. The shaded band is the top three. The small dot is the previous
        scan.
      </p>
    </div>
  );
}

/** Two series over the same number of points. Used for rank, where a lower line is a better month. */
function Line({ line }: { line: ChartLineSeries }) {
  const width = 320;
  const height = 96;
  const span = Math.max(1, line.max - line.min);
  const path = (points: number[]) =>
    points
      .map((value, index) => {
        const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
        const ratio = (value - line.min) / span;
        // A lower rank is a better month, so the axis is inverted for it: up on the chart is good
        // either way, which is the only reading an AM does at a glance.
        const y = line.lowerIsBetter ? ratio * height : height - ratio * height;
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label={line.bName}>
        <path d={path(line.a)} fill="none" stroke="var(--slate-400)" strokeWidth={2} strokeDasharray="4 4" />
        <path d={path(line.b)} fill="none" stroke="var(--accent)" strokeWidth={2.5} />
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-[0.74rem]" style={{ color: "var(--slate-400)" }}>
        <span className="inline-flex items-center gap-1.5">
          <span style={{ width: 14, height: 2, background: "var(--slate-400)", display: "inline-block" }} />
          {line.aName}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span style={{ width: 14, height: 2.5, background: "var(--accent)", display: "inline-block" }} />
          {line.bName}
        </span>
        <span>
          {line.lowerIsBetter ? "Higher on the chart is a better position." : "Higher on the chart is better."}
        </span>
      </div>
    </div>
  );
}

function Compare({ rows }: { rows: ChartCompareRow[] }) {
  const ceiling = Math.max(1, ...rows.flatMap((row) => [row.a, row.b]));
  return (
    <div className="grid gap-3">
      {rows.map((row) => {
        const better = row.lowerIsBetter ? row.b < row.a : row.b > row.a;
        const tone: ChartTone = row.a === row.b ? "muted" : better ? "good" : "risk";
        return (
          <div key={row.label}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[0.8rem]" style={{ color: "var(--text-2)" }}>
                {row.label}
              </span>
              <span className="text-[0.76rem]" style={{ fontWeight: 650, color: TONE_INK[tone] }}>
                {row.a.toLocaleString("en-US")} {"→"} {row.b.toLocaleString("en-US")}
              </span>
            </div>
            <div className="mt-1.5 grid gap-1">
              <div style={{ height: 8, borderRadius: 6, background: "var(--surface-3)" }}>
                <div
                  style={{
                    width: `${(row.a / ceiling) * 100}%`,
                    height: "100%",
                    borderRadius: 6,
                    background: "var(--slate-400)",
                  }}
                />
              </div>
              <div style={{ height: 8, borderRadius: 6, background: "var(--surface-3)" }}>
                <div
                  style={{
                    width: `${(row.b / ceiling) * 100}%`,
                    height: "100%",
                    borderRadius: 6,
                    background: TONE_INK[tone],
                  }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Funnel({ rows }: { rows: ChartFunnelRow[] }) {
  const ceiling = Math.max(1, ...rows.map((row) => row.value));
  return (
    <div className="grid gap-2">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-3">
          <span className="w-28 shrink-0 text-[0.78rem]" style={{ color: "var(--text-2)" }}>
            {row.label}
          </span>
          <span className="min-w-0 flex-1" style={{ height: 20, borderRadius: 6, background: "var(--surface-3)" }}>
            <span
              style={{
                display: "block",
                width: `${(row.value / ceiling) * 100}%`,
                height: "100%",
                borderRadius: 6,
                background: TONE_WASH[row.tone],
                borderLeft: `3px solid ${TONE_INK[row.tone]}`,
              }}
            />
          </span>
          <span className="w-12 shrink-0 text-right text-[0.8rem]" style={{ fontWeight: 700, color: "var(--text)" }}>
            {row.value.toLocaleString("en-US")}
          </span>
        </div>
      ))}
    </div>
  );
}

function Stack({ segments }: { segments: ChartStackSegment[] }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0) || 1;
  return (
    <div>
      <div className="flex" style={{ height: 22, borderRadius: 6, overflow: "hidden", background: "var(--surface-3)" }}>
        {segments.map((segment) => (
          <span
            key={segment.label}
            title={`${segment.label}: ${segment.value}`}
            style={{ width: `${(segment.value / total) * 100}%`, background: TONE_INK[segment.tone] }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[0.76rem]" style={{ color: "var(--text-2)" }}>
        {segments.map((segment) => (
          <span key={segment.label} className="inline-flex items-center gap-1.5">
            <span className="sig-dot" style={{ background: TONE_INK[segment.tone] }} />
            {segment.label} <b style={{ color: "var(--text)" }}>{segment.value.toLocaleString("en-US")}</b>
            <span style={{ color: "var(--slate-400)" }}>({Math.round((segment.value / total) * 100)}%)</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Progress against an agreed number, with where the period's pace says we should be.
 *
 * Nothing derives one of these yet -- MTOS has no stored numeric goal, and inventing the target
 * would be worse than leaving the section as prose. It is here so that the day a goal is stored,
 * the drawing is already done.
 */
function Goal({ goal }: { goal: ChartGoal }) {
  const share = Math.min(100, Math.round((goal.have / Math.max(1, goal.goal)) * 100));
  const ahead = share >= goal.pacePercent;
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[1.05rem]" style={{ fontWeight: 700, color: "var(--text)" }}>
          {goal.have.toLocaleString("en-US")} of {goal.goal.toLocaleString("en-US")} {goal.unit}
        </span>
        <span className="text-[0.76rem]" style={{ fontWeight: 650, color: ahead ? "var(--good)" : "var(--watch)" }}>
          {share}% there · pace says {goal.pacePercent}%
        </span>
      </div>
      <div
        className="relative mt-2"
        style={{ height: 14, borderRadius: 7, background: "var(--surface-3)", overflow: "hidden" }}
      >
        <div
          style={{
            width: `${share}%`,
            height: "100%",
            borderRadius: 7,
            background: ahead ? "var(--good)" : "var(--watch)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `${Math.min(100, goal.pacePercent)}%`,
            top: 0,
            bottom: 0,
            width: 2,
            background: "var(--text)",
          }}
        />
      </div>
    </div>
  );
}

export function BriefChartPanel({ chart }: { chart: BriefChart }) {
  return (
    <Panel chart={chart}>
      {chart.kind === "cards" && chart.cards ? <Cards cards={chart.cards} /> : null}
      {chart.kind === "rank" && chart.rank ? <Rank rows={chart.rank} /> : null}
      {chart.kind === "line" && chart.line ? <Line line={chart.line} /> : null}
      {chart.kind === "compare" && chart.compare ? <Compare rows={chart.compare} /> : null}
      {chart.kind === "funnel" && chart.funnel ? <Funnel rows={chart.funnel} /> : null}
      {chart.kind === "stack" && chart.stack ? <Stack segments={chart.stack} /> : null}
      {chart.kind === "goal" && chart.goal ? <Goal goal={chart.goal} /> : null}
    </Panel>
  );
}
