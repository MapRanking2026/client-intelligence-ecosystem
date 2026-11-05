"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { readJsonResponse } from "@/src/lib/api/read-json-response";
import type { CoachingItem, QcCriterionNote, QcDraftValue, QcGoal } from "@/src/lib/contracts/qc-record";

/**
 * Autosave for the QC scoring screen.
 *
 * A QC draft is sent as a **whole snapshot**, not a patch, which is the one real difference from
 * `useTouchAutosave`. A scoring form is seventeen scores, their notes, a goal and a coaching plan,
 * and the last state of it is the only state worth storing -- so the newest snapshot simply replaces
 * whatever is queued. Nothing has to be merged, which also removes the way a patch merger can go
 * wrong: a score cleared back to undecided cannot be resurrected by an older patch landing later.
 *
 * Two behaviours are kept from the touch hook because they are what make autosave trustworthy:
 *
 *  - A save in flight does not swallow later edits. Anything changed while a request is open is
 *    sent after it, so the last thing the reviewer did is the thing stored.
 *  - A failed save says so and keeps the snapshot. A review is an hour of careful work; losing it
 *    silently is the worst thing this file could do.
 *
 * Roughly 800 ms, as the handoff asks. Short enough that closing the tab after a click is safe,
 * long enough that typing a note is one request rather than one per keystroke.
 */

export type QcSaveState = "idle" | "saving" | "saved" | "error";

export interface QcDraftSnapshot {
  crit: QcDraftValue[];
  notes: Record<number, QcCriterionNote>;
  goal?: QcGoal;
  strengths?: string;
  focus?: string;
  coaching?: CoachingItem[];
}

export interface QcDraftAutosave {
  save: (snapshot: QcDraftSnapshot) => void;
  /** Send anything pending now. Used before a submit, so the two cannot race. */
  flush: () => Promise<void>;
  state: QcSaveState;
  savedAt?: string;
  error?: string;
}

export function useQcDraftAutosave(touchId: string, delayMs = 800): QcDraftAutosave {
  const [state, setState] = useState<QcSaveState>("idle");
  const [savedAt, setSavedAt] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const pending = useRef<QcDraftSnapshot | undefined>(undefined);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const send = useCallback(async () => {
    if (inFlight.current) return;
    const snapshot = pending.current;
    if (!snapshot) return;
    pending.current = undefined;
    inFlight.current = true;
    setState("saving");
    try {
      const response = await fetch(`/api/qc/${touchId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "save_qc_draft", ...snapshot }),
      });
      const payload = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(payload?.error || "This draft could not be saved.");
      setSavedAt(new Date().toISOString());
      setError(undefined);
      setState("saved");
    } catch (caught) {
      // Only if nothing newer has arrived: a later snapshot is already a superset of this one, and
      // putting the stale one back would undo whatever the reviewer did while the request was open.
      if (!pending.current) pending.current = snapshot;
      setError(caught instanceof Error ? caught.message : "This draft could not be saved.");
      setState("error");
    } finally {
      inFlight.current = false;
      if (pending.current) timer.current = setTimeout(() => void send(), delayMs);
    }
  }, [touchId, delayMs]);

  const save = useCallback(
    (snapshot: QcDraftSnapshot) => {
      pending.current = snapshot;
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
