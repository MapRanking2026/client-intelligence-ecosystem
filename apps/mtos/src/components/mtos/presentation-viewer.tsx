"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Maximize2,
  Play,
  Sparkles,
} from "lucide-react";

import { AiProgressPanel, useAiRun } from "@/src/components/mtos/ai-progress";
import { DECK, PresentationSlideCanvas } from "@/src/components/mtos/presentation-slide";
import { readJsonResponse } from "@/src/lib/api/read-json-response";
import type { Presentation } from "@/src/lib/mtos-data";

/**
 * The deck surface: a scaled slide, a thumbnail rail, presenter notes, and a
 * full-screen slideshow for presenting over a video call.
 *
 * Scaling. Slides are authored at a fixed 1280x720 (see presentation-slide.tsx) and
 * scaled with a CSS transform rather than laid out responsively, so what the AM
 * reviews, what the client sees full screen, and what lands in the .pptx are the
 * same slide at different sizes.
 *
 * Presenter notes NEVER render inside the full-screen element. The AM shares that
 * window on the call, so anything drawn there is on the client's screen. The notes
 * live in the page behind it; a second monitor or a phone is the presenter view.
 * If you add anything to the full-screen subtree, assume the client is reading it.
 */
export function PresentationViewer({
  touchId,
  presentation,
}: {
  touchId: string;
  presentation?: Presentation;
}) {
  const [index, setIndex] = useState(0);
  const [showNotes, setShowNotes] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scale, setScale] = useState(0.5);
  const [error, setError] = useState<string | null>(null);
  const ai = useAiRun();

  const stageRef = useRef<HTMLDivElement | null>(null);
  const fullscreenRef = useRef<HTMLDivElement | null>(null);

  const slides = presentation?.slides || [];
  const count = slides.length;
  const current = slides[Math.min(index, Math.max(count - 1, 0))];

  const go = useCallback(
    (delta: number) => setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(count - 1, 0))),
    [count],
  );

  // Fit the slide to whatever box it is in, full screen or inline.
  useEffect(() => {
    const measure = () => {
      const box = isFullscreen ? fullscreenRef.current : stageRef.current;
      if (!box) return;
      const available = box.getBoundingClientRect();
      if (!available.width || !available.height) return;
      setScale(Math.min(available.width / DECK.width, available.height / DECK.height));
    };
    measure();
    window.addEventListener("resize", measure);
    const timer = window.setTimeout(measure, 60);
    return () => {
      window.removeEventListener("resize", measure);
      window.clearTimeout(timer);
    };
  }, [isFullscreen, count]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (!count) return;
    const onKey = (event: KeyboardEvent) => {
      // Never steal keys from a field the AM is typing in.
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault();
        go(1);
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        go(-1);
      } else if (event.key === "Home") {
        setIndex(0);
      } else if (event.key === "End") {
        setIndex(count - 1);
      }
      // Escape is left to the browser, which exits full screen itself.
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, go]);

  async function present() {
    try {
      await fullscreenRef.current?.requestFullscreen();
    } catch {
      // Some browsers refuse without a user gesture they recognise; the inline
      // viewer still works, so say so rather than failing silently.
      setError("This browser would not go full screen. Use the slide below, or press F11.");
    }
  }

  function generate() {
    setError(null);
    ai.start(
      [presentation?.status === "generated" ? "Rebuilding the presentation" : "Building the presentation"],
      "Usually 2-4 minutes — it writes every slide and its presenter notes",
    );

    void (async () => {
      try {
        const response = await fetch(`/api/monthly-touches/${touchId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "generate_presentation" }),
        });
        const payload = await readJsonResponse<{ error?: string }>(response);
        if (!response.ok) throw new Error(payload?.error || "Unable to generate the presentation");
        globalThis.location.reload();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to generate the presentation");
      } finally {
        ai.stop();
      }
    })();
  }

  const slideProps = {
    deckTitle: presentation?.title,
    clientName: presentation?.clientName,
    periodLabel: presentation?.periodLabel,
    preparedFor: presentation?.preparedFor,
    preparedBy: presentation?.preparedBy,
    slideCount: count,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-[24px] border border-white/8 bg-black/20 p-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
            Client presentation
          </p>
          <p className="mt-1 text-sm text-slate-300">
            {presentation?.status === "generated"
              ? `${presentation.title || "Deck"}${presentation.periodLabel ? ` · ${presentation.periodLabel}` : ""} — ${count} slides. Play it full screen to present on the call.`
              : "The other way to run the touch: a Map Ranking-branded deck built from this prep, with private presenter notes. Generate it, review it, then present."}
          </p>
          {presentation?.experienceFormat ? (
            <p className="mt-1 text-xs text-slate-500">
              Format: {presentation.experienceFormat}
              {presentation.formatRationale ? ` — ${presentation.formatRationale}` : ""}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {count ? (
            <>
              <button
                type="button"
                onClick={present}
                style={{ color: "#0d1625" }}
                className="inline-flex items-center gap-2 rounded-full border border-[#d7f5ec]/20 bg-[#d7f5ec] px-4 py-2 text-sm font-semibold transition hover:bg-white"
              >
                <Play className="h-4 w-4" />
                Play slideshow
              </button>
              <a
                href={`/api/monthly-touches/${touchId}/presentation.pptx`}
                className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10"
              >
                <Download className="h-4 w-4" />
                Download .pptx
              </a>
            </>
          ) : null}
          <button
            type="button"
            onClick={generate}
            disabled={ai.isRunning}
            className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Sparkles className="h-4 w-4" />
            {presentation?.status === "generated" ? "Regenerate presentation" : "Generate presentation"}
          </button>
        </div>
      </div>

      {ai.run ? <AiProgressPanel run={ai.run} elapsed={ai.elapsed} /> : null}
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      {presentation?.errorMessage ? <p className="text-sm text-amber-200">{presentation.errorMessage}</p> : null}

      {count && current ? (
        <div className="space-y-3">
          <div
            ref={stageRef}
            className="relative w-full overflow-hidden rounded-[20px] border border-[color:var(--hair-strong)] bg-[color:var(--surface-2)]"
            style={{ aspectRatio: `${DECK.width} / ${DECK.height}` }}
          >
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                transform: `translate(-50%, -50%) scale(${scale})`,
                transformOrigin: "center center",
                width: DECK.width,
                height: DECK.height,
              }}
            >
              <PresentationSlideCanvas {...slideProps} slide={current} slideNumber={index + 1} />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => go(-1)}
                disabled={index === 0}
                aria-label="Previous slide"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="font-mono text-xs tabular-nums text-slate-400">
                {index + 1} / {count}
              </span>
              <button
                type="button"
                onClick={() => go(1)}
                disabled={index >= count - 1}
                aria-label="Next slide"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/12 bg-white/5 text-slate-200 transition hover:bg-white/10 disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <span className="ml-2 text-xs text-slate-500">Arrow keys or space to move</span>
            </div>

            <button
              type="button"
              onClick={() => setShowNotes((value) => !value)}
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10"
            >
              {showNotes ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showNotes ? "Hide notes" : "Show notes"}
            </button>
          </div>

          {showNotes ? (
            <div className="rounded-[20px] border border-[color:var(--hair-strong)] bg-[color:var(--surface-2)] p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                Presenter notes — only you see these
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-200">
                {current.presenterNotes || "No notes for this slide."}
              </p>
            </div>
          ) : null}

          {/* Thumbnail rail. Each one is the real slide at 1/8 scale, so what you pick
              is exactly what you present. */}
          <div className="flex gap-3 overflow-x-auto pb-2">
            {slides.map((slide, slideIndex) => (
              <button
                key={slideIndex}
                type="button"
                onClick={() => setIndex(slideIndex)}
                aria-label={`Slide ${slideIndex + 1}: ${slide.title}`}
                aria-current={slideIndex === index}
                className={`relative shrink-0 overflow-hidden rounded-lg border-2 transition ${
                  slideIndex === index
                    ? "border-[color:var(--accent)]"
                    : "border-[color:var(--hair-strong)] opacity-70 hover:opacity-100"
                }`}
                style={{ width: DECK.width / 8, height: DECK.height / 8 }}
              >
                <div
                  style={{
                    transform: "scale(0.125)",
                    transformOrigin: "top left",
                    width: DECK.width,
                    height: DECK.height,
                    pointerEvents: "none",
                  }}
                >
                  <PresentationSlideCanvas {...slideProps} slide={slide} slideNumber={slideIndex + 1} />
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* The full-screen surface. Always mounted so requestFullscreen has a target,
          and it draws nothing until it is actually full screen. CLIENT-VISIBLE: the
          slide only, never notes, never controls that reveal internal state. */}
      <div
        ref={fullscreenRef}
        className={isFullscreen ? "flex h-screen w-screen items-center justify-center bg-black" : "hidden"}
      >
        {isFullscreen && current ? (
          <div
            style={{
              transform: `scale(${scale})`,
              transformOrigin: "center center",
              width: DECK.width,
              height: DECK.height,
              flexShrink: 0,
            }}
          >
            <PresentationSlideCanvas {...slideProps} slide={current} slideNumber={index + 1} />
          </div>
        ) : null}
      </div>

      {count && !isFullscreen ? (
        <p className="text-xs text-slate-500">
          <Maximize2 className="mr-1 inline h-3 w-3" />
          Play slideshow fills the screen with the slide alone — share that window on the call. Your notes
          stay on this page behind it.
        </p>
      ) : null}
    </div>
  );
}
