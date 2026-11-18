"use client";

import { clientSlides } from "@/src/lib/contracts/client-content";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Maximize2,
  MessageSquareQuote,
  Pencil,
  Play,
  Sparkles,
  X,
} from "lucide-react";

import { AiProgressPanel, useAiRun } from "@/src/components/mtos/ai-progress";
import { PresentationEditor } from "@/src/components/mtos/presentation-editor";
import { DECK, PresentationSlideCanvas } from "@/src/components/mtos/presentation-slide";
import { readJsonResponse } from "@/src/lib/api/read-json-response";
import { editableSlide, normalizeSlide, slideIsHiddenFromClient } from "@/src/lib/contracts/presentation-edit";
import { slidesMissingScript } from "@/src/lib/contracts/presenter-script";
import type { Presentation, PresentationSlide } from "@/src/lib/mtos-data";

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
  readOnly = false,
  toolsOnly = false,
  target = "touch",
  blockedTitles,
}: {
  touchId: string;
  presentation?: Presentation;
  readOnly?: boolean;
  toolsOnly?: boolean;
  /** Which of the touch's decks this is, so edits are saved back to the right one. */
  target?: "touch" | "loom";
  /** Open commitments and undelivered promises, for the editor's client-visibility warnings. */
  blockedTitles?: string[];
}) {
  const [index, setIndex] = useState(0);
  const [showNotes, setShowNotes] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scale, setScale] = useState(0.5);
  const [error, setError] = useState<string | null>(null);
  const ai = useAiRun();

  /**
   * The working copy while editing.
   *
   * `null` means "not editing", and the viewer shows `clientSlides(...)` -- the deck as the client
   * will see it. While editing it holds the FULL stored slides, because the filtered view drops
   * slides entirely, and saving that back would delete them. The editor marks the ones the client
   * will not see instead of hiding them from the AM.
   */
  const [draft, setDraft] = useState<PresentationSlide[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [scripting, setScripting] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const fullscreenRef = useRef<HTMLDivElement | null>(null);

  const editing = draft !== null;
  const slides = editing ? draft : clientSlides(presentation?.slides);
  const count = slides.length;
  const current = slides[Math.min(index, Math.max(count - 1, 0))];
  // Both sides are normalized before comparing, so whitespace the AM has not actually changed
  // does not light up the unsaved badge for the whole call.
  const asSaved = (list: PresentationSlide[]) => JSON.stringify(list.map((slide) => editableSlide(normalizeSlide(slide))));
  const dirty = editing && asSaved(presentation?.slides || []) !== asSaved(draft);
  const missingScripts = slidesMissingScript(presentation?.slides);

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
    if ((toolsOnly && !editing) || !count) return;
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
  }, [count, editing, go, toolsOnly]);

  async function present() {
    try {
      await fullscreenRef.current?.requestFullscreen();
    } catch {
      // Some browsers refuse without a user gesture they recognise; the inline
      // viewer still works, so say so rather than failing silently.
      setError("This browser would not go full screen. Use the slide below, or press F11.");
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/monthly-touches/${touchId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "save_presentation_slides",
          target,
          ...(presentation?.generatedAt ? { generatedAt: presentation.generatedAt } : {}),
          slides: draft.map((slide) => editableSlide(normalizeSlide(slide))),
        }),
      });
      const payload = await readJsonResponse<{ error?: string; savedAt?: string; slides?: PresentationSlide[] }>(response);
      if (!response.ok) throw new Error(payload?.error || "These slide edits could not be saved.");
      // Reload rather than patching local state: the saved slides come back with their generated
      // snapshots and reattached rank captures, and every other panel on the page reads the touch.
      globalThis.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "These slide edits could not be saved.");
      setSaving(false);
    }
  }

  // Ctrl/Cmd+S saves, because this gets used minutes before a call and that is the reflex. The
  // handler is held in a ref so the listener is bound once per editing session rather than
  // rebound on every keystroke in the editor.
  const saveShortcut = useRef<() => void>(() => {});
  useEffect(() => {
    saveShortcut.current = () => {
      if (!saving) void save();
    };
  });
  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveShortcut.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing]);

  // A reload or a tab close with unsaved slides asks first. The browser shows its own wording.
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  /** The spoken script for every slide, written against the deck as it now stands. */
  async function writeScripts() {
    setScripting(true);
    setError(null);
    try {
      const response = await fetch(`/api/monthly-touches/${touchId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "generate_presentation_scripts", target }),
      });
      const payload = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(payload?.error || "The presenter scripts could not be written.");
      globalThis.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The presenter scripts could not be written.");
      setScripting(false);
    }
  }

  function startEditing() {
    setError(null);
    setDraft((presentation?.slides || []).map((slide) => ({ ...slide })));
    setIndex(0);
  }

  function stopEditing() {
    if (dirty && !globalThis.confirm("Discard your unsaved slide edits?")) return;
    setDraft(null);
    setIndex(0);
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
      <div className={toolsOnly ? "flex flex-wrap gap-2" : "card flex flex-wrap items-start justify-between gap-3"}>
        {!toolsOnly ? <div className="min-w-0">
          <p className="card-title">
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
        : null}
        <div className="flex flex-wrap gap-2">
          {count ? (
            <>
              {!toolsOnly ? <button
                type="button"
                onClick={present}
                style={{ color: "#0d1625" }}
                className="btn btn-primary"
              >
                <Play className="h-4 w-4" />
                Play slideshow
              </button> : null}
              <a
                href={`/api/monthly-touches/${touchId}/presentation.pptx`}
                className="btn btn-ghost"
              >
                <Download className="h-4 w-4" />
                Download .pptx
              </a>
            </>
          ) : null}
          {!readOnly && presentation?.status === "generated" && presentation.slides?.length ? (
            <>
              <button type="button" onClick={editing ? stopEditing : startEditing} className="btn btn-ghost">
                {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                {editing ? "Close editor" : "Edit slides"}
              </button>
              {/* Written here rather than only on the call screen: the AM reads the scripts through
                  while preparing, and edits them in the slide editor before the client is on. */}
              <button type="button" onClick={() => void writeScripts()} disabled={scripting || dirty} className="btn btn-ghost">
                <MessageSquareQuote className="h-4 w-4" />
                {scripting
                  ? "Writing scripts…"
                  : missingScripts
                    ? `Write presenter scripts (${missingScripts} missing)`
                    : "Rewrite presenter scripts"}
              </button>
            </>
          ) : null}
          {!readOnly ? <button
            type="button"
            onClick={generate}
            disabled={ai.isRunning || dirty}
            title={dirty ? "Save or discard your slide edits first — regenerating replaces every slide." : undefined}
            className="btn btn-ghost"
          >
            <Sparkles className="h-4 w-4" />
            {presentation?.status === "generated" ? "Regenerate presentation" : "Generate presentation"}
          </button> : null}
        </div>
      </div>

      {ai.run ? <AiProgressPanel run={ai.run} elapsed={ai.elapsed} /> : null}
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      {presentation?.errorMessage ? <p className="text-sm text-amber-200">{presentation.errorMessage}</p> : null}

      {(!toolsOnly || editing) && count && current ? (
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
                className="btn btn-ghost btn-sm"
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
                className="btn btn-ghost btn-sm"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <span className="ml-2 text-xs text-slate-500">Arrow keys or space to move</span>
            </div>

            <button
              type="button"
              onClick={() => setShowNotes((value) => !value)}
              className="btn btn-ghost btn-sm"
            >
              {showNotes ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showNotes ? "Hide notes" : "Show notes"}
            </button>
          </div>

          {editing ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-400">
                  {dirty ? "Unsaved changes" : "All changes saved"}
                  {presentation?.editedAt && !dirty
                    ? ` · last edited by ${presentation.editedBy || "an account manager"}`
                    : ""}
                  {" · ⌘/Ctrl+S saves"}
                </p>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={stopEditing}>
                    Discard
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    style={{ color: "#0d1625" }}
                    disabled={saving || !dirty}
                    onClick={() => void save()}
                  >
                    {saving ? "Saving…" : "Save slides"}
                  </button>
                </div>
              </div>
              <PresentationEditor
                slides={draft}
                index={Math.min(index, count - 1)}
                blockedTitles={blockedTitles}
                onSlides={setDraft}
                onIndex={setIndex}
              />
            </>
          ) : null}

          {showNotes && !editing ? (
            <div className="panel">
              <p className="card-title">
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
                {editing && slideIsHiddenFromClient(slide, blockedTitles) ? (
                  <span
                    className="absolute inset-x-0 bottom-0 bg-amber-500/80 py-0.5 text-[9px] font-semibold text-black"
                    title="The client never sees this slide."
                  >
                    HIDDEN
                  </span>
                ) : null}
                {editing && slide.edited ? (
                  <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[color:var(--accent)]" title="Edited" />
                ) : null}
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

      {!toolsOnly && count && !isFullscreen ? (
        <p className="text-xs text-slate-500">
          <Maximize2 className="mr-1 inline h-3 w-3" />
          Play slideshow fills the screen with the slide alone — share that window on the call. Your notes
          stay on this page behind it.
        </p>
      ) : null}
    </div>
  );
}
