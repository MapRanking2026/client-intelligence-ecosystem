"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Monitor,
  Pause,
  Play,
  PlayCircle,
  Save,
  X,
} from "lucide-react";

import { EndGoogleMeetingButton, meetingRequest } from "@/src/components/mtos/google-meeting-panel";
import type { GoogleMeetingOverview, GoogleMeetingState } from "@/src/lib/contracts/google-meet";

import { Linkified } from "@/src/components/mtos/annotate";
import { PresentationViewer } from "@/src/components/mtos/presentation-viewer";
import type { LiveSession, MonthlyTouchRecord } from "@/src/lib/mtos-data";
import { readJsonResponse } from "@/src/lib/api/read-json-response";

/**
 * One full-screen view for running the meeting.
 *
 * Before this, the five opening questions, the Live Call Guide and the Client Presentation were
 * three separate things covering overlapping ground, and an AM mid-call had to scroll between them
 * and lost anything typed when they moved. The five questions are now the agenda's spine; each
 * question carries the call guide's talking points and the questions to ask for that part of the
 * call, its own timer, and its own notes field.
 *
 * The split that matters is kept strictly: the left rail and the notes are the AM's and are never
 * shown to the client, and the client-facing slides open in their own presentation view. Nothing
 * internal -- coaching, recommendations, risk wording -- is in the slides.
 */

interface LiveSegment {
  key: string;
  title: string;
  /** What this part of the call is for, in one line. */
  purpose: string;
  /** Minutes the guide allows for it, when the guide says. */
  minutes?: number;
  /** What the AM says, from the call guide and the preparation. */
  talkingPoints: string[];
  /** What the AM asks, from the guide's client prompts and the preparation's questions. */
  questions: string[];
}

/** The six steps of the Live Recap & Close, which the meeting is not finished without. */
const CLOSE_STEPS: { n: number; title: string; detail: string }[] = [
  {
    n: 1,
    title: "Recap the meeting live",
    detail: "Walk back through the wins, the open issues and their status, and the decisions made today.",
  },
  { n: 2, title: "Our actions", detail: "Each thing Map Ranking will do, with an owner and a date." },
  {
    n: 3,
    title: "A deadline for every client item",
    detail: "Read each pending item out loud and ask when they can have it to us. Write the date down.",
  },
  { n: 4, title: "Follow-up preference", detail: "Which channel, and which contact, if something is still open." },
  {
    n: 5,
    title: "Promise the recap email",
    detail: "Today, within 24 business hours: our actions, their items with dates, the goal agreed, the next meeting.",
  },
  {
    n: 6,
    title: "Book the next Monthly Touch live",
    detail: "Date and time in the client's zone, invite sent on the call, attendees confirmed.",
  },
];

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Build the agenda from the five questions, and hang the guide's content off it.
 *
 * The call guide's sections are matched to the question they belong to by position where the counts
 * line up, and any extra guide section becomes its own segment rather than being dropped -- losing
 * a section of the guide the AM was going to present would be worse than an uneven agenda.
 */
function buildSegments(touch: MonthlyTouchRecord): LiveSegment[] {
  const guideSections = touch.callGuide?.sections ?? [];
  const prepPack = touch.prepPack;

  const base: LiveSegment[] = [
    {
      key: "q1",
      title: "1. What happened?",
      purpose: "Open with their month in their words, then show the results.",
      talkingPoints: touch.wins,
      questions: [
        "How was your month overall?",
        "How many new leads or inquiries came in?",
        "How much of that turned into actual jobs?",
      ],
    },
    {
      key: "q2",
      title: "2. What caused it?",
      purpose: "Connect the numbers to the reasons, and name the issues before the client does.",
      talkingPoints: touch.risks,
      questions: [
        "Anything that felt off this month — calls that did not convert, jobs you felt you should have closed?",
        "What is sitting in your pipeline right now?",
      ],
    },
    {
      key: "q3",
      title: "3. What are we doing about it?",
      purpose: "Every issue already has a plan, an owner and a date.",
      talkingPoints: (prepPack?.issuesAndSolutions ?? []).map(
        (item) => `${item.issue} → ${item.solution} (${item.owner}, ${item.dueDate})`,
      ),
      questions: prepPack?.leadQualityQuestions ?? [],
    },
    {
      key: "q4",
      title: "4. What is next?",
      purpose: "The goal number, the next 30 days, and the growth move worth making.",
      talkingPoints: [...touch.opportunities, ...touch.commitments],
      questions: [
        "What is the number you want to hit by the end of the quarter — jobs, revenue or calls?",
        ...(prepPack?.decisionsTogether ?? []).map((decision) => decision.question),
      ],
    },
    {
      key: "q5",
      title: "5. What do you need from us?",
      purpose: "Their turn. Ask, then stop talking.",
      talkingPoints: touch.talkingPoints,
      questions: (prepPack?.recapQuestions ?? []).map((entry) => entry.question),
    },
  ];

  guideSections.forEach((section, index) => {
    const target = base[index];
    if (target) {
      target.minutes = section.minutes;
      target.talkingPoints = [...section.talkingPoints, ...target.talkingPoints];
      target.questions = [...section.clientPrompts, ...target.questions];
      return;
    }
    base.push({
      key: `guide-${index}`,
      title: section.title,
      purpose: "From the live call guide.",
      minutes: section.minutes,
      talkingPoints: section.talkingPoints,
      questions: section.clientPrompts,
    });
  });

  base.push({
    key: "close",
    title: "Live Recap & Close",
    purpose: "The last 5-7 minutes. The meeting is not finished until all six steps are done live.",
    minutes: 7,
    talkingPoints: [],
    questions: [],
  });

  // Strip empties so a segment never shows a bullet with nothing in it.
  return base.map((segment) => ({
    ...segment,
    talkingPoints: segment.talkingPoints.filter((point) => point && point.trim()),
    questions: segment.questions.filter((question) => question && question.trim()),
  }));
}

