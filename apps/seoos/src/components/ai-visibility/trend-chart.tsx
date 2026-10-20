import type { TrendPoint } from "@/src/lib/ai-visibility/metrics";
import { pct } from "@/src/lib/ai-visibility/util";

const SERIES = [
  { key: "mentionRate", label: "Mention rate", color: "var(--aiv-s1)", dash: "" },
  { key: "recommendationRate", label: "Recommendation rate", color: "var(--aiv-s2)", dash: "6 3" },
  { key: "ownedCitationRate", label: "Owned-domain citation rate", color: "var(--aiv-s3)", dash: "2 3" },
] as const;

/**
 * Per-scan trend (one y-axis, 0–100%). Each point carries a native tooltip
 * with n; points after a configuration/model change are marked with a dashed
 * vertical rule and are NOT presented as comparable. A table view follows.
 */
export function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) {
    return <p className="muted">A trend appears after two or more scans with collected answers.</p>;
  }
  const W = 720;
  const H = 220;
  const pad = { l: 40, r: 16, t: 12, b: 28 };
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, points.length - 1);
  const y = (v: number) => pad.t + (1 - v) * (H - pad.t - pad.b);
  return (
    <figure style={{ margin: 0 }}>
      <div className="aiv-legend" aria-hidden>
        {SERIES.map((s) => (
          <span key={s.key}>
            <svg width="22" height="8" style={{ verticalAlign: "middle", marginRight: 4 }}>
              <line x1="0" y1="4" x2="22" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} />
            </svg>
            {s.label}
          </span>
        ))}
      </div>
      <svg className="aiv-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Visibility rates per scan">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line className="grid" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          p.comparableToPrevious === false ? (
            <g key={`c${p.scanId}`}>
              <line x1={x(i) - (x(1) - x(0)) / 2} x2={x(i) - (x(1) - x(0)) / 2} y1={pad.t} y2={H - pad.b} stroke="var(--aiv-warn)" strokeDasharray="4 4" />
              <title>{p.changeNote ?? "Configuration changed"} — not comparable to the previous scan</title>
            </g>
          ) : null,
        )}
        {SERIES.map((s) => {
          const segs: string[] = [];
          points.forEach((p, i) => {
            const v = p[s.key];
            if (v === null) return;
            const cmd = i === 0 || p.comparableToPrevious === false || points[i - 1][s.key] === null ? "M" : "L";
            segs.push(`${cmd}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
          });
          return <path key={s.key} d={segs.join(" ")} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} />;
        })}
        {SERIES.map((s) =>
          points.map((p, i) =>
            p[s.key] === null ? null : (
              <g key={`${s.key}${p.scanId}`}>
                <circle cx={x(i)} cy={y(p[s.key]!)} r="4" fill={s.color} stroke="var(--panel)" strokeWidth="2" />
                <circle cx={x(i)} cy={y(p[s.key]!)} r="12" fill="transparent">
                  <title>{`${s.label}: ${pct(p[s.key])} (n=${p.valid}) — ${p.at.slice(0, 10)}`}</title>
                </circle>
              </g>
            ),
          ),
        )}
        {points.map((p, i) => (
          <text key={`x${p.scanId}`} x={x(i)} y={H - 8} textAnchor="middle">
            {p.at.slice(5, 10)}
          </text>
        ))}
      </svg>
      <details>
        <summary className="muted" style={{ fontSize: 12.5, cursor: "pointer" }}>Table view</summary>
        <table className="data">
          <thead>
            <tr>
              <th>Scan date</th>
              <th className="num">Valid n</th>
              <th className="num">Mention</th>
              <th className="num">Recommendation</th>
              <th className="num">Owned citation</th>
              <th>Comparable</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.scanId}>
                <td>{p.at.slice(0, 16).replace("T", " ")}</td>
                <td className="num">{p.valid}</td>
                <td className="num">{pct(p.mentionRate)}</td>
                <td className="num">{pct(p.recommendationRate)}</td>
                <td className="num">{pct(p.ownedCitationRate)}</td>
                <td>{p.comparableToPrevious === null ? "—" : p.comparableToPrevious ? "Yes" : `No — ${p.changeNote}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
