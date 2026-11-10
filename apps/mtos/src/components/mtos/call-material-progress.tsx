"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, LoaderCircle, Presentation, Sparkles } from "lucide-react";

import { readJsonResponse } from "@/src/lib/api/read-json-response";
import type { ApprovalStepState } from "@/src/lib/contracts/touch-approval";
import type { LiveCallFormat } from "@/src/lib/mtos-data";

/**
 * What the Live stage shows while the material it runs on is still being built.
 *
 * The approval builds the chosen presentation or call guide as its last step, and the AM can reach
 * Live before that step has finished -- the timeline is one click, and the approval's own progress
 * dialog can be closed. Before this, that looked like a Live screen with an empty deck on it: no
 * slides, no explanation, and nothing to press. An AM mid-call does not debug a blank screen, they
 * open ClickUp and present from last month.
 *
 * So the state is said out loud and the screen waits: the approval's own build step is the source
 * of truth for what is happening, the poll notices the moment the material lands, and the button
 * is there for the case the build failed or was never run at all.
 */

const LABEL: Record<LiveCallFormat, string> = {
  deck: "client presentation",
  guide: "call guide",
};

export function CallMaterialProgress({
  touchId,
  format,
  /** The build step from the approval, when this touch has been approved. */
  step,
}: {
  touchId: string;
  format: LiveCallFormat;
  step?: ApprovalStepState;
}) {
  const [building, setBuilding] = useState(step?.status === "running");
  const [error, setError] = useState<string | null>(null);
  const waiting = building || step?.status === "running" || step?.status === "pending";

  /**
   * Watch for the material rather than guess at a duration.
   *
   * The reload happens when the generated thing is genuinely there, which is the only signal worth
   * acting on: a progress bar that finishes on a timer and leaves an empty deck behind it is the
   * same lie as no progress bar at all.
   */
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => {
      void fetch(`/api/monthly-touches/${encodeURIComponent(touchId)}`, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((payload) => {
          const touch = payload?.data?.touch;
          const ready =
            format === "deck"
              ? touch?.presentation?.status === "generated"
              : touch?.callGuide?.status === "generated";
          if (ready) globalThis.location.reload();
        })
        .catch(() => undefined);
    }, 10_000);
    return () => clearInterval(id);
  }, [format, touchId, waiting]);

  const build = useCallback(async () => {
    setBuilding(true);
    setError(null);
    try {
      const response = await fetch(`/api/monthly-touches/${encodeURIComponent(touchId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: format === "deck" ? "generate_presentation" : "generate_call_guide",
        }),
      });
      const result = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(result?.error || `The ${LABEL[format]} could not be built.`);
      globalThis.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `The ${LABEL[format]} could not be built.`);
      setBuilding(false);
    }
  }, [format, touchId]);

  const failed = step?.status === "failed";

  return (
    <div className="card mt-4" style={failed ? { borderColor: "var(--risk)" } : undefined}>
      <div className="card-head">
        <div className="card-title flex items-center gap-2">
          {format === "deck" ? (
            <Presentation style={{ width: 16, height: 16 }} />
          ) : (
            <Sparkles style={{ width: 16, height: 16 }} />
          )}
          Your {LABEL[format]}
        </div>
        <span className={`chip ${failed ? "risk" : waiting ? "watch" : "info"}`}>
          {failed ? "Build failed" : waiting ? "Building" : "Not built yet"}
        </span>
      </div>

      {waiting && !failed ? (
        <p className="text-[0.88rem] leading-7" style={{ color: "var(--text-2)" }}>
          <LoaderCircle
            className="animate-spin"
            style={{ width: 14, height: 14, display: "inline", marginRight: 6, verticalAlign: "-2px" }}
          />
          The approval is building your {LABEL[format]} from the approved sections. It appears here the moment it is
          ready — this screen is watching for it, so you can leave the tab open and come back.
        </p>
      ) : (
        <p className="text-[0.88rem] leading-7" style={{ color: "var(--text-2)" }}>
          {failed
            ? `The approval could not build it: ${step?.detail || "no reason was recorded."} Everything else in the approval is done, so building it again is the only thing left.`
            : `This touch has no ${LABEL[format]} yet. Build it from the approved sections, or switch format above and run the call from the other one.`}
        </p>
      )}

      {error ? (
        <p
          className="mt-3 rounded-[10px] px-3 py-2.5 text-[0.82rem] leading-6"
          style={{ background: "var(--risk-bg)", color: "var(--risk)" }}
        >
          <AlertTriangle style={{ width: 14, height: 14, display: "inline", marginRight: 6, verticalAlign: "-2px" }} />
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <button type="button" className="btn btn-primary" disabled={building} onClick={() => void build()}>
          {building ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
          {failed ? `Build the ${LABEL[format]} again` : `Build the ${LABEL[format]} now`}
        </button>
        <span className="muted text-[0.8rem]">Usually under a minute.</span>
      </div>
    </div>
  );
}
