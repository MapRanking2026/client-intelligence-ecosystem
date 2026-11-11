"use client";

import { useCallback, useState } from "react";
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw } from "lucide-react";

import { readJsonResponse } from "@/src/lib/api/read-json-response";

/**
 * The Performance tab's own refresh.
 *
 * The card this sits in used to say only what it was -- "Snapshot, not live data. Taken when the
 * preparation last ran. Run the preparation again for current numbers." True, and the only way out
 * of it was a three-to-five-minute preparation that also re-runs the model and rewrites the agenda.
 * So an AM about to take a call looked at last month's figures and went to the platforms directly.
 *
 * This asks every platform for this client's numbers again and rewrites the three panels below,
 * and nothing else: the brief, the agenda and the recommendations are left exactly as they are.
 * That is the whole reason it is a separate action rather than a shortcut to the preparation.
 *
 * It takes a while -- it is the same set of API calls the preparation's first half makes -- so the
 * button says what it is doing and the per-platform result is left on the screen afterwards. An AM
 * who sees a figure that did not move needs to know whether the platform was asked and said the
 * same thing, or was never reached.
 */

interface RefreshSource {
  label: string;
  status: string;
  detail: string;
}

interface RefreshResult {
  refreshedAt: string;
  sources: RefreshSource[];
  rebuilt: boolean;
  message: string;
}

/** The statuses the refreshers use, grouped into the three things an AM does about them. */
function tone(status: string): "good" | "watch" | "risk" {
  if (status === "refreshed") return "good";
  if (status === "failed" || status === "timed-out") return "risk";
  return "watch";
}

function whenLabel(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function PerformanceRefresh({
  clientId,
  clientName,
  /** When the whole preparation last ran, for the line about where these figures came from. */
  preparedAt,
  /** When the panels were last refreshed on their own, if they ever were. */
  refreshedAt,
}: {
  clientId: string;
  clientName: string;
  preparedAt?: string;
  refreshedAt?: string;
}) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RefreshResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`/api/clients/${encodeURIComponent(clientId)}/performance-refresh`, {
        method: "POST",
      });
      const body = await readJsonResponse<{ data?: RefreshResult; error?: string }>(response);
      if (!response.ok || !body?.data) {
        throw new Error(body?.error || "The refresh could not be completed. Nothing was changed.");
      }
      setResult(body.data);
      /*
        Reloaded rather than patched in: the three panels below are server-rendered from the touch
        this just rewrote, so a reload is the only way the numbers on the screen are the numbers in
        the database. The result above survives it in the sense that matters -- the card will then
        show the new refresh time.
      */
      globalThis.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The refresh could not be completed.");
    } finally {
      setRunning(false);
    }
  }, [clientId]);

  const prepared = whenLabel(preparedAt);
  const refreshed = whenLabel(refreshedAt);

  return (
    <div className="card" style={{ borderLeft: "3px solid var(--accent)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="card-title">{refreshed ? "Refreshed on demand" : "Snapshot, not live data"}</div>
          <p className="mt-1.5 text-[0.86rem]" style={{ color: "var(--text-2)" }}>
            {refreshed ? (
              <>
                The three panels below were re-read for {clientName} on {refreshed}
                {prepared ? `, over a preparation from ${prepared}` : ""}. Press refresh again for the numbers as
                they stand now.
              </>
            ) : (
              <>
                Taken when the preparation last ran for {clientName}
                {prepared ? ` on ${prepared}` : ""}. Nothing here has changed since — press refresh to ask every
                platform again.
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button type="button" className="btn btn-primary" disabled={running} onClick={() => void refresh()}>
            {running ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            {running ? "Refreshing…" : "Refresh performance"}
          </button>
        </div>
      </div>

      <p className="field-hint mt-2">
        Re-reads the Business Profile, GoHighLevel and every other connected platform, then rewrites the scorecard,
        the local visibility panel and the paid-media panel. The brief, the agenda and the recommendations are not
        touched. Usually under a minute.
      </p>

      {error ? (
        <p
          className="mt-3 rounded-[10px] px-3 py-2.5 text-[0.82rem] leading-6"
          style={{ background: "var(--risk-bg)", color: "var(--risk)" }}
        >
          <AlertTriangle style={{ width: 14, height: 14, display: "inline", marginRight: 6, verticalAlign: "-2px" }} />
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-3">
          <p
            className="rounded-[10px] px-3 py-2.5 text-[0.82rem] leading-6"
            style={{ background: "var(--good-bg)", color: "var(--good)" }}
          >
            <CheckCircle2
              style={{ width: 14, height: 14, display: "inline", marginRight: 6, verticalAlign: "-2px" }}
            />
            {result.message}
          </p>
          {/*
            Every platform, including the ones that said nothing. A figure that did not move is a
            different fact depending on whether the platform answered, and this is the only place
            that distinction is visible.
          */}
          <ul className="mt-2.5 grid gap-1.5">
            {result.sources.map((source) => (
              <li key={source.label} className="flex items-start gap-2 text-[0.8rem]">
                <span
                  className={`sig-dot ${tone(source.status)}`}
                  style={{ marginTop: 6, flexShrink: 0 }}
                  aria-hidden
                />
                <span>
                  <strong style={{ color: "var(--text)" }}>{source.label}</strong> — {source.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
