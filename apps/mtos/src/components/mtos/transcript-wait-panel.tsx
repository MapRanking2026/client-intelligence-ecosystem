"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Minus, Paperclip, Sparkles, X } from "lucide-react";

import { readJsonResponse } from "@/src/lib/api/read-json-response";
import {
  TX_POLL_MS,
  transcriptWaitPanel,
  type TranscriptFile,
} from "@/src/lib/contracts/transcript-watch";
import type { TouchTranscriptState } from "@/src/lib/mtos-data";

/**
 * The wait between hanging up and writing the follow-through.
 *
 * It looks like a status strip and is really the step that decides what the follow-through is
 * written from, so three things about it are deliberate:
 *
 *  - **It polls the calendar event, never Drive.** The request behind it reads the event this
 *    touch was booked on and the Docs attached to it. Searching Drive by client name and date can
 *    return another meeting's notes, and nothing downstream would catch it.
 *  - **It shows every Doc and what was done with it.** A call that was stopped and restarted
 *    leaves three or four Docs, of which one or two are the call. Without the list the notes read
 *    as though half the meeting never happened.
 *  - **It never traps the AM.** The follow-through opens as soon as the transcript arrives, and
 *    after fifteen minutes either way — and the poll carries on afterwards, so a transcript that
 *    turns up at minute twenty is still picked up.
 */

const DECISION_ICON: Record<TranscriptFile["decision"], { icon: typeof Check; chip: string; label: string }> = {
  used: { icon: Check, chip: "good", label: "Used" },
  ignored: { icon: X, chip: "risk", label: "Ignored" },
  kept: { icon: Minus, chip: "muted", label: "Kept for reference" },
};

function FileRow({ file }: { file: TranscriptFile }) {
  const { icon: Icon, chip, label } = DECISION_ICON[file.decision];
  return (
    <li className="list-row items-start">
      <span className={`chip ${chip}`} style={{ flexShrink: 0 }}>
        <Icon />
        {label}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-[0.84rem] font-semibold" style={{ color: "var(--text)" }}>
          {file.url ? (
            <a href={file.url} target="_blank" rel="noopener noreferrer">
              {file.name}
            </a>
          ) : (
            file.name
          )}
        </span>
        {file.chars ? <span className="muted text-[0.78rem]"> · {file.chars.toLocaleString()} characters</span> : null}
        <br />
        <span className="muted text-[0.8rem]">{file.reason}</span>
      </span>
    </li>
  );
}

export function TranscriptWaitPanel({
  touchId,
  callEndedAt,
  transcript,
  followThroughHref,
}: {
  touchId: string;
  callEndedAt?: string;
  transcript?: TouchTranscriptState;
  followThroughHref: string;
}) {
  const [state, setState] = useState<TouchTranscriptState | undefined>(transcript);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [showAttach, setShowAttach] = useState(false);
  const [pasted, setPasted] = useState("");
  const [attaching, setAttaching] = useState(false);

  // Re-renders the "waiting — N min" line. The elapsed time is derived from `callEndedAt` on every
  // render rather than counted here, so a reload or a second machine shows the same number.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  const view = transcriptWaitPanel({
    ...(callEndedAt ? { callEndedAt } : {}),
    ...(state?.status ? { status: state.status } : {}),
    ...(state?.note ? { note: state.note } : {}),
    usedCount: state?.docIds?.length || 0,
  });

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await fetch(`/api/monthly-touches/${touchId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await readJsonResponse<{ data?: { transcript?: TouchTranscriptState }; error?: string }>(
        response,
      );
      if (!response.ok) throw new Error(result?.error || "That did not work.");
      return result?.data?.transcript;
    },
    [touchId],
  );

  const inFlight = useRef(false);
  const check = useCallback(async () => {
    // One look at a time. A slow Docs read must not stack up behind the minute timer and turn a
    // fifteen-minute wait into fifteen overlapping requests.
    if (inFlight.current) return;
    inFlight.current = true;
    setChecking(true);
    try {
      const next = await post({ action: "watch_transcript" });
      if (next) setState(next);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not check for the transcript.");
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }, [post]);

  const keepPolling = view.keepPolling;
  useEffect(() => {
    if (!keepPolling) return;
    // Looks once on mount as well as on the minute: the AM arrives here straight off End call,
    // and waiting a full minute to make the first attempt reads as a panel that is not working.
    // Scheduled rather than called straight out of the effect body, so the first look reports its
    // progress from a timer callback like every later one instead of re-rendering mid-effect.
    const first = setTimeout(() => void check(), 0);
    const id = setInterval(() => void check(), TX_POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [keepPolling, check]);

  async function attach() {
    setAttaching(true);
    try {
      const next = await post({ action: "attach_transcript", transcript: pasted });
      if (next) setState(next);
      setError("");
      setShowAttach(false);
      setPasted("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That transcript was not attached.");
    } finally {
      setAttaching(false);
    }
  }

  if (view.phase === "not_ended") return null;

  const tone = view.phase === "found" || view.phase === "attached" ? "good" : view.phase === "none" ? "watch" : "info";

  return (
    <div className="card mt-4" style={{ position: "sticky", bottom: 12, zIndex: 20 }}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`chip ${tone}`}>
          <span className={`sig-dot ${tone === "info" ? "muted" : tone}`} />
          {view.label}
        </span>
        {checking ? <span className="muted text-[0.78rem]">checking…</span> : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAttach((open) => !open)}>
            <Paperclip />
            {showAttach ? "Cancel" : "Attach transcript"}
          </button>
          {view.canBeginFollowThrough ? (
            <Link href={followThroughHref} className="btn btn-primary btn-sm">
              <Sparkles />
              Begin follow-through
            </Link>
          ) : null}
        </div>
      </div>

      <p className="mt-3 text-[0.86rem] leading-7" style={{ color: "var(--text-2)" }}>
        {view.detail}
      </p>

      {state?.files?.length ? (
        <>
          <div className="eyebrow muted mt-4">What Google had attached to the event</div>
          <ul className="mt-2 grid gap-2">
            {state.files.map((file) => (
              <FileRow key={file.docId} file={file} />
            ))}
          </ul>
        </>
      ) : null}

      {showAttach ? (
        <div className="field mt-4">
          <label className="field-label" htmlFor="attach-transcript">
            Paste the transcript
          </label>
          <textarea
            id="attach-transcript"
            className="textarea"
            rows={8}
            value={pasted}
            placeholder="Paste the dialogue — from Zoom, from a Doc the client shared, or typed from your own notes."
            onChange={(event) => setPasted(event.target.value)}
          />
          <span className="field-hint">
            Attaching stops MTOS looking: what you paste is what the follow-through is written from.
          </span>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={attaching || !pasted.trim()}
              onClick={() => void attach()}
            >
              {attaching ? "Attaching…" : "Attach this transcript"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-[0.82rem]" style={{ color: "var(--risk)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
