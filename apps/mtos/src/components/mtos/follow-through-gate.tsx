"use client";

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, Check, Clock, PenLine, RotateCcw, Sparkles, X } from "lucide-react";

import { readJsonResponse } from "@/src/lib/api/read-json-response";
import {
  RED_FLAGS,
  aboveCapWarning,
  fallbackJustification,
  recommendedCap,
  scoreBand,
  scoreGateBlockers,
  scoreObligations,
  type RedFlagFinding,
  type RedFlagId,
  type ScoreGateState,
} from "@/src/lib/contracts/follow-through-score";

/**
 * The first screen of the follow-through: the red-flag check, and the score.
 *
 * Three behaviours here are the whole point of the screen, and each one exists because of how the
 * score actually gets picked in practice:
 *
 *  - **The cap is shown, not enforced.** An AM who was on the call knows things the transcript
 *    does not. Scoring above the cap warns and asks for a sentence; it never refuses.
 *  - **The justification follows the score until the AM takes it over.** Moving the picker
 *    rewrites the box from the line written for that score -- but the moment the AM types, their
 *    wording is theirs and no later score change overwrites it. "Rewrite for {n}/10" hands it back.
 *  - **A ticked flag needs a sentence.** The evidence box is what stops the check becoming six
 *    boxes someone ticked quickly, and it is the text a manager reads later.
 */

const SCORES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

interface GateAnalysis {
  findings: RedFlagFinding[];
  suggested?: number;
  justifications: Record<string, string>;
  note?: string;
}