export function LiveMode({
  touch,
  clientId,
  clientName,
  onClose,
}: {
  touch: MonthlyTouchRecord;
  clientId: string;
  clientName: string;
  onClose: () => void;
}) {
  const segments = useMemo(() => buildSegments(touch), [touch]);
  const [index, setIndex] = useState(0);
  const [running, setRunning] = useState(true);
  const [showSlides, setShowSlides] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const startedAt = useRef(touch.liveSession?.startedAt || new Date().toISOString());

  const [notes, setNotes] = useState<Record<string, string>>(() => {
    const seeded: Record<string, string> = {};
    for (const segment of touch.liveSession?.segments ?? []) seeded[segment.key] = segment.notes;
    return seeded;
  });
  const [elapsed, setElapsed] = useState<Record<string, number>>(() => {
    const seeded: Record<string, number> = {};
    for (const segment of touch.liveSession?.segments ?? []) seeded[segment.key] = segment.elapsedSeconds;
    return seeded;
  });
  const [closeSteps, setCloseSteps] = useState<number[]>(touch.liveSession?.recapStepsDone ?? []);
  const [closeNotes, setCloseNotes] = useState(touch.liveSession?.closeNotes ?? "");

  const current = segments[index];
  const currentKey = current?.key ?? "";

  // One timer for the segment on screen. It counts the segment the AM is actually in, which is the
  // number they need ("am I running long on wins?"), not the meeting total.
  useEffect(() => {
    if (!running || !currentKey) return;
    const id = setInterval(() => {
      setElapsed((previous) => ({ ...previous, [currentKey]: (previous[currentKey] ?? 0) + 1 }));
    }, 1000);
    return () => clearInterval(id);
  }, [running, currentKey]);

  const save = useCallback(async () => {
    setSaveState("saving");
    setSaveError(null);
    try {
      const response = await fetch(`/api/monthly-touches/${touch.id}/live-session`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          startedAt: startedAt.current,
          segments: segments.map((segment) => ({
            key: segment.key,
            title: segment.title,
            notes: notes[segment.key] ?? "",
            elapsedSeconds: elapsed[segment.key] ?? 0,
          })),
          recapStepsDone: closeSteps,
          closeNotes,
        }),
      });
      const result = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(result?.error || "Those notes were not saved.");
      setSaveState("saved");
    } catch (caught) {
      setSaveState("error");
      setSaveError(caught instanceof Error ? caught.message : "Those notes were not saved.");
    }
  }, [touch.id, segments, notes, elapsed, closeSteps, closeNotes]);

  // Autosave a couple of seconds after the AM stops typing, and whenever they change segment, so a
  // reload mid-call costs at most the last sentence.
  useEffect(() => {
    const id = setTimeout(() => {
      void save();
    }, 2500);
    return () => clearTimeout(id);
  }, [notes, closeNotes, closeSteps, index, save]);

  const go = useCallback(
    (delta: number) => {
      setIndex((previous) => Math.min(Math.max(previous + delta, 0), segments.length - 1));
    },
    [segments.length],
  );

  // Arrow keys move between segments, so the AM is not hunting for a button while the client talks.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "Escape" && !showSlides) onClose();
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [go, onClose, showSlides]);

  if (!current) return null;

  const segmentSeconds = elapsed[currentKey] ?? 0;
  const overBudget = current.minutes ? segmentSeconds > current.minutes * 60 : false;
  const totalSeconds = Object.values(elapsed).reduce((sum, value) => sum + value, 0);

  return (
    <div className="live-shell" role="dialog" aria-modal="true" aria-label={`Live meeting with ${clientName}`}>
      <div className="live-bar">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <span className="chip good">
            <span className="sig-dot good" />
            Live
          </span>
          <span className="h4" style={{ minWidth: 0 }}>
            {clientName}
          </span>
          <span className="muted text-[0.78rem]">
            Segment {index + 1} of {segments.length} · meeting {formatClock(totalSeconds)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className={`live-timer ${overBudget ? "is-over" : ""}`} aria-live="off">
            {formatClock(segmentSeconds)}
            {current.minutes ? <span className="muted text-[0.74rem]"> / {current.minutes}m</span> : null}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRunning((on) => !on)}>
            {running ? <Pause /> : <Play />}
            {running ? "Pause" : "Resume"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowSlides(true)}>
            <Monitor />
            Client slides
          </button>
          <EndGoogleMeetingButton touchId={touch.id} onEnded={() => { setRunning(false); void save(); }} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void save()}>
            <Save />
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save notes"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              void save();
              onClose();
            }}
          >
            <X />
            Leave Live mode
          </button>
        </div>
      </div>

      <div className="live-body">
        <aside className="live-rail" aria-label="Agenda">
          <p className="card-title mb-2.5">Agenda</p>
          {segments.map((segment, segmentIndex) => (
            <button
              key={segment.key}
              type="button"
              className={`live-seg-btn ${segmentIndex === index ? "on" : ""}`}
              onClick={() => setIndex(segmentIndex)}
            >
              <span className="live-seg-name">{segment.title}</span>
              <span className="live-seg-meta">
                {formatClock(elapsed[segment.key] ?? 0)}
                {segment.minutes ? ` of ${segment.minutes}m` : ""}
                {notes[segment.key]?.trim() ? " · notes" : ""}
              </span>
            </button>
          ))}
          <p className="field-hint mt-3">
            Your notes and timings stay with each segment — moving around does not lose them. The client never sees
            this side.
          </p>
        </aside>

        <main className="live-main">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="h3">{current.title}</h2>
              <p className="muted mt-1.5 text-[0.86rem]">{current.purpose}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn btn-ghost btn-sm" disabled={index === 0} onClick={() => go(-1)}>
                <ChevronLeft />
                Back
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={index === segments.length - 1}
                onClick={() => go(1)}
              >
                Next
                <ChevronRight />
              </button>
            </div>
          </div>

          {currentKey === "close" ? (
            <div className="mt-5 grid gap-4">
              <div className="card">
                <div className="card-head">
                  <div className="card-title">The close, step by step</div>
                  <span className={`chip ${closeSteps.length === CLOSE_STEPS.length ? "good" : "watch"}`}>
                    {closeSteps.length} of {CLOSE_STEPS.length} done
                  </span>
                </div>
                <ul className="grid gap-2">
                  {CLOSE_STEPS.map((step) => {
                    const done = closeSteps.includes(step.n);
                    return (
                      <li key={step.n}>
                        <button
                          type="button"
                          className="list-row w-full text-left"
                          onClick={() =>
                            setCloseSteps((previous) =>
                              done ? previous.filter((n) => n !== step.n) : [...previous, step.n],
                            )
                          }
                          aria-pressed={done}
                        >
                          <span style={{ color: done ? "var(--good)" : "var(--slate-400)" }}>
                            {done ? <CheckCircle2 /> : <Circle />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="text-[0.88rem] font-semibold" style={{ color: "var(--text)" }}>
                              {step.n}. {step.title}
                            </span>
                            <br />
                            <span className="muted text-[0.8rem]">{step.detail}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="close-notes">
                  What was agreed on the call
                </label>
                <textarea
                  id="close-notes"
                  className="textarea"
                  rows={10}
                  value={closeNotes}
                  placeholder={
                    "Dates the client gave for each of their items\nThe goal number agreed, and by when\nFollow-up channel and contact\nNext Monthly Touch: date, time, zone — invite sent?"
                  }
                  onChange={(event) => setCloseNotes(event.target.value)}
                />
                <span className="field-hint">
                  This goes to the follow-through with the recording, so the recap email and the tickets are built from
                  what you actually agreed.
                </span>
              </div>
            </div>
          ) : (
            <div className="mt-5 grid items-start gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
              <div className="grid gap-4">
                {current.talkingPoints.length ? (
                  <div className="card">
                    <div className="card-head">
                      <div className="card-title">What you say</div>
                    </div>
                    <ul className="grid gap-2.5">
                      {current.talkingPoints.map((point) => (
                        <li key={point} className="flex items-start gap-2.5 text-[0.88rem]">
                          <span className="sig-dot good" style={{ marginTop: 7 }} aria-hidden />
                          <span>
                            <Linkified text={point} clientId={clientId} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {current.questions.length ? (
                  <div className="card">
                    <div className="card-head">
                      <div className="card-title">What you ask — then stop talking</div>
                    </div>
                    <ul className="grid gap-2.5">
                      {current.questions.map((question) => (
                        <li key={question} className="text-[0.88rem]" style={{ color: "var(--text)" }}>
                          <strong>{question}</strong>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {!current.talkingPoints.length && !current.questions.length ? (
                  <p className="muted text-[0.86rem]">
                    Nothing was prepared for this part of the call. Use the client&apos;s own answers, and note what you
                    learn on the right.
                  </p>
                ) : null}
              </div>

              <div className="field">
                <label className="field-label" htmlFor={`notes-${currentKey}`}>
                  Your notes — {current.title}
                </label>
                <textarea
                  id={`notes-${currentKey}`}
                  className="textarea"
                  rows={16}
                  value={notes[currentKey] ?? ""}
                  placeholder="What they said, in their words. Numbers they gave you. Anything you promised."
                  onChange={(event) =>
                    setNotes((previous) => ({ ...previous, [currentKey]: event.target.value }))
                  }
                />
                <span className="field-hint">Internal. Never shown in the client slides.</span>
                {saveState === "error" && saveError ? (
                  <span className="text-[0.8rem]" style={{ color: "var(--risk)" }}>
                    {saveError}
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </main>
      </div>

      {showSlides ? (
        <div
          className="live-shell"
          style={{ zIndex: 90, gridTemplateRows: "auto 1fr", overflow: "auto" }}
          role="dialog"
          aria-modal="true"
          aria-label="Client presentation"
        >
          <div className="live-bar">
            <div className="flex items-center gap-3">
              <span className="chip info">Client-facing</span>
              <span className="h4">Share this view with the client</span>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowSlides(false)}>
              <X />
              Back to your guide
            </button>
          </div>
          <div style={{ padding: 18, overflow: "auto" }}>
            <PresentationViewer touchId={touch.id} presentation={touch.presentation} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The button that opens Live mode, so the run-sheet stays a server component. */
export function LiveModeLauncher({
  touch,
  clientId,
  clientName,
  label = "Start Live Meeting",
}: {
  touch: MonthlyTouchRecord;
  clientId: string;
  clientName: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  async function join() {
    // Open during the click so browser popup protection does not silently block the call.
    const callWindow = window.open("about:blank", "_blank");
    if (!callWindow) { setJoinError("Allow popups for MTOS, then try Join meeting again."); return; }
    callWindow.opener = null;
    setJoining(true); setJoinError("");
    try {
      const overview = await meetingRequest<GoogleMeetingOverview>(touch.id);
      let selection = overview.selection;
      if (!selection && touch.calendarEventId) {
        selection = await meetingRequest<GoogleMeetingState>(touch.id, { action: "select", eventId: touch.calendarEventId });
      }
      if (!selection?.meetingUrl) throw new Error("Choose the call in Google meetings first, then start the call.");
      const url = new URL(selection.meetingUrl);
      if (url.protocol !== "https:" || url.hostname !== "meet.google.com") throw new Error("The selected meeting has an invalid Google Meet link.");
      callWindow.location.href = url.toString();
      setOpen(true);
    } catch (error) {
      callWindow.close();
      setJoinError(error instanceof Error ? error.message : "Could not open Google Meet.");
    } finally { setJoining(false); }
  }
  return (
    <>
      <button type="button" className="btn btn-primary" disabled={joining} onClick={() => void join()}>
        <PlayCircle />
        {joining ? "Opening Google Meet…" : label}
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>Open guide only</button>
      {joinError ? <p role="alert" className="text-sm text-rose-300">{joinError}</p> : null}
      {open ? (
        <LiveMode touch={touch} clientId={clientId} clientName={clientName} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

export type { LiveSession };
