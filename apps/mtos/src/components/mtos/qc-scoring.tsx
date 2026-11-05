"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, Loader2, Sparkles, Trash2 } from "lucide-react";

import { readJsonResponse } from "@/src/lib/api/read-json-response";
import {
  QC_GROUPS,
  criteriaInGroup,
  type QcCriterion,
} from "@/src/lib/contracts/qc-rubric";
import {
  QC_KPI_TARGET,
  qcKpis,
  qcProgress,
  qcRating,
  qcScore,
  qcTone,
  emptyDraftCrit,
  type CoachingItem,
  type QcCriterionNote,
  type QcDraftValue,
  type QcGoal,
  type TouchQc,
} from "@/src/lib/contracts/qc-record";
import {
  applyAllSuggestions,
  notesShouldOpen,
  prefillFound,
  submitBlockers,
  submitHint,
} from "@/src/lib/contracts/qc-submit";
import { useQcDraftAutosave } from "@/src/components/mtos/use-qc-draft-autosave";
import type { QcSource } from "@/src/lib/server/services/qc-review-service";

/**
 * The QC scoring screen: seventeen criteria, three KPIs, a coaching plan and one submit.
 *
 * ## The reviewer's judgement is the only thing that is written
 *
 * The AI pre-read is everywhere on this screen and decides nothing. A suggestion is a dashed chip
 * the reviewer may click; "Apply all suggestions" fills **only** the criteria still undecided
 * (`applyAllSuggestions` is where that rule lives and is tested). Nothing the reviewer has set is
 * ever replaced by a model, because the score goes out under their name and is averaged into
 * somebody's KPIs.
 *
 * ## Notes open themselves under 4
 *
 * A score of 3 or less without a note is a judgement an AM cannot act on or argue with, so the
 * note opens and the evidence line is pre-filled. The reviewer can still delete every word of it --
 * what is prevented is accidentally sending a low score with nothing behind it.
 *
 * ## Everything is autosaved, nothing is submitted by accident
 *
 * The draft saves to the server about 800 ms after each change, so an hour of work survives a
 * closed tab. The submit bar stays disabled until all seventeen are decided and the goal is set,
 * and it says which of those is missing rather than greying out silently.
 */

const SCORE_SCALE = [
  { value: 5, label: "5", meaning: "model" },
  { value: 4, label: "4", meaning: "solid" },
  { value: 3, label: "3", meaning: "acceptable" },
  { value: 2, label: "2", meaning: "below standard" },
  { value: 1, label: "1", meaning: "missing" },
] as const;

const GOALS: { value: QcGoal; hint: string }[] = [
  { value: "Yes", hint: "A numeric goal was agreed and written in the Client's Book." },
  { value: "Partial", hint: "Mentioned without a number, a time frame or anywhere it was written down." },
  { value: "No", hint: "No goal was discussed." },
  { value: "N/A", hint: "No goal applied to this call." },
];

