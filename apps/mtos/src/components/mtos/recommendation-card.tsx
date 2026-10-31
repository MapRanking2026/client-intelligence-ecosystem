import type { RecommendationItem } from "@/src/lib/mtos-data";

/**
 * One evidence-backed recommendation.
 *
 * Restyled onto the design system: the card, the chip and the hairline rules are the shared ones,
 * so this reads the same as every other card instead of relying on the compatibility layer to
 * reinterpret a set of dark Tailwind utilities. The nested grey boxes are gone -- the reasoning and
 * the evidence are separated by a rule rather than by a second and third container.
 */

const CONFIDENCE_TONE: Record<RecommendationItem["confidence"], string> = {
  High: "good",
  Medium: "watch",
  Low: "risk",
};

export function RecommendationCard({ item }: { item: RecommendationItem }) {
  return (
    <article className="card">
      <div className="card-head">
        <h3 className="h4">{item.title}</h3>
        <span className={`chip ${CONFIDENCE_TONE[item.confidence]}`}>{item.confidence} confidence</span>
      </div>

      <p className="text-[0.88rem] leading-6" style={{ color: "var(--text-2)" }}>
        {item.summary}
      </p>

      <div className="mt-3.5 border-t pt-3.5" style={{ borderColor: "var(--hair)" }}>
        <p className="card-title">Why</p>
        <p className="mt-2 text-[0.86rem] leading-6" style={{ color: "var(--text-2)" }}>
          {item.rationale}
        </p>
      </div>

      <div className="mt-3.5 border-t pt-3.5" style={{ borderColor: "var(--hair)" }}>
        <p className="card-title">Evidence</p>
        <ul className="mt-2 grid gap-2">
          {item.evidence.map((evidence) => (
            <li key={`${item.id}-${evidence.label}`} className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[0.86rem] font-semibold" style={{ color: "var(--text)" }}>
                {evidence.label}
              </span>
              <span className="muted text-[0.78rem]">
                {evidence.source} · {evidence.freshness}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
