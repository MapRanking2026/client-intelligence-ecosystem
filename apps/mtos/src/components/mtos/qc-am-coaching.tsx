"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Loader2, MessageSquare } from "lucide-react";

import { readJsonResponse } from "@/src/lib/api/read-json-response";
import {
  changeLabel,
  valueLabel,
  type QcAmBreakdownRow,
  type QcAmFocus,
  type QcAmHistoryRow,
  type QcAmImproved,
  type QcAmKpi,
  type QcAmLatest,
  type QcAmTrendPoint,
} from "@/src/lib/contracts/qc-am";
import {
  APPEAL_INTRO,
  appealHint,
  appealBlockers,
  newAppealEntry,
  toAppealItems,
  type QcAppealCandidate,
  type QcAppealDraft,
} from "@/src/lib/contracts/qc-appeal-draft";
import { QC_SCORE_TARGET, qcTone, type CoachingItem } from "@/src/lib/contracts/qc-record";

/**
 * The Account Manager's own QA & Coaching page.
 *
 * Every number on this screen was computed on the server, in `qc-am.ts`, and arrives as plain
 * data. The component's only job is to draw it and to run the three things the AM can do. That
 * division is deliberate: this page shows somebody their own performance record, and the
 * arithmetic behind a sentence like "Up 4 from Oakline" belongs somewhere a test can reach it.
 *
 * ## Selecting a touch is a URL, not component state
 *
 * Clicking a bar in the chart or a row in the history navigates to `/qa?touch={id}`. It is one
 * round trip rather than none, and it buys three things: the notification link that QC's submit
 * raises is the same URL, so a bell click lands on exactly this view; the detail panel's notes and
 * coaching plan live on the touch document, so they would otherwise all have to be shipped to the
 * browser for every touch in the history; and the AM can send someone a link to the touch they are
 * looking at.
 *
 * ## Nothing here is red except a score below target
 *
 * The appeal path is violet, the same as QC's own screens, so the two sides of a disagreement look
 * like one conversation. Deltas are green or red because direction is the whole point of them. The
 * rest is neutral: this is a coaching page, not an alarm.
 */

function Chip({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "good" | "watch" | "risk" | "qc" | "muted";
}) {
  return <span className={`chip${tone ? ` ${tone}` : ""}`}>{children}</span>;
}

function ScoreAndRating({
  score,
  rating,
  size,
}: {
  score: number | null;
  rating: string | null;
  size: number;
}) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span
        style={{
          fontSize: `${size}rem`,
          fontWeight: 720,
          letterSpacing: "-0.03em",
          lineHeight: 1,
          color: "var(--text)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {/* A dash, never a zero. An unscored touch shown as 0 reads as a catastrophic review. */}
        {score === null ? "—" : score}
      </span>
      {score !== null && rating ? <Chip tone={qcTone(score)}>{rating}</Chip> : null}
    </div>
  );
}

function Delta({ delta, suffix }: { delta: number | null; suffix?: string }) {
  if (delta === null) return null;
  return (
    <Chip tone={delta >= 0 ? "good" : "risk"}>
      {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}
      {suffix ? ` ${suffix}` : ""}
    </Chip>
  );
}

