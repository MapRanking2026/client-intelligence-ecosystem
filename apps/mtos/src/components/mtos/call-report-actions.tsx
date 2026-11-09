"use client";

import { useState } from "react";
import { Printer } from "lucide-react";

import { RECORDINGS_PER_BATCH, type ReportRow } from "@/src/lib/contracts/call-client-report";

/**
 * The only two things on the client report that need the browser.
 *
 * Everything else about the report is server-rendered, so it prints the same whether or not
 * JavaScript ran. These two cannot be: printing is a browser command, and the recordings have to
 * arrive in batches rather than all at once.
 */

/**
 * Print.
 *
 * `window.print()` rather than a PDF endpoint, because the browser's own dialogue is already the
 * thing people want -- it offers "Save as PDF", it honours the print stylesheet, and it does not
 * need a headless Chrome on the server rendering a second copy of a page that already exists. The
 * button carries `no-print` so it is not in the printout it produces.
 */
export function PrintReportButton() {
  return (
    <button type="button" className="btn btn-primary btn-sm no-print" onClick={() => window.print()}>
      <Printer />
      Print or save as PDF
    </button>
  );
}

/**
 * The recordings, twenty-five at a time.
 *
 * ## Why they are not all on the page
 *
 * Every player points at `/api/clients/[id]/recording`, which is an authenticated request through
 * our own proxy. `preload="none"` stops the browser fetching the *audio*, but the elements
 * themselves still mount, and a three-hundred-call month would put three hundred of them in the
 * document. So the page starts with twenty-five and adds twenty-five on request.
 *
 * ## The player is the existing one, untouched
 *
 * Same `<audio controls preload="none">` and the same link fallback as the verification page and
 * the dashboard table. Nothing here changes how a recording is fetched, proxied or stored -- the
 * instruction was to leave playback alone so it keeps working, and this is a third reader of the
 * same URL, not a second way of getting it.
 *
 * ## Printing
 *
 * A printed page cannot play anything, so the whole section is hidden from print by `no-print`.
 * What prints instead is the sentence above it, which says how many calls were recorded.
 */
export function ReportRecordingPlayers({ rows }: { rows: ReportRow[] }) {
  const [shown, setShown] = useState(Math.min(RECORDINGS_PER_BATCH, rows.length));
  const remaining = rows.length - shown;

  if (rows.length === 0) return null;

  return (
    <div className="no-print">
      <div className="grid gap-2.5">
        {rows.slice(0, shown).map((row) => (
          <div key={row.id} className="panel-tight flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[0.84rem]" style={{ color: "var(--text)", fontWeight: 600 }}>
                {row.caller}
              </div>
              <div className="muted text-[0.74rem]">
                <time dateTime={row.at}>{row.when}</time>
                {row.duration ? ` · ${row.duration}` : ""} · {row.labelName}
              </div>
            </div>
            <audio controls preload="none" src={row.recordingUrl} className="h-9 w-56 max-w-[240px]">
              <a href={row.recordingUrl} target="_blank" rel="noreferrer">
                Listen
              </a>
            </audio>
          </div>
        ))}
      </div>

      {remaining > 0 ? (
        <button
          type="button"
          className="btn btn-ghost btn-sm mt-3"
          onClick={() => setShown((current) => Math.min(current + RECORDINGS_PER_BATCH, rows.length))}
        >
          Show {Math.min(RECORDINGS_PER_BATCH, remaining)} more
          <span className="muted">
            {" "}
            · {remaining.toLocaleString("en-US")} left
          </span>
        </button>
      ) : null}
    </div>
  );
}
