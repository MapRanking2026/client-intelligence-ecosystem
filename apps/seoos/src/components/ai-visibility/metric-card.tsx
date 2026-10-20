import Link from "next/link";

import type { Rate } from "@/src/lib/ai-visibility/metrics";
import { pct } from "@/src/lib/ai-visibility/util";

/** A rate with its numerator/denominator, interval, and a link to the supporting observations. */
export function MetricCard({
  label,
  rate,
  href,
  swatch,
  denominatorLabel = "valid answers",
  formula,
}: {
  label: string;
  rate: Rate;
  href: string;
  swatch?: string;
  denominatorLabel?: string;
  formula: string;
}) {
  const ci = rate.ci ? `95% CI ${pct(rate.ci[0])}–${pct(rate.ci[1])}` : "no valid sample";
  return (
    <div className="aiv-metric">
      <div className="aiv-metric-label">
        {swatch ? <span className="aiv-swatch" style={{ background: swatch }} aria-hidden /> : null}
        {label}
      </div>
      <div className="aiv-metric-value">{rate.value === null ? "—" : pct(rate.value)}</div>
      <div className="aiv-metric-sub">
        {rate.num} of {rate.den} {denominatorLabel} · {ci}
      </div>
      <div className="aiv-metric-sub" title={formula}>
        {formula}
      </div>
      {rate.den > 0 ? <Link href={href}>View {rate.num} supporting observation{rate.num === 1 ? "" : "s"} →</Link> : null}
    </div>
  );
}