function KpiTile({ kpi }: { kpi: QcAmKpi }) {
  const shown =
    kpi.text !== undefined
      ? kpi.text
      : kpi.value === null
        ? "—"
        : kpi.decimals === 1
          ? kpi.value.toFixed(1)
          : String(kpi.value);
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div className="muted text-[0.74rem] font-semibold">{kpi.label}</div>
      <div
        className="mt-1.5 font-bold"
        style={{
          fontSize: "1.7rem",
          letterSpacing: "-0.03em",
          lineHeight: 1,
          color: kpi.value === null && kpi.text === "—" ? "var(--slate-400)" : "var(--text)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {shown}
      </div>
      <div
        className="mt-1.5 text-[0.76rem]"
        style={{
          fontWeight: kpi.tone ? 600 : 400,
          color: kpi.tone === "risk" ? "var(--risk)" : kpi.tone === "good" ? "var(--good)" : "var(--text-3, var(--slate-400))",
        }}
      >
        {kpi.sub}
      </div>
    </div>
  );
}

/**
 * Score by monthly touch.
 *
 * The plot floor is 50, not 0 -- see `TREND_FLOOR`. The dashed line sits at the target, placed by
 * the same arithmetic the bars use so the line and the bars cannot disagree about where 80 is.
 */
function TrendChart({
  points,
  onSelect,
}: {
  points: QcAmTrendPoint[];
  onSelect: (touchId: string) => void;
}) {
  const targetPercent = useMemo(() => {
    const floor = 50;
    return Math.max(0, Math.min(100, ((QC_SCORE_TARGET - floor) / (100 - floor)) * 100));
  }, []);

  if (!points.length) {
    return (
      <p className="muted text-[0.86rem]">
        The chart appears once you have a scored touch. One bar per touch, in the order the calls
        happened.
      </p>
    );
  }

  return (
    <>
      <div
        className="relative mt-4 flex items-end gap-2.5"
        style={{ height: 190, padding: "0 4px", borderBottom: "1px solid var(--hair)" }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: `${targetPercent}%`,
            borderTop: "2px dashed var(--watch)",
            opacity: 0.55,
          }}
        />
        {points.map((point) => (
          <button
            key={point.touchId}
            type="button"
            onClick={() => onSelect(point.touchId)}
            title={`${point.client} · ${point.dateLabel} · ${point.score}`}
            aria-label={`${point.client}, ${point.dateLabel}, score ${point.score}`}
            style={{
              flex: "1 1 0",
              minWidth: 0,
              height: "100%",
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: 6,
              padding: 0,
              border: 0,
              background: "none",
            }}
          >
            <span
              className="text-[0.78rem] font-bold"
              style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}
            >
              {point.score}
            </span>
            <span
              style={{
                width: "100%",
                maxWidth: 54,
                height: `${point.heightPercent}%`,
                borderRadius: "8px 8px 3px 3px",
                background: point.onTarget ? "var(--accent)" : "var(--watch)",
                opacity: point.selected ? 1 : 0.55,
                outline: point.selected ? "2px solid var(--text)" : "none",
                outlineOffset: 2,
              }}
            />
          </button>
        ))}
      </div>
      <div className="flex gap-2.5" style={{ padding: "6px 4px 0" }}>
        {points.map((point) => (
          <div key={point.touchId} style={{ flex: "1 1 0", minWidth: 0, textAlign: "center" }}>
            <div
              className="text-[0.72rem]"
              style={{
                fontWeight: point.selected ? 700 : 550,
                color: point.selected ? "var(--text)" : "var(--text-2)",
                whiteSpace: "nowrap",
              }}
            >
              {point.dateLabel}
            </div>
            <div
              className="muted text-[0.66rem]"
              style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
            >
              {point.clientShort}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function BreakdownRow({ row }: { row: QcAmBreakdownRow }) {
  const colour =
    row.tone === "good"
      ? "var(--accent)"
      : row.tone === "watch"
        ? "var(--watch)"
        : row.tone === "risk"
          ? "var(--risk)"
          : "var(--hair)";
  return (
    <div style={{ padding: "9px 0", borderTop: "1px solid var(--hair)" }}>
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="muted text-[0.74rem] font-bold" style={{ width: 22 }}>
          {row.n}
        </span>
        <span
          className="text-[0.85rem]"
          style={{ flex: "1 1 180px", minWidth: 0, color: "var(--text)", fontWeight: 550 }}
        >
          {row.name}
          {row.tag ? (
            <span className="chip qc ml-2" style={{ fontSize: "0.64rem" }}>
              {row.tag}
            </span>
          ) : null}
        </span>
        <span className="flex gap-[3px]" aria-hidden>
          {[1, 2, 3, 4, 5].map((segment) => (
            <span
              key={segment}
              style={{
                width: 14,
                height: 6,
                borderRadius: 3,
                background: segment <= row.filled ? colour : "var(--hair)",
              }}
            />
          ))}
        </span>
        <span
          className="text-[0.8rem] font-bold"
          style={{ width: 40, textAlign: "right", color: "var(--text)" }}
        >
          {valueLabel(row.value)}
        </span>
        <span
          className="text-[0.74rem] font-bold"
          style={{
            width: 38,
            textAlign: "right",
            color:
              row.change === null
                ? "var(--slate-400)"
                : row.change > 0
                  ? "var(--good)"
                  : row.change < 0
                    ? "var(--risk)"
                    : "var(--slate-400)",
          }}
        >
          {changeLabel(row.change)}
        </span>
      </div>
      {row.found || row.next ? (
        <div className="mt-1.5 text-[0.78rem] leading-6" style={{ marginLeft: 32 }}>
          {row.found ? (
            <div style={{ color: "var(--text-2)" }}>
              <b style={{ color: "var(--text)", fontWeight: 600 }}>Found · </b>
              {row.found}
            </div>
          ) : null}
          {row.next ? (
            <div style={{ color: "var(--text-2)" }}>
              <b style={{ color: "var(--accent)", fontWeight: 600 }}>Next time · </b>
              {row.next}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CoachingCard({ item }: { item: CoachingItem }) {
  return (
    <div style={{ border: "1px solid var(--hair)", borderRadius: 12, padding: "14px 16px" }}>
      <div className="text-[0.92rem] font-bold" style={{ color: "var(--text)" }}>
        {item.idea}
      </div>
      {item.why ? (
        <div className="mt-2 text-[0.82rem] leading-6" style={{ color: "var(--text-2)" }}>
          <b style={{ color: "var(--text)", fontWeight: 600 }}>Why · </b>
          {item.why}
        </div>
      ) : null}
      {item.how ? (
        <div
          className="mt-2 text-[0.84rem] leading-6"
          style={{
            color: "var(--accent-ink)",
            background: "var(--accent-soft)",
            borderRadius: 9,
            padding: "9px 11px",
          }}
        >
          {item.how}
        </div>
      ) : null}
      {item.skip ? (
        <div className="muted mt-2 text-[0.76rem]">
          <b style={{ fontWeight: 600 }}>Skip it when · </b>
          {item.skip}
        </div>
      ) : null}
    </div>
  );
}

export interface QcAmCoachingProps {
  amName: string;
  reviewerName: string;
  headline: string;
  subtitle: string;
  pendingChips: string[];
  latest?: QcAmLatest;
  kpis: QcAmKpi[];
  trend: QcAmTrendPoint[];
  improved: QcAmImproved[];
  focus: QcAmFocus[];
  coaching: CoachingItem[];
  coachingFrom: string;
  history: QcAmHistoryRow[];
  /** Absent when the AM has no scored touch at all. */
  detail?: {
    touchId: string;
    client: string;
    dateLabel: string;
    score: number | null;
    rating: string | null;
    meta: string;
    strengths: string;
    focus: string;
    breakdown: QcAmBreakdownRow[];
    appealBanner?: string;
    appealReply?: string;
    appealCandidates: QcAppealCandidate[];
    canAppeal: boolean;
    canAcknowledge: boolean;
    chatRequested: boolean;
  };
}

export function QcAmCoaching({
  amName,
  reviewerName,
  headline,
  subtitle,
  pendingChips,
  latest,
  kpis,
  trend,
  improved,
  focus,
  coaching,
  coachingFrom,
  history,
  detail,
}: QcAmCoachingProps) {
  const router = useRouter();
  const [appealOpen, setAppealOpen] = useState(false);
  const [draft, setDraft] = useState<QcAppealDraft>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"" | "appeal" | "ack" | "chat">("");
  const [error, setError] = useState("");

  const select = useCallback(
    (touchId: string) => {
      setAppealOpen(false);
      setDraft({});
      setNote("");
      router.push(`/qa?touch=${touchId}`);
    },
    [router],
  );

  // Memoised because `act` depends on it: a fresh [] on every render would rebuild the callback
  // on every keystroke in the appeal form.
  const candidates = useMemo(() => detail?.appealCandidates || [], [detail?.appealCandidates]);
  const blockers = appealBlockers(draft, candidates);
  const hint = appealHint(draft, candidates);

  const act = useCallback(
    async (action: "submit_qc_appeal" | "acknowledge_qc" | "request_qc_chat") => {
      if (!detail) return;
      setBusy(action === "submit_qc_appeal" ? "appeal" : action === "acknowledge_qc" ? "ack" : "chat");
      setError("");
      try {
        const body =
          action === "submit_qc_appeal"
            ? {
                action,
                items: toAppealItems(draft, candidates),
                ...(note.trim() ? { note: note.trim() } : {}),
              }
            : { action };
        const response = await fetch(`/api/qc/${detail.touchId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = await readJsonResponse<{ error?: string }>(response);
        if (!response.ok) throw new Error(payload?.error || "That did not go through.");
        setAppealOpen(false);
        setDraft({});
        setNote("");
        router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "That did not go through.");
      } finally {
        setBusy("");
      }
    },
    [detail, draft, candidates, note, router],
  );

  const toggle = useCallback((candidate: QcAppealCandidate) => {
    setDraft((current) => {
      const next = { ...current };
      if (next[candidate.n]) delete next[candidate.n];
      else next[candidate.n] = newAppealEntry(candidate.current);
      return next;
    });
  }, []);

  const patch = useCallback((n: number, change: Partial<{ to: number; ctx: string; link: string }>) => {
    setDraft((current) => {
      const entry = current[n];
      if (!entry) return current;
      return { ...current, [n]: { ...entry, ...change } };
    });
  }, []);

  return (
    <>
      <section className="flex flex-wrap items-stretch justify-between gap-5">
        <div style={{ flex: "1 1 420px", maxWidth: "44rem" }}>
          <div className="eyebrow">
            <ClipboardCheck />
            <span>QA &amp; Coaching{amName ? ` · ${amName}` : ""}</span>
          </div>
          <h2 className="h2 mt-3">{headline}</h2>
          <p className="mt-3 text-[1rem] leading-7" style={{ color: "var(--text-2)" }}>
            {subtitle}
          </p>
          {pendingChips.length ? (
            <div className="mt-3.5 flex flex-wrap items-center gap-2 text-[0.8rem]">
              <span className="font-bold" style={{ color: "var(--violet)" }}>
                With {reviewerName} for QC:
              </span>
              {pendingChips.map((chip) => (
                <span key={chip} className="chip qc">
                  {chip}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {latest ? (
          <div className="card" style={{ flex: "0 1 340px", minWidth: 280 }}>
            <div className="flex items-center justify-between gap-2.5">
              <span className="muted text-[0.7rem] font-bold uppercase" style={{ letterSpacing: "0.1em" }}>
                Latest QC
              </span>
              {latest.isNew ? (
                <span
                  className="text-[0.68rem] font-bold"
                  style={{ padding: "2px 9px", borderRadius: 999, background: "var(--accent)", color: "var(--on-accent)" }}
                >
                  New
                </span>
              ) : null}
            </div>
            <div className="mt-2.5 text-[0.95rem] font-bold" style={{ color: "var(--text)" }}>
              {latest.client} · {latest.dateLabel}
            </div>
            <div className="mt-2.5 flex flex-wrap items-baseline gap-2.5">
              <ScoreAndRating score={latest.score} rating={latest.rating} size={2.6} />
              <Delta delta={latest.delta} suffix="vs last" />
            </div>
            <div className="muted mt-2 text-[0.76rem]">
              Scored by {latest.scoredBy} · {latest.scoredAtLabel}
            </div>
          </div>
        ) : null}
      </section>

      <div
        className="mt-6 grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}
      >
        {kpis.map((kpi) => (
          <KpiTile key={kpi.label} kpi={kpi} />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-stretch gap-4">
        <div className="card" style={{ flex: "1.4 1 480px", minWidth: 0 }}>
          <div className="flex items-center justify-between gap-2.5">
            <span className="muted text-[0.78rem] font-bold uppercase" style={{ letterSpacing: "0.05em" }}>
              Score by monthly touch
            </span>
            <span className="muted inline-flex items-center gap-1.5 text-[0.72rem]">
              <span style={{ width: 14, borderTop: "2px dashed var(--watch)" }} />
              Target {QC_SCORE_TARGET}
            </span>
          </div>
          <TrendChart points={trend} onSelect={select} />
        </div>

        <div className="flex flex-col gap-4" style={{ flex: "1 1 300px", minWidth: 0 }}>
          <div className="card" style={{ flex: 1 }}>
            <div
              className="text-[0.78rem] font-bold uppercase"
              style={{ letterSpacing: "0.05em", color: "var(--good)" }}
            >
              Where you improved
            </div>
            <div className="muted mt-1 text-[0.74rem]">Latest touch vs your 3 before it</div>
            {improved.length ? (
              improved.map((row) => (
                <div
                  key={row.n}
                  className="mt-1.5 flex items-center justify-between gap-2.5"
                  style={{ padding: "9px 0", borderTop: "1px solid var(--hair)" }}
                >
                  <span className="text-[0.84rem]" style={{ color: "var(--text)", fontWeight: 550 }}>
                    {row.name}
                  </span>
                  <span
                    className="text-[0.8rem] font-bold"
                    style={{ color: "var(--good)", whiteSpace: "nowrap" }}
                  >
                    {row.from} → {row.to}
                  </span>
                </div>
              ))
            ) : (
              <div className="muted mt-2.5 text-[0.82rem]">
                Steady across the board — no criterion moved up by half a point or more.
              </div>
            )}
          </div>

          <div className="card" style={{ flex: 1 }}>
            <div
              className="text-[0.78rem] font-bold uppercase"
              style={{ letterSpacing: "0.05em", color: "var(--watch)" }}
            >
              Focus next
            </div>
            <div className="muted mt-1 text-[0.74rem]">Lowest across your last 3 touches</div>
            {focus.length ? (
              focus.map((row) => (
                <div key={row.n} style={{ padding: "9px 0", borderTop: "1px solid var(--hair)", marginTop: 6 }}>
                  <div className="flex items-center justify-between gap-2.5">
                    <span className="text-[0.84rem]" style={{ color: "var(--text)", fontWeight: 550 }}>
                      {row.name}
                    </span>
                    <span className="text-[0.8rem] font-bold" style={{ color: "var(--watch)" }}>
                      {row.average.toFixed(1)} avg
                    </span>
                  </div>
                  <div className="mt-0.5 text-[0.76rem] leading-6" style={{ color: "var(--text-2)" }}>
                    {row.advice}
                  </div>
                </div>
              ))
            ) : (
              <div className="muted mt-2.5 text-[0.82rem]">
                Nothing to focus on yet — this fills in once you have a scored touch.
              </div>
            )}
          </div>
        </div>
      </div>

      {coaching.length ? (
        <div className="card mt-4">
          <div className="muted text-[0.78rem] font-bold uppercase" style={{ letterSpacing: "0.05em" }}>
            Coaching plan{coachingFrom ? ` · from ${coachingFrom}` : ""}
          </div>
          <p className="muted mt-0.5 text-[0.8rem]">
            Ideas to try — you decide which fit the client.
          </p>
          <div
            className="mt-3 grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}
          >
            {coaching.map((item, index) => (
              <CoachingCard key={`${item.idea}-${index}`} item={item} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-7 flex flex-wrap items-start gap-4">
        <div style={{ flex: "1 1 300px", minWidth: 0 }}>
          <div className="h3 mb-3">Touch history</div>
          <div className="card" style={{ padding: 6 }}>
            {history.length ? (
              history.map((row, index) => (
                <button
                  key={row.touchId}
                  type="button"
                  onClick={() => select(row.touchId)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "11px 12px",
                    border: 0,
                    borderRadius: 10,
                    background: row.selected ? "var(--accent-soft)" : "transparent",
                    marginTop: index ? 2 : 0,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                    <div className="text-[0.86rem] font-bold" style={{ color: "var(--text)" }}>
                      {row.client}
                    </div>
                    <div className="muted text-[0.74rem]">
                      {row.dateLabel} · {row.statusLabel}
                    </div>
                  </div>
                  <span
                    className="text-[0.74rem] font-bold"
                    style={{
                      minWidth: 30,
                      textAlign: "right",
                      color:
                        row.delta === null
                          ? "transparent"
                          : row.delta >= 0
                            ? "var(--good)"
                            : "var(--risk)",
                    }}
                  >
                    {row.delta === null
                      ? ""
                      : `${row.delta >= 0 ? "▲" : "▼"}${Math.abs(row.delta)}`}
                  </span>
                  <span
                    className={`chip${row.score === null ? " muted" : ` ${qcTone(row.score)}`}`}
                    style={{ minWidth: 44, justifyContent: "center" }}
                  >
                    {row.score === null ? "—" : row.score}
                  </span>
                </button>
              ))
            ) : (
              <p className="muted p-3 text-[0.86rem]">
                No scored touches yet. Each one appears here with its score and what changed.
              </p>
            )}
          </div>
        </div>

        {detail ? (
          <div className="card" style={{ flex: "2 1 520px", minWidth: 0, padding: "20px 22px" }}>
            <div className="flex flex-wrap items-start justify-between gap-3.5">
              <div>
                <div className="text-[1.1rem] font-bold" style={{ color: "var(--text)" }}>
                  {detail.client} · {detail.dateLabel}
                </div>
                <div className="muted mt-0.5 text-[0.78rem]">{detail.meta}</div>
              </div>
              <ScoreAndRating score={detail.score} rating={detail.rating} size={2} />
            </div>

            {detail.appealBanner ? (
              <div
                className="mt-3.5 text-[0.84rem] leading-6"
                style={{
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: "var(--violet-bg)",
                  color: "var(--violet)",
                }}
              >
                <div className="font-bold">{detail.appealBanner}</div>
                {detail.appealReply ? (
                  <div className="mt-1">
                    {reviewerName}: “{detail.appealReply}”
                  </div>
                ) : null}
              </div>
            ) : null}

            <div
              className="mt-4 grid gap-3"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}
            >
              <div style={{ borderRadius: 12, background: "var(--good-bg)", padding: "12px 14px" }}>
                <div
                  className="text-[0.7rem] font-bold uppercase"
                  style={{ letterSpacing: "0.06em", color: "var(--good)" }}
                >
                  What went well
                </div>
                <div className="mt-1 text-[0.84rem] leading-6" style={{ color: "var(--text)" }}>
                  {detail.strengths}
                </div>
              </div>
              <div style={{ borderRadius: 12, background: "var(--watch-bg)", padding: "12px 14px" }}>
                <div
                  className="text-[0.7rem] font-bold uppercase"
                  style={{ letterSpacing: "0.06em", color: "var(--watch)" }}
                >
                  Focus for next time
                </div>
                <div className="mt-1 text-[0.84rem] leading-6" style={{ color: "var(--text)" }}>
                  {detail.focus}
                </div>
              </div>
            </div>

            <div
              className="muted mt-4 text-[0.78rem] font-bold uppercase"
              style={{ letterSpacing: "0.05em" }}
            >
              17-point breakdown · change vs previous touch
            </div>
            <div className="mt-1.5">
              {detail.breakdown.map((row) => (
                <BreakdownRow key={row.n} row={row} />
              ))}
            </div>

            {appealOpen && detail.canAppeal ? (
              <div
                style={{
                  marginTop: 18,
                  border: "1px solid var(--violet)",
                  borderRadius: 14,
                  background: "var(--violet-bg)",
                  padding: "16px 18px",
                }}
              >
                <div className="text-[0.95rem] font-bold" style={{ color: "var(--text)" }}>
                  Appeal this score
                </div>
                <p className="muted mt-1 text-[0.82rem] leading-6">
                  {APPEAL_INTRO} {reviewerName} reviews and replies.
                </p>

                <div className="mt-3 flex flex-col gap-2">
                  {candidates.length ? (
                    candidates.map((candidate) => {
                      const entry = draft[candidate.n];
                      return (
                        <div
                          key={candidate.n}
                          style={{
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: `1px solid ${entry ? "var(--violet)" : "var(--hair)"}`,
                            background: "var(--surface)",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => toggle(candidate)}
                            aria-pressed={Boolean(entry)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              width: "100%",
                              padding: 0,
                              border: 0,
                              background: "none",
                              textAlign: "left",
                            }}
                          >
                            <span
                              aria-hidden
                              style={{
                                width: 20,
                                height: 20,
                                borderRadius: 6,
                                display: "grid",
                                placeItems: "center",
                                flexShrink: 0,
                                fontSize: "0.74rem",
                                fontWeight: 800,
                                border: `1.5px solid ${entry ? "var(--violet)" : "var(--hair)"}`,
                                background: entry ? "var(--violet)" : "var(--surface)",
                                color: "#ffffff",
                              }}
                            >
                              {entry ? "✓" : ""}
                            </span>
                            <span
                              className="text-[0.85rem]"
                              style={{ flex: 1, minWidth: 0, color: "var(--text)", fontWeight: 550 }}
                            >
                              {candidate.n} · {candidate.name}
                            </span>
                            <span className="muted text-[0.78rem]">scored {candidate.current}</span>
                          </button>

                          {entry ? (
                            <div className="mt-2.5 flex flex-col gap-2" style={{ marginLeft: 30 }}>
                              {candidate.found ? (
                                <div className="muted text-[0.78rem] leading-6">
                                  <b style={{ fontWeight: 600 }}>{reviewerName} wrote · </b>
                                  {candidate.found}
                                </div>
                              ) : null}
                              <div className="muted flex flex-wrap items-center gap-1.5 text-[0.76rem] font-semibold">
                                Should be
                                {candidate.options.map((option) => (
                                  <button
                                    key={option}
                                    type="button"
                                    onClick={() => patch(candidate.n, { to: option })}
                                    aria-pressed={entry.to === option}
                                    className="btn"
                                    style={{
                                      width: 30,
                                      height: 30,
                                      padding: 0,
                                      ...(entry.to === option
                                        ? {
                                            background: "var(--violet)",
                                            color: "#ffffff",
                                            borderColor: "transparent",
                                          }
                                        : {}),
                                    }}
                                  >
                                    {option}
                                  </button>
                                ))}
                              </div>
                              <textarea
                                className="input w-full"
                                rows={2}
                                value={entry.ctx}
                                onChange={(event) => patch(candidate.n, { ctx: event.target.value })}
                                placeholder="What QC didn't see — be specific (date, channel, who)"
                              />
                              <input
                                className="input w-full"
                                value={entry.link || ""}
                                onChange={(event) => patch(candidate.n, { link: event.target.value })}
                                placeholder="Link to proof (Intercom thread, ClickUp task, timestamp) — optional"
                              />
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                    <p className="muted text-[0.82rem]">
                      Every criterion on this touch is either a 5 or N/A, so there is nothing to
                      appeal.
                    </p>
                  )}
                </div>

                <textarea
                  className="input mt-2.5 w-full"
                  rows={2}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={`Anything else ${reviewerName} should know (optional)`}
                />

                <div className="mt-3 flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    className="btn text-[0.84rem]"
                    style={
                      blockers.length
                        ? undefined
                        : { background: "var(--violet)", color: "#ffffff", borderColor: "transparent" }
                    }
                    disabled={blockers.length > 0 || busy === "appeal"}
                    onClick={() => void act("submit_qc_appeal")}
                  >
                    {busy === "appeal" ? (
                      <Loader2 className="mr-1 inline animate-spin" style={{ width: 14, height: 14 }} />
                    ) : null}
                    Send appeal to {reviewerName}
                  </button>
                  <button
                    type="button"
                    className="btn text-[0.84rem]"
                    onClick={() => {
                      setAppealOpen(false);
                      setDraft({});
                      setNote("");
                    }}
                  >
                    Cancel
                  </button>
                  <span className="muted text-[0.76rem]">{hint}</span>
                </div>
              </div>
            ) : null}

            {error ? (
              <p className="mt-3 text-[0.82rem]" style={{ color: "var(--risk)" }}>
                {error}
              </p>
            ) : null}

            <div
              className="flex flex-wrap gap-2"
              style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--hair)" }}
            >
              {detail.canAcknowledge ? (
                <button
                  type="button"
                  className="btn btn-primary text-[0.84rem]"
                  disabled={busy === "ack"}
                  onClick={() => void act("acknowledge_qc")}
                >
                  {busy === "ack" ? (
                    <Loader2 className="mr-1 inline animate-spin" style={{ width: 14, height: 14 }} />
                  ) : null}
                  Mark as reviewed
                </button>
              ) : null}
              {detail.canAppeal && !appealOpen ? (
                <button
                  type="button"
                  className="btn text-[0.84rem]"
                  style={{ borderColor: "var(--violet)", color: "var(--violet)" }}
                  onClick={() => setAppealOpen(true)}
                >
                  Appeal this score
                </button>
              ) : null}
              <button
                type="button"
                className="btn text-[0.84rem]"
                disabled={detail.chatRequested || busy === "chat"}
                onClick={() => void act("request_qc_chat")}
              >
                {busy === "chat" ? (
                  <Loader2 className="mr-1 inline animate-spin" style={{ width: 14, height: 14 }} />
                ) : (
                  <MessageSquare className="mr-1 inline" style={{ width: 14, height: 14 }} />
                )}
                {detail.chatRequested
                  ? "Coaching chat requested"
                  : `Ask ${reviewerName} for a coaching chat`}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