function FlagRow({
  id,
  finding,
  onChange,
}: {
  id: RedFlagId;
  finding: RedFlagFinding;
  onChange: (next: RedFlagFinding) => void;
}) {
  const rule = RED_FLAGS.find((flag) => flag.id === id);
  if (!rule) return null;
  const found = finding.found;

  return (
    <li className="card" style={{ padding: "14px 16px" }}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[0.9rem] font-semibold" style={{ color: "var(--text)" }}>
              {rule.label}
            </span>
            <span className="chip muted">max {found && finding.severe && rule.severe ? rule.severe.cap : rule.cap}</span>
          </div>
          <p className="muted mt-1 text-[0.8rem] leading-6">{rule.hint}</p>
        </div>
        <div className="seg" role="group" aria-label={`${rule.label} found on this call`}>
          <button
            type="button"
            className={`seg-btn ${found ? "on" : ""}`}
            onClick={() => onChange({ ...finding, found: true })}
          >
            <Check />
            Found
          </button>
          <button
            type="button"
            className={`seg-btn ${found ? "" : "on"}`}
            onClick={() => onChange({ id, found: false })}
          >
            <X />
            Not found
          </button>
        </div>
      </div>

      {found ? (
        <div className="mt-3 grid gap-3">
          <div className="field">
            <label className="field-label" htmlFor={`evidence-${id}`}>
              What was said
            </label>
            <textarea
              id={`evidence-${id}`}
              className="textarea"
              rows={2}
              value={finding.evidence || ""}
              placeholder="One or two sentences. What the client actually said, not how it felt."
              onChange={(event) => onChange({ ...finding, evidence: event.target.value })}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor={`stamps-${id}`}>
              Where in the call <span className="muted">(optional)</span>
            </label>
            <input
              id={`stamps-${id}`}
              className="input"
              value={(finding.timestamps || []).join(", ")}
              placeholder="12:04, 31:50"
              onChange={(event) =>
                onChange({
                  ...finding,
                  timestamps: event.target.value
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                })
              }
            />
            {finding.timestamps?.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {finding.timestamps.map((stamp) => (
                  <span key={stamp} className="chip muted">
                    <Clock />
                    {stamp}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {rule.severe ? (
            <label className="flex items-start gap-2 text-[0.84rem]" style={{ color: "var(--text-2)" }}>
              <input
                type="checkbox"
                checked={Boolean(finding.severe)}
                onChange={(event) => onChange({ ...finding, severe: event.target.checked })}
              />
              <span>
                {rule.severe.label} — <span className="muted">drops the ceiling to {rule.severe.cap}</span>
              </span>
            </label>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function FollowThroughGate({
  touchId,
  clientName,
  gate,
  analysis,
}: {
  touchId: string;
  clientName: string;
  gate?: ScoreGateState;
  analysis?: GateAnalysis;
}) {
  const [state, setState] = useState<ScoreGateState>(
    gate?.findings?.length
      ? gate
      : { ...gate, findings: analysis?.findings || [], ...(analysis?.suggested ? { suggested: analysis.suggested } : {}) },
  );
  const [justifications, setJustifications] = useState<Record<string, string>>(
    analysis?.justifications || {},
  );
  const [note, setNote] = useState(analysis?.note || "");
  const [read, setRead] = useState(Boolean(analysis));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [blockers, setBlockers] = useState<string[]>([]);

  const findings = useMemo(
    () => RED_FLAGS.map((rule) => state.findings?.find((f) => f.id === rule.id) || { id: rule.id, found: false }),
    [state.findings],
  );
  const cap = useMemo(() => recommendedCap(findings), [findings]);
  const band = scoreBand(state.score ?? null);
  const warning = aboveCapWarning(state.score ?? null, cap);
  const obligations = scoreObligations(state.score ?? null);
  const confirmed = Boolean(state.confirmedAt);

  const generatedFor = useCallback(
    (score: number | null) => {
      if (score !== null && justifications[String(score)]?.trim()) {
        return justifications[String(score)].trim();
      }
      return fallbackJustification(score, findings, clientName);
    },
    [justifications, findings, clientName],
  );

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await fetch(`/api/monthly-touches/${touchId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await readJsonResponse<{
        data?: { gate?: ScoreGateState } & Partial<GateAnalysis>;
        error?: string;
        blockers?: string[];
      }>(response);
      if (!response.ok) {
        setBlockers(result?.blockers || []);
        throw new Error(result?.error || "That did not work.");
      }
      setBlockers([]);
      return result?.data;
    },
    [touchId],
  );

  /**
   * Read the call. A button rather than something the page does on load: it is a model pass over
   * the whole transcript, and an AM who opened this screen to re-read their own notes should not
   * pay for one -- nor wait for it.
   */
  async function analyzeCall() {
    setBusy("analyze");
    setError("");
    try {
      const data = await post({ action: "analyze_score_gate" });
      if (!data) return;
      setJustifications(data.justifications || {});
      setNote(data.note || "");
      setRead(true);
      setState((previous) => ({
        ...previous,
        findings: data.findings || previous.findings,
        ...(data.suggested ? { suggested: data.suggested } : {}),
        // The suggestion is only a starting point for a score the AM has not picked yet. One
        // already picked is theirs, and a re-read must not quietly move it.
        ...(previous.score === undefined && data.suggested !== undefined
          ? {
              score: data.suggested,
              ...(previous.justificationEdited
                ? {}
                : {
                    justification:
                      data.justifications?.[String(data.suggested)]?.trim() ||
                      fallbackJustification(data.suggested, data.findings || [], clientName),
                  }),
            }
          : {}),
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The call could not be read.");
    } finally {
      setBusy("");
    }
  }

  function setFinding(next: RedFlagFinding) {
    setState((previous) => ({
      ...previous,
      findings: RED_FLAGS.map((rule) =>
        rule.id === next.id ? next : previous.findings?.find((f) => f.id === rule.id) || { id: rule.id, found: false },
      ),
    }));
  }

  function pickScore(score: number | null) {
    setState((previous) => ({
      ...previous,
      score,
      // The AM's own wording survives every later score change. Only an untouched box follows
      // the picker, because that box is MTOS's draft and not yet anybody's sentence.
      justification: previous.justificationEdited ? previous.justification : generatedFor(score),
    }));
  }

  async function run(action: string, label: string) {
    setBusy(label);
    setError("");
    try {
      const data = await post({
        action,
        ...(action === "reopen_score_gate" ? {} : { gate: cleanGate({ ...state, findings }) }),
      });
      if (data?.gate) setState(data.gate);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work.");
    } finally {
      setBusy("");
    }
  }

  const localBlockers = scoreGateBlockers({ ...state, findings });
  const shown = blockers.length ? blockers : localBlockers;

  return (
    <div className="grid gap-4">
      {note ? (
        <div className="callout">
          <span className="callout-ic">
            <AlertTriangle />
          </span>
          <div>
            <div className="callout-title">Read this before you score</div>
            <div className="callout-body">{note}</div>
          </div>
        </div>
      ) : null}

      <div className="card">
        <div className="flex flex-wrap items-center gap-3">
          {state.suggested ? (
            <span className="chip info">
              <Sparkles />
              MTOS suggests {state.suggested}/10
            </span>
          ) : (
            <span className="chip muted">MTOS has no suggestion for this call</span>
          )}
          <span className={`chip ${cap.cap === null ? "muted" : cap.cap <= 4 ? "risk" : "watch"}`}>{cap.sentence}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm ml-auto"
            disabled={Boolean(busy) || confirmed}
            onClick={() => void analyzeCall()}
          >
            <Sparkles />
            {busy === "analyze" ? "Reading the call…" : read ? "Read the call again" : "Read the call for red flags"}
          </button>
        </div>
      </div>

      <div>
        <div className="eyebrow muted">The six red flags</div>
        <ul className="mt-2 grid gap-3">
          {findings.map((finding) => (
            <FlagRow key={finding.id} id={finding.id} finding={finding} onChange={setFinding} />
          ))}
        </ul>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Account health score</div>
        </div>
        <div className="seg mt-1 flex-wrap" role="group" aria-label="Account health score">
          {SCORES.map((score) => (
            <button
              key={score}
              type="button"
              className={`seg-btn ${state.score === score ? "on" : ""}`}
              onClick={() => pickScore(score)}
            >
              {score}
            </button>
          ))}
          <button
            type="button"
            className={`seg-btn ${state.score === null ? "on" : ""}`}
            onClick={() => pickScore(null)}
          >
            No score
          </button>
        </div>

        {band ? (
          <p className="mt-3 text-[0.86rem] leading-7" style={{ color: "var(--text-2)" }}>
            <strong>{band.label}.</strong> {band.detail}
          </p>
        ) : null}

        {warning ? (
          <div className="callout mt-3">
            <span className="callout-ic">
              <AlertTriangle />
            </span>
            <div>
              <div className="callout-title">Above the recommended maximum</div>
              <div className="callout-body">{warning}</div>
            </div>
          </div>
        ) : null}

        {obligations.length ? (
          <div className="mt-3">
            <div className="eyebrow muted">This score adds</div>
            <ul className="mt-1 grid gap-1">
              {obligations.map((line) => (
                <li key={line} className="text-[0.84rem]" style={{ color: "var(--text-2)" }}>
                  · {line}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="field mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="field-label" htmlFor="justification">
              Why this score
            </label>
            {state.justificationEdited && state.score !== undefined ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  setState((previous) => ({
                    ...previous,
                    justification: generatedFor(previous.score ?? null),
                    justificationEdited: false,
                  }))
                }
              >
                <RotateCcw />
                Rewrite for {state.score === null ? "no score" : `${state.score}/10`}
              </button>
            ) : null}
          </div>
          <textarea
            id="justification"
            className="textarea"
            rows={3}
            value={state.justification || ""}
            placeholder="One or two sentences in your own voice. This is the line a manager reads first."
            onChange={(event) =>
              setState((previous) => ({
                ...previous,
                justification: event.target.value,
                justificationEdited: true,
              }))
            }
          />
          <span className="field-hint">
            {state.justificationEdited
              ? "Your wording — changing the score will not overwrite it."
              : "MTOS wrote this for the score above. Edit it and it becomes yours."}
          </span>
        </div>
      </div>

      {shown.length && !confirmed ? (
        <div className="card">
          <div className="eyebrow muted">Before you can confirm</div>
          <ul className="mt-2 grid gap-2">
            {shown.map((line) => (
              <li key={line} className="flex items-start gap-2 text-[0.84rem]" style={{ color: "var(--text-2)" }}>
                <PenLine style={{ flexShrink: 0, marginTop: 3 }} />
                {line}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {confirmed ? (
          <>
            <span className="chip good">
              <Check />
              Score confirmed
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={Boolean(busy)}
              onClick={() => void run("reopen_score_gate", "reopen")}
            >
              <RotateCcw />
              {busy === "reopen" ? "Re-opening…" : "Change the score"}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-primary"
              disabled={Boolean(busy) || localBlockers.length > 0}
              onClick={() => void run("confirm_score_gate", "confirm")}
            >
              <Sparkles />
              {busy === "confirm" ? "Confirming…" : "Confirm score and draft the notes"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={Boolean(busy)}
              onClick={() => void run("save_score_gate", "save")}
            >
              {busy === "save" ? "Saving…" : "Save and come back to it"}
            </button>
          </>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-[0.82rem]" style={{ color: "var(--risk)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Drop the empty strings the textareas leave behind, so Firestore stores a finding or nothing. */
function cleanGate(state: ScoreGateState): ScoreGateState {
  return {
    ...(state.score !== undefined ? { score: state.score } : {}),
    ...(state.justification?.trim() ? { justification: state.justification.trim() } : {}),
    ...(state.justificationEdited ? { justificationEdited: true } : {}),
    ...(state.suggested ? { suggested: state.suggested } : {}),
    findings: (state.findings || []).map((finding) =>
      finding.found
        ? {
            id: finding.id,
            found: true,
            ...(finding.evidence?.trim() ? { evidence: finding.evidence.trim() } : {}),
            ...(finding.timestamps?.length ? { timestamps: finding.timestamps } : {}),
            ...(finding.severe ? { severe: true } : {}),
          }
        : { id: finding.id, found: false },
    ),
  };
}
