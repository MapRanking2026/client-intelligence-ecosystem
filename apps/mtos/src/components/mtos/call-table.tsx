"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, MessageSquareText, RotateCcw, X } from "lucide-react";

import { CALL_LABELS, CALL_LABEL_LABEL, type CallLabel } from "@/src/lib/contracts/call-labels";
import type { CallDashboardTable, CallTableRow } from "@/src/lib/contracts/call-dashboard";

/**
 * The calls table: the evidence under every figure above it.
 *
 * A client component because three things here need the browser -- changing a label, reading the
 * topic in a modal, and playing a recording. Everything it *shows* was decided on the server by
 * `contracts/call-dashboard.ts`, so this file does no counting and no filtering: it renders rows
 * and posts changes.
 *
 * ## Playback is the existing player, unchanged
 *
 * `<audio controls preload="none">` pointing at the same proxied URL the lead & call verification
 * page uses, with the same link fallback. `preload="none"` matters: without it a browser fetches
 * every recording on the page as soon as the table renders, which on a 340-call month is hundreds
 * of authenticated requests nobody asked for. The owner's instruction was to leave recordings
 * alone so playback keeps working, so nothing here touches how they are fetched or stored.
 *
 * ## A label change re-reads the page rather than patching the row
 *
 * `router.refresh()` after the POST, instead of editing local state. The label feeds the tiles,
 * the donut, the columns and every comparison above, so patching one row would leave the row
 * disagreeing with six panels until the next navigation -- and a dashboard that contradicts itself
 * is worse than one that takes a moment to catch up.
 */