function dateLabel(iso: string | undefined): string {
  if (!iso) return "no date";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "no date";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function agoLabel(iso: string | undefined): string {
  if (!iso) return "at an unrecorded time";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "at an unrecorded time";
  const hours = Math.floor((Date.now() - at) / 3_600_000);
  if (hours < 1) return "less than an hour ago";
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function ScoreButton({
  value,
  selected,
  onPick,
  children,
}: {
  value: QcDraftValue;
  selected: boolean;
  onPick: (value: QcDraftValue) => void;
  children: React.ReactNode;
}) {
  // Selected low scores get the light-violet tint rather than the solid fill: a 1 and a 5 should
  // not look equally emphatic on a coaching instrument.
  const light = selected && typeof value === "number" && value >= 1 && value <= 3;
  return (
    <button
      type="button"
      onClick={() => onPick(value)}
      aria-pressed={selected}
      className="btn text-[0.8rem]"
      style={
        selected
          ? light
            ? { background: "var(--violet-bg)", color: "var(--violet)", borderColor: "var(--violet)" }
            : { background: "var(--violet)", color: "#fff", borderColor: "transparent" }
          : undefined
      }
    >
      {children}
    </button>
  );
}

export function QcScoring({
  touchId,
  qc,
  client,
  amName,
  amFirstName,
  sources,
  scheduledAt,
  callLengthMin,
  canScore,
}: {
  touchId: string;
  qc: TouchQc;
  client: string;
  amName: string;
  amFirstName: string;
  sources: QcSource[];
  scheduledAt?: string;
  callLengthMin?: number;
  /** False for an admin or manager: they may watch the queue, but only a reviewer scores. */
  canScore: boolean;
}) {
  const router = useRouter();
  const alreadyScored = qc.score !== undefined || qc.status === "scored" || qc.status === "reviewed";
  const readOnly = !canScore || alreadyScored;

  const initial = qc.draft || {
    crit: (qc.crit as QcDraftValue[] | undefined) || emptyDraftCrit(),
    notes: qc.notes || {},
    goal: qc.goal,
    strengths: qc.strengths,
    focus: qc.focus,
    coaching: qc.coaching,
  };

  const [crit, setCrit] = useState<QcDraftValue[]>(() => {
    const base = emptyDraftCrit();
    (initial.crit || []).forEach((value, index) => {
      if (index < base.length) base[index] = value === undefined ? -1 : value;
    });
    return base;
  });
  const [notes, setNotes] = useState<Record<number, QcCriterionNote>>(initial.notes || {});
  const [goal, setGoal] = useState<QcGoal | undefined>(initial.goal);
  const [strengths, setStrengths] = useState(initial.strengths || qc.ai?.strengths || "");
  const [focus, setFocus] = useState(initial.focus || qc.ai?.focus || "");
  const [coaching, setCoaching] = useState<CoachingItem[]>(
    initial.coaching || qc.ai?.coaching || [],
  );
  const [openNotes, setOpenNotes] = useState<Set<number>>(
    () => new Set(Object.keys(initial.notes || {}).map(Number)),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const autosave = useQcDraftAutosave(touchId);
  const started = useRef(false);

  // Opening a `ready` item is what marks it in progress. Done here rather than on the queue's link
  // so it happens however the reviewer arrived -- including straight from a notification.
  useEffect(() => {
    if (started.current || readOnly || qc.status !== "ready") return;
    started.current = true;
    void fetch(`/api/qc/${touchId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "start_qc" }),
    }).catch(() => {
      // A failed claim is not worth interrupting the review for: the record is still scoreable, and
      // the only cost is that the queue shows it as Ready a little longer.
    });
  }, [touchId, qc.status, readOnly]);

  const snapshot = useMemo(
    () => ({ crit, notes, goal, strengths, focus, coaching }),
    [crit, notes, goal, strengths, focus, coaching],
  );

  const dirty = useRef(false);
  useEffect(() => {
    if (readOnly) return;
    if (!dirty.current) {
      // Don't write a draft just for opening the screen -- that would stamp `savedAt` on a record
      // nobody has touched and make "last saved" a lie.
      dirty.current = true;
      return;
    }
    autosave.save(snapshot);
  }, [snapshot, autosave, readOnly]);

  const score = qcScore(crit);
  const progress = qcProgress(crit, goal);
  const kpis = qcKpis(crit, goal);
  const blockers = submitBlockers(crit, goal);

  const setCriterion = useCallback(
    (n: number, value: QcDraftValue) => {
      setCrit((current) => {
        const next = [...current];
        next[n - 1] = value;
        return next;
      });
      // Picking a score pre-fills "What we found" from the pre-read's evidence when it is empty,
      // and opens the note when the score is low enough to need one.
      setNotes((current) => {
        const filled = prefillFound(current[n], qc.ai?.evidence?.[n - 1]);
        return filled === current[n] ? current : { ...current, [n]: filled as QcCriterionNote };
      });
      if (notesShouldOpen(value)) {
        setOpenNotes((current) => new Set(current).add(n));
      }
    },
    [qc.ai],
  );

  const applyAll = useCallback(() => {
    const applied = applyAllSuggestions(crit, notes, goal, qc.ai);
    setCrit(applied.crit);
    setNotes(applied.notes);
    if (applied.goal) setGoal(applied.goal);
    if (!strengths && qc.ai?.strengths) setStrengths(qc.ai.strengths);
    if (!focus && qc.ai?.focus) setFocus(qc.ai.focus);
    if (!coaching.length && qc.ai?.coaching?.length) setCoaching(qc.ai.coaching);
  }, [crit, notes, goal, qc.ai, strengths, focus, coaching.length]);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setError("");
    try {
      // Flush first so a draft save in flight cannot land after the submission and resurrect a
      // draft on a record that now has a score.
      await autosave.flush();
      const response = await fetch(`/api/qc/${touchId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "submit_qc", crit, notes, goal, strengths, focus, coaching }),
      });
      const payload = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(payload?.error || "The score could not be submitted.");
      // The queue builds the flash from the stored record, so the copy comes from real data rather
      // than from text carried in a URL.
      router.push(`/qa?scored=${touchId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The score could not be submitted.");
      setSubmitting(false);
    }
  }, [autosave, touchId, crit, notes, goal, strengths, focus, coaching, router]);

  const saveLabel =
    autosave.state === "saving"
      ? "Saving…"
      : autosave.state === "error"
        ? autosave.error || "This draft could not be saved."
        : autosave.savedAt
          ? "Draft saved"
          : "";

  return (
    <>
      <Link href="/qa" className="ilink text-[0.8rem]">
        <ArrowLeft className="mr-1 inline" style={{ width: 14, height: 14 }} />
        QC queue
      </Link>

      <div className="section-head" style={{ marginTop: 10 }}>
        <div>
          <div className="eyebrow" style={{ color: "var(--violet)" }}>
            <span>QC · Monthly Touch</span>
          </div>
          <h2 className="h2 mt-2">{client}</h2>
          <div className="muted mt-1 text-[0.82rem]">
            {amName || "Unnamed account manager"} · {dateLabel(scheduledAt)} ·{" "}
            {typeof callLengthMin === "number" && callLengthMin > 0 ? `${callLengthMin} min` : "length not recorded"} ·
            finished follow-through {agoLabel(qc.readyAt)}
          </div>
        </div>
        <div className="card" style={{ minWidth: 220, padding: "14px 16px" }}>
          <div className="muted text-[0.7rem]">Live score</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-bold" style={{ fontSize: "1.8rem", color: "var(--text)" }}>
              {score === null ? "—" : score}
            </span>
            {score === null ? null : <span className={`chip ${qcTone(score)}`}>{qcRating(score)}</span>}
          </div>
          <div className="muted mt-1 text-[0.74rem]">
            {progress.decided} of {progress.total} graded
          </div>
          <div className="muted mt-2 text-[0.74rem]">
            Prep {kpis.prep ?? "—"} · Post-touch {kpis.postTouch ?? "—"} · Goal {goal || "—"}
          </div>
          {saveLabel ? (
            <div
              className="mt-2 text-[0.72rem]"
              style={{ color: autosave.state === "error" ? "var(--risk)" : "var(--slate-400)" }}
            >
              {saveLabel}
            </div>
          ) : null}
        </div>
      </div>

      {readOnly ? (
        <div className="card mb-4" style={{ background: "var(--surface-2)" }}>
          <div className="font-semibold text-[0.86rem]">
            {alreadyScored ? "This touch has already been scored." : "You are viewing this review."}
          </div>
          <p className="muted mt-1 text-[0.82rem]">
            {alreadyScored
              ? "It is shown as it was submitted. Scores are changed through an appeal, not by re-scoring."
              : "Scoring is done by a QC reviewer, so that one calibrated person produces every score the team is compared on."}
          </p>
        </div>
      ) : qc.ai ? (
        <div
          className="card mb-4 flex flex-wrap items-center justify-between gap-3"
          style={{ background: "var(--violet-bg)", borderColor: "transparent" }}
        >
          <div className="text-[0.84rem] leading-6" style={{ color: "var(--violet)" }}>
            <Sparkles className="mr-1 inline" style={{ width: 15, height: 15 }} />
            AI pre-read the full transcript and the follow-through. Each criterion has a suggested
            score with the moment it came from — you set the final score.
          </div>
          <button type="button" className="btn text-[0.8rem]" onClick={applyAll}>
            Apply all suggestions
          </button>
        </div>
      ) : (
        <div className="card mb-4" style={{ background: "var(--surface-2)" }}>
          <div className="text-[0.84rem]">No AI pre-read for this call — grade from the transcript.</div>
        </div>
      )}

      <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="grid gap-4">
            {QC_GROUPS.map((group) => {
              const criteria = criteriaInGroup(group);
              if (!criteria.length) return null;
              return (
                <div key={group} className="card">
                  <div className="eyebrow muted">{group}</div>
                  <div className="mt-3 grid gap-5">
                    {criteria.map((criterion) => (
                      <CriterionRow
                        key={criterion.n}
                        criterion={criterion}
                        value={crit[criterion.n - 1]}
                        note={notes[criterion.n]}
                        suggestion={qc.ai?.crit?.[criterion.n - 1] ?? null}
                        evidence={qc.ai?.evidence?.[criterion.n - 1]}
                        open={openNotes.has(criterion.n)}
                        readOnly={readOnly}
                        onPick={(value) => setCriterion(criterion.n, value)}
                        onToggleNotes={() =>
                          setOpenNotes((current) => {
                            const next = new Set(current);
                            if (next.has(criterion.n)) next.delete(criterion.n);
                            else next.add(criterion.n);
                            return next;
                          })
                        }
                        onNote={(note) =>
                          setNotes((current) => ({ ...current, [criterion.n]: note }))
                        }
                      />
                    ))}
                  </div>
                </div>
              );
            })}

            <div className="card">
              <div className="eyebrow muted">Client goal KPI</div>
              <h3 className="mt-2 font-semibold" style={{ color: "var(--text)" }}>
                Was a goal agreed and written down?
              </h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {GOALS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    disabled={readOnly}
                    onClick={() => setGoal(option.value)}
                    aria-pressed={goal === option.value}
                    className="btn text-[0.8rem]"
                    style={
                      goal === option.value
                        ? { background: "var(--violet)", color: "#fff", borderColor: "transparent" }
                        : undefined
                    }
                  >
                    {option.value}
                  </button>
                ))}
              </div>
              <ul className="muted mt-3 grid gap-1 text-[0.78rem]">
                {GOALS.map((option) => (
                  <li key={option.value}>
                    <strong style={{ color: "var(--text-2)" }}>{option.value}</strong> — {option.hint}
                  </li>
                ))}
              </ul>
            </div>

            <div className="card">
              <div className="eyebrow muted">What went well</div>
              <textarea
                className="input mt-2 w-full"
                rows={3}
                disabled={readOnly}
                value={strengths}
                onChange={(event) => setStrengths(event.target.value)}
                placeholder="What this AM did well on this call."
              />
              <div className="eyebrow muted mt-4">Focus for next time</div>
              <textarea
                className="input mt-2 w-full"
                rows={3}
                disabled={readOnly}
                value={focus}
                onChange={(event) => setFocus(event.target.value)}
                placeholder="The one or two things to work on."
              />
            </div>

            <CoachingPlan
              items={coaching}
              readOnly={readOnly}
              onChange={setCoaching}
            />
          </div>

          <aside className="grid gap-4 self-start lg:sticky lg:top-4">
            <div className="card">
              <div className="eyebrow muted">Follow-through evidence</div>
              <div className="muted mt-1 text-[0.72rem]">
                Pulled when {amFirstName || "the AM"} clicked Finish
              </div>
              <div className="mt-3 grid gap-2">
                {qc.evidence?.length ? (
                  qc.evidence.map((item) => (
                    <div key={item.label} className="flex items-start gap-2 text-[0.78rem]">
                      {item.ok ? (
                        <Check style={{ width: 14, height: 14, color: "var(--good)", flexShrink: 0, marginTop: 2 }} />
                      ) : (
                        <AlertTriangle
                          style={{ width: 14, height: 14, color: "var(--risk)", flexShrink: 0, marginTop: 2 }}
                        />
                      )}
                      <div>
                        <div style={{ color: "var(--text)" }}>{item.label}</div>
                        <div className="muted text-[0.74rem]">{item.detail}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="muted text-[0.78rem]">No evidence snapshot was taken for this touch.</p>
                )}
              </div>
            </div>

            <div className="card">
              <div className="eyebrow muted">Sources</div>
              <div className="mt-3 grid gap-2 text-[0.78rem]">
                {sources.map((source) => (
                  <div key={source.label}>
                    {source.href ? (
                      <a className="ilink" href={source.href} target="_blank" rel="noreferrer">
                        {source.label} ↗
                      </a>
                    ) : (
                      <>
                        <div style={{ color: "var(--text-2)" }}>{source.label}</div>
                        <div className="muted text-[0.74rem]">{source.absent}</div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="eyebrow muted">Scale</div>
              <ul className="muted mt-2 grid gap-1 text-[0.76rem]">
                {SCORE_SCALE.map((item) => (
                  <li key={item.value}>
                    <strong style={{ color: "var(--text-2)" }}>{item.label}</strong> {item.meaning}
                  </li>
                ))}
                <li>
                  <strong style={{ color: "var(--text-2)" }}>N/A</strong> did not apply — excluded
                  from the score
                </li>
              </ul>
              <div className="eyebrow muted mt-4">Rating</div>
              <ul className="muted mt-2 grid gap-1 text-[0.76rem]">
                <li>A 90 and above · B 80–89 · C 70–79 · D below 70</li>
                <li>Target 80 overall, {QC_KPI_TARGET}+ on each KPI</li>
              </ul>
            </div>
          </aside>
        </div>
      </div>

      {readOnly ? null : (
        <div
          className="card mt-5 flex flex-wrap items-center justify-between gap-3"
          style={{ background: "#0f2a44", borderColor: "transparent" }}
        >
          <div className="text-[0.84rem]" style={{ color: "#dbe6f0" }}>
            {error || submitHint(crit, goal, amFirstName)}
          </div>
          <button
            type="button"
            className="btn btn-primary text-[0.84rem]"
            disabled={blockers.length > 0 || submitting}
            onClick={() => void submit()}
          >
            {submitting ? (
              <Loader2 className="mr-1 inline animate-spin" style={{ width: 14, height: 14 }} />
            ) : null}
            Submit QC &amp; notify {amFirstName || "the AM"}
          </button>
        </div>
      )}
    </>
  );
}

function CriterionRow({
  criterion,
  value,
  note,
  suggestion,
  evidence,
  open,
  readOnly,
  onPick,
  onToggleNotes,
  onNote,
}: {
  criterion: QcCriterion;
  value: QcDraftValue | undefined;
  note: QcCriterionNote | undefined;
  suggestion: number | null;
  evidence?: string;
  open: boolean;
  readOnly: boolean;
  onPick: (value: QcDraftValue) => void;
  onToggleNotes: () => void;
  onNote: (note: QcCriterionNote) => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="av-sm"
          style={{
            width: 24,
            height: 24,
            borderRadius: 7,
            fontSize: "0.7rem",
            background: "var(--surface-3)",
            color: "var(--text-2)",
          }}
        >
          {criterion.n}
        </span>
        <span className="font-semibold text-[0.88rem]" style={{ color: "var(--text)" }}>
          {criterion.name}
        </span>
        {criterion.kpi ? <span className="chip watch">{criterion.kpi}</span> : null}
      </div>
      <p className="muted mt-1 text-[0.8rem] leading-6">{criterion.description}</p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {SCORE_SCALE.map((item) => (
          <ScoreButton
            key={item.value}
            value={item.value as QcDraftValue}
            selected={value === item.value}
            onPick={readOnly ? () => {} : onPick}
          >
            {item.label}
          </ScoreButton>
        ))}
        <ScoreButton value={null} selected={value === null} onPick={readOnly ? () => {} : onPick}>
          N/A
        </ScoreButton>

        {suggestion !== null && !readOnly ? (
          <button
            type="button"
            onClick={() => onPick(suggestion as QcDraftValue)}
            className="text-[0.74rem]"
            style={{
              padding: "3px 9px",
              borderRadius: 999,
              border: "1px dashed var(--violet)",
              color: "var(--violet)",
              background: "transparent",
            }}
          >
            AI suggests {suggestion}
          </button>
        ) : null}

        {readOnly ? null : (
          <button type="button" className="ilink ml-1 text-[0.76rem]" onClick={onToggleNotes}>
            {open ? "Hide notes" : note?.found || note?.next ? "Edit notes" : "Add notes"}
          </button>
        )}
      </div>

      {evidence ? (
        <div
          className="mt-2 text-[0.76rem]"
          style={{ fontFamily: "var(--font-mono, ui-monospace), monospace", color: "var(--slate-400)" }}
        >
          {evidence}
        </div>
      ) : null}

      {open || (readOnly && (note?.found || note?.next)) ? (
        <div className="mt-2 grid gap-2">
          <div>
            <div className="muted text-[0.72rem]">What we found (timestamp + quote)</div>
            <textarea
              className="input mt-1 w-full"
              rows={2}
              disabled={readOnly}
              value={note?.found || ""}
              onChange={(event) => onNote({ ...(note || {}), found: event.target.value })}
            />
          </div>
          <div>
            <div className="muted text-[0.72rem]">Next time</div>
            <textarea
              className="input mt-1 w-full"
              rows={2}
              disabled={readOnly}
              value={note?.next || ""}
              onChange={(event) => onNote({ ...(note || {}), next: event.target.value })}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CoachingPlan({
  items,
  readOnly,
  onChange,
}: {
  items: CoachingItem[];
  readOnly: boolean;
  onChange: (items: CoachingItem[]) => void;
}) {
  const update = (index: number, patch: Partial<CoachingItem>) => {
    onChange(items.map((item, at) => (at === index ? { ...item, ...patch } : item)));
  };

  return (
    <div className="card">
      <div className="eyebrow muted">Coaching plan</div>
      <p className="muted mt-1 text-[0.8rem] leading-6">
        Proposals, not orders — the AM decides. Drafted from the lowest scores.
      </p>
      <div className="mt-3 grid gap-3">
        {items.map((item, index) => (
          <div
            key={index}
            style={{
              padding: 12,
              borderRadius: 10,
              border: "1px solid var(--hair)",
              background: "var(--surface-2)",
            }}
          >
            <div className="grid gap-2">
              <Field label="Idea" value={item.idea} readOnly={readOnly} onChange={(idea) => update(index, { idea })} />
              <Field
                label="When to skip it"
                value={item.skip}
                readOnly={readOnly}
                onChange={(skip) => update(index, { skip })}
              />
              <Field
                label="Why (call, timestamp, what it cost)"
                value={item.why}
                readOnly={readOnly}
                onChange={(why) => update(index, { why })}
              />
              <Field
                label="How it could sound"
                value={item.how}
                readOnly={readOnly}
                onChange={(how) => update(index, { how })}
              />
            </div>
            {readOnly ? null : (
              <button
                type="button"
                className="ilink mt-2 text-[0.76rem]"
                onClick={() => onChange(items.filter((_, at) => at !== index))}
              >
                <Trash2 className="mr-1 inline" style={{ width: 13, height: 13 }} />
                Remove
              </button>
            )}
          </div>
        ))}
        {items.length ? null : (
          <p className="muted text-[0.8rem]">No coaching items yet.</p>
        )}
      </div>
      {readOnly ? null : (
        <button
          type="button"
          className="btn mt-3 text-[0.8rem]"
          onClick={() => onChange([...items, { idea: "", why: "", how: "", skip: "" }])}
        >
          Add item
        </button>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  readOnly,
  onChange,
}: {
  label: string;
  value: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <div className="muted text-[0.72rem]">{label}</div>
      <textarea
        className="input mt-1 w-full"
        rows={2}
        disabled={readOnly}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
