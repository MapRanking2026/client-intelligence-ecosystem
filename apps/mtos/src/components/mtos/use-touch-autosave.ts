"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { TouchDraftPatch } from "@/src/lib/contracts/touch-draft";

/**
 * Autosave for the Monthly Touch screens.
 *
 * Why a hook and not a Save button: the review brief, the agenda email and the live notes are all
 * long-form editing, done across days and interruptions, and the screens used to lose whatever was
 * typed when the AM navigated or the page reloaded. The fix people reach for is a Save button, but
 * a Save button is only as good as the AM remembering to press it before they get pulled onto a
 * call -- which is exactly when they don't.
 *
 * Three behaviours matter and none of them are default:
 *
 *  - Patches are coalesced. Typing produces a patch per keystroke; they are merged and sent once
 *    the typing stops, so a paragraph is one request rather than two hundred.
 *  - A save in flight does not swallow later edits. Anything typed while a request is open is kept
 *    and sent after it, so the last thing typed is the thing stored.
 *  - A failed save says so and keeps the patch. Silently dropping an edit is worse than any error
 *    message, because the AM only finds out when the text is gone.
 */

export type SaveState = "idle" | "saving" | "saved" | "error";

interface TouchStateResponse {
  data?: { savedAt?: string; progress?: string; followThroughDueAt?: string };
  error?: string;
}

/** Deep-ish merge of two patches: one level of groups, then field-by-field within each group. */
function mergePatch(base: TouchDraftPatch, next: TouchDraftPatch): TouchDraftPatch {
  const merged: TouchDraftPatch = { ...base };
  for (const key of ["review", "agendaEmail", "live"] as const) {
    const incoming = next[key];
    if (!incoming) continue;
    // `as never` only to satisfy the index write across the three differently-shaped groups.
    merged[key] = { ...(base[key] || {}), ...incoming } as never;
  }
  return merged;
}

export interface TouchAutosave {
  save: (patch: TouchDraftPatch) => void;
  /** Send anything pending immediately -- used before an action that reloads the server state. */
  flush: () => Promise<void>;
  state: SaveState;
  /** ISO time of the last accepted save, for the "last saved" line. */
  savedAt?: string;
  error?: string;
}

export function useTouchAutosave(touchId: string, delayMs = 900): TouchAutosave {
  const [state, setState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const pending = useRef<TouchDraftPatch | undefined>(undefined);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const send = useCallback(async () => {
    if (inFlight.current) return;
    const patch = pending.current;
    if (!patch) return;
    pending.current = undefined;
    inFlight.current = true;
    setState("saving");
    try {
      const response = await fetch(`/api/monthly-touches/${touchId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "save_touch_draft", ...patch }),
      });
      const payload = (await response.json()) as TouchStateResponse;
      if (!response.ok) throw new Error(payload.error || "That edit could not be saved.");
      setSavedAt(payload.data?.savedAt || new Date().toISOString());
      setError(undefined);
      setState("saved");
    } catch (caught) {
      // The patch goes back on the queue: the AM's text is the thing being protected here, so a
      // failed request must not be the reason it disappears.
      pending.current = pending.current ? mergePatch(patch, pending.current) : patch;
      setError(caught instanceof Error ? caught.message : "That edit could not be saved.");
      setState("error");
    } finally {
      inFlight.current = false;
      if (pending.current) {
        timer.current = setTimeout(() => void send(), delayMs);
      }
    }
  }, [touchId, delayMs]);

  const save = useCallback(
    (patch: TouchDraftPatch) => {
      pending.current = pending.current ? mergePatch(pending.current, patch) : patch;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void send(), delayMs);
    },
    [send, delayMs],
  );

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    await send();
  }, [send]);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return { save, flush, state, savedAt, error };
}