export function CallTable({
  clientId,
  table,
  totalInPeriod,
}: {
  clientId: string;
  table: CallDashboardTable;
  /** How many calls the period holds before the table's own limit, so the footer can say. */
  totalInPeriod: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [topic, setTopic] = useState<CallTableRow | undefined>();

  function setTab(key: "all" | CallLabel) {
    const next = new URLSearchParams(params.toString());
    next.set("client", clientId);
    if (key === "all") next.delete("label");
    else next.set("label", key);
    router.push(`${pathname}?${next.toString()}`);
  }

  function clearFilters() {
    const next = new URLSearchParams();
    next.set("client", clientId);
    // The period and the comparison are not filters -- they are what the reader chose to look at,
    // so "Clear filters" keeps them and drops only what is hiding rows.
    const period = params.get("period");
    const compare = params.get("compare");
    if (period) next.set("period", period);
    if (compare) next.set("compare", compare);
    router.push(`${pathname}?${next.toString()}`);
  }

  async function post(id: string, label: CallLabel | null) {
    setBusy(id);
    setError(undefined);
    try {
      const response = await fetch(`/api/clients/${clientId}/lead-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_label", labels: { [id]: { label } } }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "The label could not be saved.");
      }
      router.refresh();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The label could not be saved.");
    } finally {
      setBusy(undefined);
    }
  }

  const tabs = useMemo(() => table.tabs, [table.tabs]);

  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">
          <MessageSquareText />
          Every call
        </div>
        {table.rows.length ? (
          <span className="muted text-[0.76rem]">
            {table.rows.length === totalInPeriod
              ? `${table.rows.length.toLocaleString("en-US")} calls`
              : `${table.rows.length.toLocaleString("en-US")} of ${totalInPeriod.toLocaleString("en-US")}`}
          </span>
        ) : null}
      </div>

      <div className="segtabs mb-3">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`segtab${tab.active ? " active" : ""}`}
            onClick={() => setTab(tab.key)}
          >
            {tab.tone ? (
              <span className="sig-dot mr-1.5" style={{ background: tab.tone, opacity: tab.count ? 1 : 0.4 }} />
            ) : null}
            {tab.label}
            <span className="muted ml-1.5">{tab.count.toLocaleString("en-US")}</span>
          </button>
        ))}
      </div>

      {error ? (
        <div className="insight risk mb-3" style={{ gridTemplateColumns: "1fr" }}>
          <p className="text-[0.84rem]" style={{ color: "var(--text-2)" }}>
            {error}
          </p>
        </div>
      ) : null}

      {/*
        Four different kinds of nothing, four different sentences. The server decided which, because
        "we never pulled this client" and "the phone did not ring" are facts about different things
        and only one of them is about the client.
      */}
      {table.state !== "rows" ? (
        <div className="insight info" style={{ gridTemplateColumns: "1fr" }}>
          <div>
            <div className="h4">{table.emptyTitle}</div>
            <p className="muted mt-1.5 text-[0.85rem]">{table.emptyBody}</p>
            {table.clearable ? (
              <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={clearFilters}>
                <X />
                Clear filters
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>When</th>
                <th>Caller</th>
                <th>Line called</th>
                <th>Length</th>
                <th>Label</th>
                <th>What it was about</th>
                <th>Decided by</th>
                <th>Listen</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <time dateTime={row.at}>{row.when}</time>
                  </td>
                  <td>
                    <span style={{ color: "var(--text)", fontWeight: 600 }}>
                      {row.callerName || row.callerPhone || "Not recorded"}
                    </span>
                    {row.callerName && row.callerPhone ? (
                      <div className="muted text-[0.74rem]">{row.callerPhone}</div>
                    ) : null}
                    {row.callsFromThisCaller > 1 ? (
                      <div className="muted text-[0.72rem]">
                        called {row.callsFromThisCaller} times this period
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {/* An em dash, never "Unknown line" -- that would read like a line that exists. */}
                    {row.calledNumber ? (
                      <>
                        <span>{row.calledNumberName || row.calledNumber}</span>
                        {row.calledNumberName ? (
                          <div className="muted text-[0.74rem]">{row.calledNumber}</div>
                        ) : null}
                      </>
                    ) : (
                      <span className="muted" title="This pull did not capture which line the call came in on. Only a fresh refresh does.">
                        —
                      </span>
                    )}
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                    {row.duration || <span className="muted">—</span>}
                  </td>
                  <td>
                    <select
                      className="input"
                      style={{ padding: "5px 9px", fontSize: "0.78rem", minWidth: 118 }}
                      value={row.label}
                      disabled={busy === row.id}
                      onChange={(event) => post(row.id, event.target.value as CallLabel)}
                      aria-label={`Label for the call at ${row.when}`}
                    >
                      {CALL_LABELS.map((label) => (
                        <option key={label} value={label}>
                          {CALL_LABEL_LABEL[label]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {row.topic ? (
                      <button
                        type="button"
                        className="chip"
                        onClick={() => setTopic(row)}
                        style={{ cursor: "pointer" }}
                      >
                        {row.topic}
                      </button>
                    ) : (
                      <span className="muted" title="Nothing has been written about this call yet.">
                        —
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="muted text-[0.76rem]" title={row.reason}>
                      {row.sourceName}
                    </span>
                    {row.overridden ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm mt-1"
                        style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                        disabled={busy === row.id}
                        onClick={() => post(row.id, null)}
                        title="Go back to whatever the rules say today, rather than freezing today's answer."
                      >
                        {busy === row.id ? (
                          <Loader2 className="animate-spin" style={{ width: 12, height: 12 }} />
                        ) : (
                          <RotateCcw style={{ width: 12, height: 12 }} />
                        )}
                        Reset
                      </button>
                    ) : null}
                  </td>
                  <td>
                    {row.recordingUrl ? (
                      // preload="none" so a recording is only fetched when somebody hits play,
                      // not once per row on load. Same player as the verification page.
                      <audio
                        controls
                        preload="none"
                        src={row.recordingUrl}
                        className="h-9 w-48 max-w-[200px]"
                      >
                        <a href={row.recordingUrl} target="_blank" rel="noreferrer">
                          Listen
                        </a>
                      </audio>
                    ) : (
                      <span className="muted text-[0.76rem]">No recording</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {topic ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="What the call was about"
          onClick={() => setTopic(undefined)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(16,24,40,0.45)",
            display: "grid",
            placeItems: "center",
            padding: 20,
            zIndex: 60,
          }}
        >
          <div
            className="card"
            onClick={(event) => event.stopPropagation()}
            style={{ maxWidth: 520, width: "100%" }}
          >
            <div className="card-head">
              <div className="card-title">
                <MessageSquareText />
                {topic.topic}
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTopic(undefined)}>
                <X />
              </button>
            </div>
            <p className="text-[0.88rem]" style={{ color: "var(--text-2)" }}>
              {topic.topicSummary || "No summary was written for this call, only the topic."}
            </p>
            <div className="muted mt-3 text-[0.76rem]">
              {topic.when}
              {topic.callerName ? ` · ${topic.callerName}` : ""} · labelled {topic.labelName} by{" "}
              {topic.sourceName.toLowerCase()}
            </div>
            {topic.reason ? (
              <p className="muted mt-2 text-[0.78rem]">{topic.reason}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
