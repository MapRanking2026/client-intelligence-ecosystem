"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Eye, Monitor, PhoneOff, Play, X } from "lucide-react";

import { Linkified } from "@/src/components/mtos/annotate";
import { DECK, PresentationSlideCanvas } from "@/src/components/mtos/presentation-slide";
import { SourceChips } from "@/src/components/mtos/source-chip";
import { useTouchAutosave } from "@/src/components/mtos/use-touch-autosave";
import {
  buildGuideParts,
  callElapsedSeconds,
  clientScreenChannel,
  clientScreenPath,
  formatClock,
  isClientScreenMessage,
  liveHeader,
  visibleSlides,
  type ClientScreenMessage,
  type GuidePart,
} from "@/src/lib/contracts/live-call";
import type {
  CallGuideSection,
  LiveCallFormat,
  Presentation,
  PresentationSlide,
  TouchLiveState,
} from "@/src/lib/mtos-data";

/**
 * The live call, from READY to CALL ENDED.
 *
 * The screen the account manager has open while a client is talking, so three things are treated
 * as more important than anything else on it:
 *
 *  - **Nothing internal can reach the client.** The deck is shown to the client through a separate
 *    window (see `clientScreenPath`) which renders slides and nothing else. The script, the
 *    points, the QC chips and the capture box live only on this screen. That separation is why
 *    the client window is a window rather than a panel that could be shared by accident.
 *  - **Typing is never lost.** Capture notes autosave while the AM types, keyed by the part or the
 *    slide, and the keys are the positions in the generated guide -- so declining a section after
 *    approval reorders the screen without moving anybody's notes under the wrong heading.
 *  - **The clock is the call's, not the screen's.** It is derived from the stored `callStartedAt`
 *    on every tick rather than counted up locally, so reloading mid-call, or opening the touch on
 *    a second machine, shows the same elapsed time instead of restarting at zero.
 */

const FORMAT_LABEL: Record<LiveCallFormat, string> = {
  guide: "Call guide",
  deck: "Client presentation",
};

/**
 * The phase tone in the stylesheet's own vocabulary.
 *
 * There is no `sig-dot.info`, and READY is not a warning, so the dot falls back to `muted` --
 * which is the sheet's "no verdict" dot -- rather than borrowing a colour that would read as a
 * status the call does not have.
 */
const TONE_CLASS: Record<"neutral" | "good" | "watch" | "info", { chip: string; dot: string }> = {
  neutral: { chip: "muted", dot: "muted" },
  good: { chip: "good", dot: "good" },
  watch: { chip: "watch", dot: "watch" },
  info: { chip: "info", dot: "muted" },
};

/** The deck as the client sees it, at whatever size it is being shown at. */
function Slide({
  presentation,
  slides,
  index,
}: {
  presentation?: Presentation;
  slides: PresentationSlide[];
  index: number;
}) {
  const slide = slides[index];
  if (!slide) return null;
  return (
    <PresentationSlideCanvas
      slide={slide}
      deckTitle={presentation?.title}
      clientName={presentation?.clientName}
      periodLabel={presentation?.periodLabel}
      preparedFor={presentation?.preparedFor}
      preparedBy={presentation?.preparedBy}
      // Numbered against the slides actually being shown, so a deck with a declined section in
      // it does not count slides the client never sees.
      slideNumber={index + 1}
      slideCount={slides.length}
    />
  );
}

function Field({
  id,
  label,
  hint,
  value,
  placeholder,
  onChange,
  rows = 8,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  placeholder: string;
  onChange: (next: string) => void;
  rows?: number;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="textarea"
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="field-hint">{hint}</span>
    </div>
  );
}

