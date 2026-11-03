"use client";

import { useCallback, useRef, useState } from "react";
import { Check, RefreshCw, Save, Trash2, X } from "lucide-react";

import { readJsonResponse } from "@/src/lib/api/read-json-response";
import {
  recapBlockers,
  type RecapDecision,
  type RecapEmailState,
} from "@/src/lib/contracts/follow-through-recap-email";

/**
 * The recap email, editable as the client will see it.
 *
 * The body is a `contentEditable` holding the real email HTML, written in once by ref: rendering
 * it from state puts the caret back at the start of the document on every keystroke, which makes
 * the box unusable for anything longer than a sentence.
 *
 * Rebuilding from the notes sits behind a warning once the AM has edited, for the same reason
 * re-drafting the notes does -- what they wrote to a client is the part worth protecting.
 */

const TOOLBAR = [
  { command: "bold", label: "B", title: "Bold" },
  { command: "italic", label: "I", title: "Italic" },
  { command: "insertUnorderedList", label: "•", title: "Bulleted list" },
  { command: "removeFormat", label: "⌫", title: "Clear formatting" },
];

export function FollowThroughRecap({
  touchId,
  recap,
  gaps,
  note,
}: {
  touchId: string;
  recap?: RecapEmailState;
  gaps?: string[];
  note?: string;
}) {
  const [state, setState] = useState<RecapEmailState | undefined>(recap);
  const [buildGaps, setBuildGaps] = useState<string[]>(gaps || []);
  const [message, setMessage] = useState(note || "");
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const bodyRef = useRef<HTMLDivElement | null>(null);
  // Keyed on the html so a rebuild re-attaches a fresh node; otherwise the editor would keep
  // showing the old body because `dataset.loaded` is already set on it.
  // Read out of state before the callback closes over it: the React Compiler infers `state` as
  // the dependency when the body reaches into it, which would re-attach on every keystroke.
  const html = state?.html;
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      bodyRef.current = node;
      if (node && !node.dataset.loaded && html) {
        node.innerHTML = html;
        node.dataset.loaded = "1";
      }
    },
    [html],
  );

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await fetch(`/api/monthly-touches/${touchId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await readJsonResponse<{
        data?: { recap?: RecapEmailState; blockingGaps?: string[]; note?: string };
        error?: string;
      }>(response);
      if (!response.ok) throw new Error(result?.error || "That did not work.");
      return result?.data;
    },
    [touchId],
  );

  async function build() {
    setBusy("build");
    setError("");
    setConfirmRebuild(false);
    try {
      const data = await post({ action: "build_recap" });
      if (data?.recap) setState(data.recap);
      setBuildGaps(data?.blockingGaps || []);
      setMessage(data?.note || "");
      if (bodyRef.current) delete bodyRef.current.dataset.loaded;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The recap could not be built.");
    } finally {
      setBusy("");
    }
  }

  async function save() {
    if (!state) return;
    setBusy("save");
    setError("");
    try {
      const data = await post({ action: "save_recap", recap: state });
      if (data?.recap) setState(data.recap);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The recap was not saved.");
    } finally {
      setBusy("");
    }
  }

  if (!state) {
    return (
      <div className="grid gap-3">
        <p className="text-[0.86rem] leading-7" style={{ color: "var(--text-2)" }}>
          The recap is built from the notes and the tickets you approved — nothing else goes in it,
          because this email is the commitment.
        </p>
        <div>
          <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void build()}>
            <RefreshCw />
            {busy === "build" ? "Building…" : "Build the recap email"}
          </button>
        </div>
        {error ? (
          <p role="alert" className="text-[0.82rem]" style={{ color: "var(--risk)" }}>
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  const blockers = recapBlockers(state, buildGaps);
  const editable = state.decision !== "denied" && state.decision !== "deleted" && !state.sentAt;

  function decide(decision: RecapDecision) {
    setState((previous) => (previous ? { ...previous, decision } : previous));
  }

  return (
    <div className="grid gap-4">
      {message ? <div className="callout"><div className="callout-body">{message}</div></div> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={`chip ${state.sentAt ? "good" : state.decision === "approved" ? "good" : state.decision ? "muted" : "watch"}`}>
          {state.sentAt ? "Sent" : state.decision === "approved" ? "Approved" : state.decision === "denied" ? "Denied" : state.decision === "deleted" ? "Deleted" : "Undecided"}
        </span>
        <div className="seg" role="group" aria-label="Decision">
          <button type="button" className={`seg-btn ${state.decision === "approved" ? "on" : ""}`} onClick={() => decide("approved")}>
            <Check />
            Approve
          </button>
          <button type="button" className={`seg-btn ${state.decision === "denied" ? "on" : ""}`} onClick={() => decide("denied")}>
            <X />
            Deny
          </button>
          <button type="button" className={`seg-btn ${state.decision === "deleted" ? "on" : ""}`} onClick={() => decide("deleted")}>
            <Trash2 />
            Delete
          </button>
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="recap-subject">
          Subject
        </label>
        <input
          id="recap-subject"
          className="input"
          value={state.subject}
          disabled={!editable}
          onChange={(event) => setState((previous) => (previous ? { ...previous, subject: event.target.value } : previous))}
        />
      </div>

      {editable ? (
        <div className="flex flex-wrap gap-1">
          {TOOLBAR.map((button) => (
            <button
              key={button.command}
              type="button"
              className="icon-btn"
              title={button.title}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => document.execCommand(button.command)}
            >
              {button.label}
            </button>
          ))}
        </div>
      ) : null}

      <div
        ref={attach}
        contentEditable={editable}
        suppressContentEditableWarning
        onInput={() => {
          const node = bodyRef.current;
          if (node) {
            setState((previous) => (previous ? { ...previous, html: node.innerHTML, edited: true } : previous));
          }
        }}
        className="card"
        style={{ padding: 16, background: "#ffffff", maxHeight: 620, overflow: "auto" }}
      />

      {blockers.length ? (
        <div className="card">
          <div className="eyebrow muted">Before this can go out</div>
          <ul className="mt-2 grid gap-2">
            {blockers.map((line) => (
              <li key={line} className="text-[0.84rem]" style={{ color: "var(--text-2)" }}>
                · {line}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void save()}>
          <Save />
          {busy === "save" ? "Saving…" : "Save the recap"}
        </button>
        {confirmRebuild ? (
          <>
            <span className="chip watch">This replaces what you have written.</span>
            <button type="button" className="btn btn-risk btn-sm" disabled={Boolean(busy)} onClick={() => void build()}>
              {busy === "build" ? "Rebuilding…" : "Yes, rebuild from the notes"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmRebuild(false)}>
              Keep what I wrote
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={Boolean(busy)}
            onClick={() => (state.edited ? setConfirmRebuild(true) : void build())}
          >
            <RefreshCw />
            Rebuild from notes
          </button>
        )}
        <span className="muted text-[0.78rem]">It sends through your Intercom when you finish the follow-through.</span>
      </div>

      {error ? (
        <p role="alert" className="text-[0.82rem]" style={{ color: "var(--risk)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
