import { AlertTriangle } from "lucide-react";

import type { ConfidenceBreakdown, ReadinessBreakdown, ScoreInput } from "@/src/lib/contracts/prep-workflow";

/**
 * Readiness and Confidence, with what they measure and what they are made of.
 *
 * The two numbers used to appear as bare chips next to each other, measuring things nobody could
 * name -- which is how a touch came to read `Ready · 94` on one screen and `Not prepared yet` on
 * the next. Each score now states its question, lists every input and whether it is there, and
 * shows an em dash rather than a number when nothing has been measured.
 */

const STATUS_TONE: Record<ScoreInput["status"], string> = {
  ok: "good",
  partial: "watch",
  missing: "muted",
  failed: "risk",
};

const STATUS_LABEL: Record<ScoreInput["status"], string> = {
  ok: "Done",
  partial: "Part way",
  missing: "Not yet",
  failed: "Failed",
};

function InputList({ inputs }: { inputs: ScoreInput[] }) {
  if (!inputs.length) return null;
  return (
    <ul className="mt-3 grid gap-2">
      {inputs.map((input) => (
        <li key={input.key} className="flex items-start gap-2.5 text-[0.82rem]">
          <span className={`sig-dot ${STATUS_TONE[input.status]}`} style={{ marginTop: 6 }} aria-hidden />
          <span className="min-w-0">
            <span style={{ color: "var(--text)", fontWeight: 600 }}>{input.label}</span>
            <span className="muted"> · {STATUS_LABEL[input.status]} · worth {input.weight} points</span>
            <br />
            <span className="muted">{input.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function ScoreCard({
  title,
  score,
  label,
  measures,
  inputs,
  problems,
  problemTitle,
}: {
  title: string;
  score: number | null;
  label: string;
  measures: string;
  inputs: ScoreInput[];
  problems: string[];
  problemTitle: string;
}) {
  const tone = score === null ? "muted" : score >= 80 ? "good" : score >= 55 ? "watch" : "risk";
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">{title}</div>
        <span className={`chip ${tone}`}>{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="stat-val" style={score === null ? { color: "var(--slate-400)" } : undefined}>
          {score === null ? "—" : score}
        </span>
        {score === null ? (
          <span className="muted text-[0.78rem]">not measured yet</span>
        ) : (
          <span className="muted text-[0.78rem]">out of 100</span>
        )}
      </div>
      <p className="muted mt-2.5 text-[0.8rem] leading-6">{measures}</p>

      {problems.length ? (
        <div className="mt-3 rounded-[10px] px-3 py-2.5" style={{ background: "var(--risk-bg)", color: "var(--risk)" }}>
          <div className="flex items-center gap-1.5 text-[0.78rem] font-semibold">
            <AlertTriangle style={{ width: 14, height: 14 }} />
            {problemTitle}
          </div>
          <ul className="mt-1.5 grid gap-1 text-[0.8rem]">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {inputs.length ? (
        <details className="mt-3">
          <summary className="ilink text-[0.82rem]">What this is made of</summary>
          <InputList inputs={inputs} />
        </details>
      ) : null}
    </div>
  );
}

export function ScoreBreakdown({
  readiness,
  confidence,
}: {
  readiness: ReadinessBreakdown;
  confidence: ConfidenceBreakdown;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ScoreCard
        title="Readiness"
        score={readiness.score}
        label={readiness.label}
        measures={readiness.measures}
        inputs={readiness.inputs}
        problems={readiness.blockers}
        problemTitle="Required steps that have not run or have failed"
      />
      <ScoreCard
        title="Confidence in the evidence"
        score={confidence.score}
        label={confidence.label}
        measures={confidence.measures}
        inputs={confidence.inputs}
        problems={confidence.gaps.slice(0, 5)}
        problemTitle="Gaps the preparation had to flag"
      />
    </div>
  );
}
