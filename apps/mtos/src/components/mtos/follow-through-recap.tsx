"use client";

import { useCallback, useState } from "react";
import { Check, RefreshCw, Save, Trash2, X } from "lucide-react";

import { RecapRichEditor } from "@/src/components/mtos/recap-rich-editor";
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The recap could not be built.");
    } finally {
      setBusy("");
    }
  }

  /**
   * Save what is in the editor.
   *
   * `continueOn` is the difference between the two buttons, and the reason there are two: saving
   * used to navigate to the finish step, so there was no way to park a half-written email and come
   * back to it. An AM rewriting a recap section by section needs to be able to keep their work
   * without being moved off the page.
   */
  async function save(continueOn: boolean) {
    if (!state) return;
    setBusy(continueOn ? "save" : "keep");
    setError("");
    try {
      const data = await post({ action: "save_recap", recap: state });
      if (data?.recap) setState(data.recap);
      if (continueOn) {
        window.location.assign("?step=finish#finish");
        return;
      }
      // The stored HTML comes back sanitised, so the editor is left showing exactly what was kept
      // rather than the markup that went in.
      setMessage("Saved. You can keep editing.");
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
          The recap uses the call notes, supported performance results and verified completed work.
          Review the draft before approving it.
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

      <div className="flex flex-wrap items-center gap-2">
        {confirmRebuild ? (
          <>
            <span className="chip watch">This replaces what you have written.</span>
            <button type="button" className="btn btn-risk btn-sm" disabled={Boolean(busy)} onClick={() => void build()}>
              {busy === "build" ? "Regenerating…" : "Replace draft and regenerate"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmRebuild(false)}>
              Keep what I wrote
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={Boolean(busy) || Boolean(state.sentAt)}
            onClick={() => (state.edited ? setConfirmRebuild(true) : void build())}
          >
            <RefreshCw />
            {busy === "build" ? "Regenerating recap…" : "Regenerate recap email"}
          </button>
        )}
      </div>
      <p className="muted text-[0.78rem]">Regenerate from the latest saved call notes using the updated email structure, then review and approve the new draft.</p>

      <div className="field">
        <label className="field-label" htmlFor="recap-subject">
          Subject
        </label>
        <input
          id="recap-subject"
          className="input"
          value={state.subject}
          disabled={!editable}
          onChange={(event) => setState((previous) => (previous ? { ...previous, subject: event.target.value, edited: true } : previous))}
        />
      </div>

      <p className="muted text-[0.78rem]">Select text to change its formatting, or click anywhere in the email to edit. Your formatting is kept when you save.</p>
      <RecapRichEditor html={state.html} editable={editable} onChange={html => setState(previous => previous ? { ...previous, html, edited: true } : previous)} />

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
        <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void save(true)}>
          <Save />
          {busy === "save" ? "Saving…" : "Save recap and continue to finish"}
        </button>
        <button type="button" className="btn btn-ghost" disabled={Boolean(busy) || !editable} onClick={() => void save(false)}>
          {busy === "keep" ? "Saving…" : "Save and keep editing"}
        </button>
        <span className="muted text-[0.78rem]">It sends through your connected Gmail account from support@mapranking.com when you finish the follow-through.</span>
      </div>

      {error ? (
        <p role="alert" className="text-[0.82rem]" style={{ color: "var(--risk)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