/** The part of the guide the AM is on: goal, the line to say, the points, the asks, the pushback. */
function GuidePartCard({ part, clientId, total }: { part: GuidePart; clientId: string; total: number }) {
  return (
    <div className="card">
      <div className="card-head">
        <div className="eyebrow muted">
          Part {part.n} of {total} · {part.minutes} min
        </div>
        <span className="chip">{part.window}</span>
      </div>
      <h2 className="h3">{part.title}</h2>
      {part.goal ? (
        <p className="mt-1.5 text-[0.86rem]" style={{ color: "var(--text-2)" }}>
          <strong>Goal:</strong> {part.goal}
        </p>
      ) : null}

      {part.say ? (
        <div className="quick-ref mt-4">
          <div className="quick-ref-label">Say it</div>
          <p className="mt-1.5 text-[0.95rem] leading-7">{part.say}</p>
        </div>
      ) : null}

      {part.points.length ? (
        <>
          <div className="eyebrow muted mt-5">Points to cover</div>
          <ul className="mt-2 grid gap-3">
            {part.points.map((point, index) => (
              <li key={`${part.key}-point-${index}`} className="flex items-start gap-2.5 text-[0.88rem]">
                <span className="sig-dot good" style={{ marginTop: 7 }} aria-hidden />
                <span className="min-w-0">
                  <Linkified text={point.text} clientId={clientId} />
                  <SourceChips chips={point.chips} />
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {part.ask.length ? (
        <>
          <div className="eyebrow muted mt-5">Ask — then stop talking</div>
          <ul className="mt-2 grid gap-2">
            {part.ask.map((question, index) => (
              <li key={`${part.key}-ask-${index}`} className="text-[0.88rem]" style={{ color: "var(--text)" }}>
                <strong>{question}</strong>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {part.ifSays.length ? (
        <>
          <div className="eyebrow muted mt-5">If she says…</div>
          <ul className="mt-2 grid gap-2.5">
            {part.ifSays.map((row, index) => (
              <li key={`${part.key}-if-${index}`} className="list-row items-start">
                <span className="min-w-0 flex-1 text-[0.86rem]">
                  <span className="font-semibold" style={{ color: "var(--text)" }}>
                    {row.says}
                  </span>
                  <br />
                  <span style={{ color: "var(--text-2)" }}>{row.response}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {part.qaChips.length ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {part.qaChips.map((chip) => (
            <span key={`${part.key}-qa-${chip}`} className="chip">
              QA · {chip}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function LiveCallStep({
  touchId,
  clientId,
  clientName,
  live,
  plannedMinutes,
  sections,
  presentation,
  declinedSections,
  showQaChips = true,
}: {
  touchId: string;
  clientId: string;
  clientName: string;
  live?: TouchLiveState;
  plannedMinutes: number;
  sections?: CallGuideSection[];
  presentation?: Presentation;
  declinedSections?: string[];
  showQaChips?: boolean;
}) {
  const router = useRouter();
  const autosave = useTouchAutosave(touchId);

  // The three timestamps are held locally as well as on the server so Start call and End call
  // change the header on the click rather than after the round trip -- an AM pressing Start while
  // the client says hello should not be watching a spinner.
  const [startedAt, setStartedAt] = useState(live?.callStartedAt);
  const [endedAt, setEndedAt] = useState(live?.callEndedAt);
  const [format, setFormat] = useState<LiveCallFormat>(live?.format || "guide");
  const [notes, setNotes] = useState<Record<string, string>>(live?.notes || {});
  const [partIndex, setPartIndex] = useState(0);
  const [slideIndex, setSlideIndex] = useState(0);
  const [preview, setPreview] = useState(false);
  const [clientScreenOpen, setClientScreenOpen] = useState(false);
  const [notice, setNotice] = useState("");

  // Re-renders the clock once a second while the call is running. The value itself is computed
  // from the stored start, so a tick that is late or missed cannot make the clock drift.
  const [, setTick] = useState(0);
  const running = Boolean(startedAt && !endedAt);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const liveState = useMemo(
    () => ({ readyAt: live?.readyAt, callStartedAt: startedAt, callEndedAt: endedAt }),
    [live?.readyAt, startedAt, endedAt],
  );
  const header = liveHeader({ live: liveState, plannedMinutes, formatLabel: FORMAT_LABEL[format] });

  const parts = useMemo(
    () => buildGuideParts({ sections, plannedMinutes, declinedSections }),
    [sections, plannedMinutes, declinedSections],
  );
  const slides = useMemo(() => visibleSlides(presentation?.slides, declinedSections), [
    presentation?.slides,
    declinedSections,
  ]);

  const deckReady = presentation?.status === "generated" && slides.length > 0;
  const isDeck = format === "deck" && deckReady;
  const part = parts[Math.min(partIndex, Math.max(parts.length - 1, 0))];
  const slide = slides[Math.min(slideIndex, Math.max(slides.length - 1, 0))];

  /**
   * The guide part behind the slide on screen, so the presenter panel has the asks and the
   * pushback rather than only the slide's own script.
   *
   * The section id is read out first rather than inside the memo: the compiler infers the whole
   * slide as the dependency otherwise, which recomputes this on every slide object identity
   * change and makes it refuse to optimise the component at all.
   */
  const slideSectionId = slide?.sectionId;
  const slidePart = useMemo(
    () => (slideSectionId ? parts.find((candidate) => candidate.sectionId === slideSectionId) : undefined),
    [slideSectionId, parts],
  );

  const noteKey = isDeck ? `slide-${slideIndex + 1}` : part?.key || "part-1";

  const saveNote = useCallback(
    (key: string, value: string) => {
      setNotes((previous) => {
        const next = { ...previous, [key]: value };
        // The whole map goes with every patch: the server replaces `live.notes` wholesale, so
        // sending only the field that changed would delete every other part's notes.
        autosave.save({ live: { notes: next } });
        return next;
      });
    },
    [autosave],
  );

  // --- the call itself -----------------------------------------------------------------------

  const startCall = useCallback(async () => {
    const at = new Date().toISOString();
    setStartedAt(at);
    autosave.save({ live: { callStartedAt: at, format } });
    await autosave.flush();
    router.refresh();
  }, [autosave, format, router]);

  const endCall = useCallback(async () => {
    const at = new Date().toISOString();
    setEndedAt(at);
    autosave.save({ live: { callEndedAt: at } });
    await autosave.flush();
    // The stored end of the call is what sets the follow-through deadline, so the page is
    // refreshed rather than left showing a screen whose deadline has not arrived yet.
    router.refresh();
  }, [autosave, router]);

  const switchFormat = useCallback(
    (next: LiveCallFormat) => {
      setFormat(next);
      autosave.save({ live: { format: next } });
    },
    [autosave],
  );

  // --- the client window ---------------------------------------------------------------------

  const channel = useRef<BroadcastChannel | null>(null);
  const clientWindow = useRef<Window | null>(null);
  // The channel subscription is set up once and must not be torn down on every slide, so the
  // current slide is read through a ref. Written in an effect rather than during render, which
  // would make what the handshake answers depend on which render happened to run last.
  const slideIndexRef = useRef(slideIndex);
  useEffect(() => {
    slideIndexRef.current = slideIndex;
  }, [slideIndex]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const bus = new BroadcastChannel(clientScreenChannel(touchId));
    channel.current = bus;
    bus.onmessage = (event: MessageEvent) => {
      if (!isClientScreenMessage(event.data)) return;
      const message = event.data as ClientScreenMessage;
      // The client window opens on whatever slide it was built with, which is not necessarily the
      // one the AM is on. It says hello; this answers with the truth.
      if (message.type === "hello") {
        setClientScreenOpen(true);
        bus.postMessage({ type: "slide", index: slideIndexRef.current } satisfies ClientScreenMessage);
      }
      if (message.type === "closed") setClientScreenOpen(false);
    };
    return () => {
      bus.onmessage = null;
      bus.close();
      channel.current = null;
    };
  }, [touchId]);

  // Every move of the AM's is pushed to the client window, so the slide they are talking about is
  // the slide the client is looking at.
  useEffect(() => {
    channel.current?.postMessage({ type: "slide", index: slideIndex } satisfies ClientScreenMessage);
  }, [slideIndex]);

  const openClientScreen = useCallback(() => {
    if (typeof BroadcastChannel === "undefined") {
      setNotice("This browser cannot drive a second window. Use Preview as client and share this tab instead.");
      return;
    }
    // Re-opening focuses the window already up rather than reloading the deck under the client.
    if (clientWindow.current && !clientWindow.current.closed) {
      clientWindow.current.focus();
      return;
    }
    const opened = window.open(
      clientScreenPath(touchId),
      `mtos-client-screen-${touchId}`,
      "width=1280,height=760",
    );
    if (!opened) {
      setNotice("Allow pop-ups for MTOS, then open the client screen again.");
      return;
    }
    clientWindow.current = opened;
    setNotice("");
    setClientScreenOpen(true);
  }, [touchId]);

  // --- keyboard ------------------------------------------------------------------------------

  const move = useCallback(
    (delta: number) => {
      if (isDeck) {
        setSlideIndex((value) => Math.min(Math.max(value + delta, 0), Math.max(slides.length - 1, 0)));
        return;
      }
      setPartIndex((value) => Math.min(Math.max(value + delta, 0), Math.max(parts.length - 1, 0)));
    },
    [isDeck, slides.length, parts.length],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        move(1);
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        move(-1);
      } else if (event.key === "Escape" && preview) {
        setPreview(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, preview]);

  // --- render --------------------------------------------------------------------------------

  const elapsed = callElapsedSeconds(liveState);

  return (
    <div className="grid gap-4">
      <div className="card mt-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`chip ${TONE_CLASS[header.tone].chip}`}>
            <span className={`sig-dot ${TONE_CLASS[header.tone].dot}`} />
            {header.badge}
          </span>
          {header.clock ? (
            <span className={`live-timer ${header.phase === "live" && elapsed > plannedMinutes * 60 ? "is-over" : ""}`}>
              {header.clock}
            </span>
          ) : null}
          <span className="muted min-w-0 text-[0.82rem]">{header.note}</span>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {deckReady ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => switchFormat(isDeck ? "guide" : "deck")}
              >
                {isDeck ? "Use the call guide" : "Use the presentation"}
              </button>
            ) : null}
            {isDeck ? (
              <>
                <button type="button" className="btn btn-primary btn-sm" onClick={openClientScreen}>
                  <Monitor />
                  Open client screen
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreview(true)}>
                  <Eye />
                  Preview as client
                </button>
              </>
            ) : null}
            {header.canStart ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void startCall()}>
                <Play />
                Start call
              </button>
            ) : null}
            {header.canEnd ? (
              <button type="button" className="btn btn-sm btn-risk" onClick={() => void endCall()}>
                <PhoneOff />
                End call
              </button>
            ) : null}
          </div>
        </div>

        {isDeck ? (
          <p className="field-hint mt-3">
            Share the <strong>client screen</strong> window in Google Meet — it shows the slides only and follows your
            clicks here. Your script, the QA points and the next slide stay on this screen.
            {clientScreenOpen ? " The client screen is open and following you." : ""}
          </p>
        ) : null}
        {notice ? (
          <p role="alert" className="mt-3 text-[0.82rem]" style={{ color: "var(--risk)" }}>
            {notice}
          </p>
        ) : null}
        {autosave.state === "error" && autosave.error ? (
          <p role="alert" className="mt-2 text-[0.82rem]" style={{ color: "var(--risk)" }}>
            {autosave.error}
          </p>
        ) : null}
      </div>

      {isDeck ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="card">
            <div className="card-head">
              <div className="card-title">
                Slide {slideIndex + 1} of {slides.length}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={slideIndex === 0}
                  onClick={() => move(-1)}
                >
                  <ChevronLeft />
                  Back
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={slideIndex >= slides.length - 1}
                  onClick={() => move(1)}
                >
                  Next
                  <ChevronRight />
                </button>
              </div>
            </div>
            {/* Half size: this is the AM's own copy of the slide, not the one the client reads. */}
            <div style={{ width: DECK.width * 0.5, height: DECK.height * 0.5, overflow: "hidden" }}>
              <div style={{ transform: "scale(0.5)", transformOrigin: "top left" }}>
                <Slide presentation={presentation} slides={slides} index={slideIndex} />
              </div>
            </div>
          </div>

          <div className="grid gap-4">
            <div className="card">
              <div className="card-head">
                <div className="card-title">Presenter — private</div>
                <span className="chip">Never on the client screen</span>
              </div>
              {slide?.presenterNotes ? (
                <p className="text-[0.88rem] leading-7">
                  <Linkified text={slide.presenterNotes} clientId={clientId} />
                </p>
              ) : (
                <p className="muted text-[0.86rem]">
                  No presenter script was written for this slide. Use the points below and the client&apos;s own
                  answers.
                </p>
              )}

              {slidePart?.ask.length ? (
                <>
                  <div className="eyebrow muted mt-4">Ask here</div>
                  <ul className="mt-2 grid gap-2">
                    {slidePart.ask.map((question, index) => (
                      <li key={`slide-ask-${index}`} className="text-[0.86rem]" style={{ color: "var(--text)" }}>
                        <strong>{question}</strong>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              {showQaChips && slidePart?.qaChips.length ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {slidePart.qaChips.map((chip) => (
                    <span key={`slide-qa-${chip}`} className="chip">
                      QA · {chip}
                    </span>
                  ))}
                </div>
              ) : null}

              {slides[slideIndex + 1] ? (
                <p className="field-hint mt-4">
                  <strong>Next slide:</strong> {slides[slideIndex + 1].title}
                </p>
              ) : (
                <p className="field-hint mt-4">Last slide — close with the recap, then end the call.</p>
              )}
            </div>

            <Field
              id={`capture-${noteKey}`}
              label="Capture — decisions, dates, quotes"
              hint="Internal, saved as you type. This goes to the follow-through with the transcript."
              value={notes[noteKey] || ""}
              placeholder="e.g. Agreed a 2-hour call-back target; Jenna sends the intake details by Jul 10"
              onChange={(value) => saveNote(noteKey, value)}
            />
          </div>
        </div>
      ) : parts.length && part ? (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,210px)_minmax(0,1fr)]">
          <aside className="card" aria-label="Call guide parts">
            <p className="card-title mb-2.5">The call</p>
            {parts.map((candidate, index) => (
              <button
                key={candidate.key}
                type="button"
                className={`live-seg-btn ${index === partIndex ? "on" : ""}`}
                onClick={() => setPartIndex(index)}
              >
                <span className="live-seg-name">
                  {candidate.n}. {candidate.title}
                </span>
                <span className="live-seg-meta">
                  {candidate.minutes} min
                  {notes[candidate.key]?.trim() ? " · notes" : ""}
                </span>
              </button>
            ))}
            <p className="field-hint mt-3">
              {parts.length} parts, timed for a {plannedMinutes}-minute call. Declined sections are not here. Arrow
              keys move between parts.
            </p>
          </aside>

          <div className="grid gap-4">
            <GuidePartCard part={part} clientId={clientId} total={parts.length} />

            <div className="card">
              <Field
                id={`capture-${part.key}`}
                label="Capture — decisions, dates, quotes"
                hint="Internal, saved as you type. This goes to the follow-through with the transcript."
                value={notes[part.key] || ""}
                placeholder="e.g. Agreed a 2-hour call-back target; Jenna sends the intake details by Jul 10"
                onChange={(value) => saveNote(part.key, value)}
                rows={6}
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <span className="muted min-w-0 text-[0.82rem]">
                  {part.next ? (
                    <>
                      <strong>Next:</strong> {part.next}
                    </>
                  ) : null}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={partIndex === 0}
                    onClick={() => move(-1)}
                  >
                    <ChevronLeft />
                    Back
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={partIndex >= parts.length - 1}
                    onClick={() => move(1)}
                  >
                    Next part
                    <ChevronRight />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="card">
          <p className="text-[0.88rem] leading-7" style={{ color: "var(--text-2)" }}>
            There is no call guide for this touch yet. Approving the brief on the review step is what builds it —
            until then there is nothing here to present to {clientName}.
          </p>
        </div>
      )}

      {preview ? (
        <div
          className="live-shell"
          style={{ zIndex: 90, gridTemplateRows: "auto 1fr" }}
          role="dialog"
          aria-modal="true"
          aria-label="The client's view"
        >
          <div className="live-bar">
            <div className="flex items-center gap-3">
              <span className="chip info">Client-facing</span>
              <span className="h4">This is exactly what the client sees</span>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreview(false)}>
              <X />
              Back to your screen
            </button>
          </div>
          <div className="grid place-items-center" style={{ padding: 18, overflow: "auto" }}>
            <Slide presentation={presentation} slides={slides} index={slideIndex} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export { formatClock };
