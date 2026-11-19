"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { readJsonResponse } from "@/src/lib/api/read-json-response";
import {
  GOAL_STATUSES,
  actionLineIssues,
  hasMeetingNotes,
  notesBlockers,
  renderNotesMarkdown,
  summaryBudget,
  type ClientAction,
  type GoalStatus,
  type NotesDraft,
} from "@/src/lib/contracts/follow-through-notes";

/**
 * Edit the summary once; task details are reviewed in the ticket forms below.
 *
 * The one exception is the three things `finishBlockers` will not let past without them, which no
 * other screen can supply:
 *
 *   - every client action needs a decision, because each one is a commitment in the recap email;
 *   - an action line needs a what, a team and a date, and the draft prompt deliberately leaves the
 *     date blank when the call did not establish one;
 *   - a pending item needs what is missing, who it is coming from and when to chase.
 *
 * Only the rows that are actually blocking are shown, so this stays a short list that empties
 * itself rather than the full eight-section editor this screen used to be. A ticket's own due date
 * is edited on the ticket; the date here is the promise the notes record, which is a different
 * fact and is why fixing one does not fix the other.
 */

/** One drafted value, as it reads before anybody has touched it. */
function Read({ label, value }: { label: string; value: string }) {
  const written = value.trim();
  return <div className="field">
    <span className="field-label">{label}</span>
    <p className="text-sm" style={{ whiteSpace: "pre-wrap", color: written ? "var(--text)" : "var(--text-2)" }}>{written || "Nothing written yet"}</p>
  </div>;
}

/** Approve, deny or delete, in the shape the tickets step uses for the same decision. */
function Decide({ label, decision, onDecide }: {
  label: string; decision?: ClientAction["decision"]; onDecide: (next: NonNullable<ClientAction["decision"]>) => void;
}) {
  return <div className="seg" role="group" aria-label={label}>
    {(["approved", "denied", "deleted"] as const).map(value => <button key={value} type="button"
      className={`seg-btn ${decision === value ? "on" : ""}`} onClick={() => onDecide(value)}>
      {value === "approved" ? "Approve" : value === "denied" ? "Deny" : "Delete"}
    </button>)}
  </div>;
}

export function FollowThroughNotes({ touchId, notes, draftNote, autoPrepare = false }: {
  touchId: string; notes?: NotesDraft; draftNote?: string; autoPrepare?: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(notes);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState(draftNote || "");
  const [preview, setPreview] = useState(false);
  const [confirmRedraft, setConfirmRedraft] = useState(false);
  // A drafted document opens as something to read. Editing is a decision the AM makes, not the
  // state they are dropped into, so nothing here can be changed by a stray keystroke on arrival.
  const [editing, setEditing] = useState(false);
  const budget = summaryBudget(draft?.summary || "");
  const post = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch(`/api/monthly-touches/${touchId}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const result = await readJsonResponse<{ data?: { notes?: NotesDraft; note?: string }; error?: string }>(response);
    if (!response.ok) throw new Error(result?.error || "The notes could not be updated.");
    return result?.data || {};
  }, [touchId]);
  useEffect(() => {
    if (!autoPrepare) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setBusy("draft");
      void post({ action: "prepare_follow_through" }).then(data => {
        if (!active) return;
        if (data.notes) setDraft(current => hasMeetingNotes(current) ? current : data.notes);
        setNote(data.note || "");
        router.refresh();
      }).catch(caught => {
        if (active) setError(caught instanceof Error ? caught.message : "The notes could not be prepared.");
      }).finally(() => { if (active) setBusy(""); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [autoPrepare, post, router]);
  function edit(change: Partial<NotesDraft>) { setDraft(current => current ? { ...current, ...change } : current); }
  /** Edits are keyed on the row's id, because the lists are filtered before they are rendered. */
  function editClientAction(id: string, change: Partial<ClientAction>) {
    setDraft(current => current ? { ...current, clientActions: current.clientActions.map(item => item.id === id ? { ...item, ...change } : item) } : current);
  }
  function editPendingItem(id: string, change: Partial<NotesDraft["pending"][number]>) {
    setDraft(current => current ? { ...current, pending: current.pending.map(item => item.id === id ? { ...item, ...change } : item) } : current);
  }
  function editAction(id: string, change: Partial<NotesDraft["departments"][number]["actions"][number]>) {
    setDraft(current => current ? {
      ...current,
      departments: current.departments.map(group => ({
        ...group, actions: group.actions.map(action => action.id === id ? { ...action, ...change } : action),
      })),
    } : current);
  }
  async function generate(manual = false) {
    setBusy("draft"); setError(""); setConfirmRedraft(false);
    try {
      const data = await post(manual ? { action: "draft_notes", manual: true } : { action: draft ? "draft_notes" : "prepare_follow_through" });
      if (data.notes) setDraft(data.notes);
      setNote(data.note || "");
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The notes could not be drafted."); }
    finally { setBusy(""); }
  }
  async function save() {
    if (!draft) return;
    setBusy("save"); setError("");
    try {
      await post({ action: "save_notes", notes: draft });
      await post({ action: "prepare_follow_through" });
      // Back to reading: a save is the end of an edit, not the middle of one.
      setNote("Notes saved."); setEditing(false); router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The notes were not saved."); }
    finally { setBusy(""); }
  }
  // What step 6 will refuse, listed here while the fields for it are still on screen.
  const undecided = (draft?.clientActions || []).filter(item => !item.decision).length;
  const changed = JSON.stringify(draft ?? null) !== JSON.stringify(notes ?? null);
  const blockers = draft ? notesBlockers(draft) : [];
  const brokenActions = (draft?.departments || []).flatMap(group =>
    group.actions.filter(action => actionLineIssues(action).length).map(action => ({ department: group.department, action })));
  const brokenPending = (draft?.pending || []).filter(item => !item.missing.trim() || !item.from.trim() || !item.reminderDate.trim());
  return <div className="grid gap-4">
    {error ? <p role="alert" style={{ color: "var(--risk)" }}>{error}</p> : null}
    {note ? <p role="status" className="muted text-sm">{note}</p> : null}
    {!draft ? <div className="flex flex-wrap gap-2"><button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void generate()}>{busy ? "Preparing notes…" : "Draft notes from the call"}</button><button type="button" className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => void generate(true)}>Write notes manually</button></div> : <>
      {editing ? <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save notes"}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreview(value => !value)}>{preview ? "Hide preview" : "Preview final notes"}</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => setConfirmRedraft(true)}>Re-draft from the call</button>
        <button type="button" className="ilink text-sm" disabled={Boolean(busy)} onClick={() => { if (changed) setDraft(notes); setEditing(false); }}>{changed ? "Discard changes" : "Stop editing"}</button>
      </div> : <div className="flex flex-wrap items-center gap-3">
        <span className="chip muted">Rough draft</span>
        <button type="button" className="ilink text-sm" onClick={() => setEditing(true)}>Edit these notes</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreview(value => !value)}>{preview ? "Hide preview" : "Preview final notes"}</button>
      </div>}
      {!editing ? <>
        <p className="muted text-sm">The draft as it stands, for reading. Nothing is filed until step 6, and nothing here changes until you open it for editing.</p>
        <section className="card grid gap-3">
          <div className="card-title">Meeting details</div>
          <Read label="Title" value={draft.title} />
          <div className="grid gap-3 md:grid-cols-2">
            <Read label="Quarter" value={draft.goalQuarter} />
            <Read label="Goal status" value={draft.goalStatus} />
          </div>
          <Read label="Client goal" value={draft.goalText} />
          <Read label="Goal evidence" value={draft.goalEvidence} />
        </section>
        <section className="card grid gap-2">
          <Read label="Meeting summary" value={draft.summary} />
        </section>
        {draft.clientActions.length ? <section className="card grid gap-2">
          <div className="card-head">
            <div className="card-title">What the client agreed to do</div>
            <span className={`chip ${undecided ? "watch" : "good"}`}>{undecided ? `${undecided} still to decide` : "all decided"}</span>
          </div>
          <ul className="grid gap-2">{draft.clientActions.map(item => <li key={item.id} className="text-sm" style={{ color: "var(--text-2)" }}>
            · {item.what.trim() || "Nothing written yet"}{item.due.trim() ? ` — by ${item.due.trim()}` : ""} <span className={`chip ${item.decision ? "good" : "watch"}`}>{item.decision || "no decision yet"}</span>
          </li>)}</ul>
        </section> : null}
        {brokenActions.length ? <section className="card grid gap-2">
          <div className="card-head">
            <div className="card-title">Action lines that cannot be filed yet</div>
            <span className="chip watch">{brokenActions.length === 1 ? "1 to finish" : `${brokenActions.length} to finish`}</span>
          </div>
          <ul className="grid gap-2">{brokenActions.map(({ department, action }) => <li key={action.id} className="text-sm" style={{ color: "var(--text-2)" }}>
            · {department}: {action.what.trim() || "an unnamed action"} — {actionLineIssues(action).join(" ")}
          </li>)}</ul>
        </section> : null}
        {brokenPending.length ? <section className="card grid gap-2">
          <div className="card-head">
            <div className="card-title">Pending items waiting on information</div>
            <span className="chip watch">{brokenPending.length === 1 ? "1 to finish" : `${brokenPending.length} to finish`}</span>
          </div>
          <ul className="grid gap-2">{brokenPending.map(item => <li key={item.id} className="text-sm" style={{ color: "var(--text-2)" }}>
            · {item.missing.trim() || "Something unnamed"} — {item.from.trim() ? `from ${item.from.trim()}` : "no source"}, {item.reminderDate.trim() ? `chase on ${item.reminderDate.trim()}` : "no chase date"}
          </li>)}</ul>
        </section> : null}
      </> : null}
      {editing ? <>
      {confirmRedraft ? <div role="alert" className="card flex flex-wrap items-center gap-2">
        <span>This replaces your current notes. Keep any edits you need before continuing.</span>
        <button type="button" className="btn btn-risk btn-sm" disabled={Boolean(busy)} onClick={() => void generate()}>Replace notes</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmRedraft(false)}>Cancel</button>
      </div> : null}
      <section className="card grid gap-3">
        <div className="card-title">Meeting details</div>
        <label className="field">Title<input className="input" value={draft.title} onChange={event => edit({ title: event.target.value })} /></label>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="field">Quarter<input className="input" value={draft.goalQuarter} onChange={event => edit({ goalQuarter: event.target.value })} /></label>
          <label className="field">Goal status<select className="input" value={draft.goalStatus} onChange={event => edit({ goalStatus: event.target.value as GoalStatus })}>{GOAL_STATUSES.map(status => <option key={status}>{status}</option>)}</select></label>
        </div>
        <label className="field">Client goal<textarea className="textarea" rows={2} value={draft.goalText} onChange={event => edit({ goalText: event.target.value })} /></label>
        <label className="field">Goal evidence<textarea className="textarea" rows={2} value={draft.goalEvidence} onChange={event => edit({ goalEvidence: event.target.value })} /></label>
      </section>
      <section className="card">
        <div className="card-head"><div className="card-title">Meeting summary</div><span className={`chip ${budget.over ? "watch" : "muted"}`}>{budget.count} of {budget.max} sentences</span></div>
        <textarea aria-label="Meeting summary" className="textarea" rows={5} value={draft.summary} onChange={event => edit({ summary: event.target.value })} />
        {budget.over ? <p className="field-hint">Keep the summary concise. Supporting details remain in the final notes.</p> : null}
      </section>
      {draft.clientActions.length ? <section className="card grid gap-3">
        <div className="card-head">
          <div className="card-title">What the client agreed to do</div>
          <span className={`chip ${undecided ? "watch" : "good"}`}>{undecided ? `${undecided} still to decide` : "all decided"}</span>
        </div>
        <p className="muted text-sm">Each of these reaches the client in the recap email, so each one is a decision rather than a line of prose. Deny keeps it in the notes as something that was considered; delete says it was never really theirs to do.</p>
        {draft.clientActions.map((item, index) => <div key={item.id} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_12rem] md:items-end">
          <label className="field">What they will do<input className="input" aria-label={`Client action ${index + 1}`} value={item.what} onChange={event => editClientAction(item.id, { what: event.target.value })} /></label>
          <label className="field">By when<input className="input" aria-label={`Client action ${index + 1} due`} value={item.due} placeholder="YYYY-MM-DD, or what was said" onChange={event => editClientAction(item.id, { due: event.target.value })} /></label>
          <div className="md:col-span-2"><Decide label={`Client action ${index + 1} decision`} {...(item.decision ? { decision: item.decision } : {})} onDecide={next => editClientAction(item.id, { decision: next })} /></div>
        </div>)}
      </section> : null}
      {brokenActions.length ? <section className="card grid gap-3">
        <div className="card-head">
          <div className="card-title">Action lines that cannot be filed yet</div>
          <span className="chip watch">{brokenActions.length === 1 ? "1 to finish" : `${brokenActions.length} to finish`}</span>
        </div>
        <p className="muted text-sm">A date is missing whenever the call did not establish one, and the draft leaves it blank rather than inventing it. This is the promise the notes record — the ticket&rsquo;s own due date is set on the ticket.</p>
        {brokenActions.map(({ department, action }, index) => <div key={action.id} className="grid gap-2">
          <div className="eyebrow muted">{department}</div>
          <label className="field">What we will do<textarea className="textarea" rows={2} aria-label={`Action ${index + 1}`} value={action.what} onChange={event => editAction(action.id, { what: event.target.value })} /></label>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="field">Team<input className="input" aria-label={`Action ${index + 1} team`} value={action.team} onChange={event => editAction(action.id, { team: event.target.value })} /></label>
            <label className="field">By when<input className="input" aria-label={`Action ${index + 1} due`} value={action.due} placeholder="YYYY-MM-DD, or what was promised" onChange={event => editAction(action.id, { due: event.target.value })} /></label>
          </div>
          <ul className="grid gap-1">{actionLineIssues(action).map(issue => <li key={issue} className="field-hint">{issue}</li>)}</ul>
        </div>)}
      </section> : null}
      {brokenPending.length ? <section className="card grid gap-3">
        <div className="card-head">
          <div className="card-title">Pending items waiting on information</div>
          <span className="chip watch">{brokenPending.length === 1 ? "1 to finish" : `${brokenPending.length} to finish`}</span>
        </div>
        <p className="muted text-sm">Each of these becomes a ticket nobody should start until the information arrives, so it needs a date to chase and a person to chase.</p>
        {brokenPending.map((item, index) => <div key={item.id} className="grid gap-2">
          <label className="field">What is missing<input className="input" aria-label={`Pending ${index + 1} missing`} value={item.missing} onChange={event => editPendingItem(item.id, { missing: event.target.value })} /></label>
          <div className="grid gap-2 md:grid-cols-3">
            <label className="field">Coming from<input className="input" aria-label={`Pending ${index + 1} from`} value={item.from} onChange={event => editPendingItem(item.id, { from: event.target.value })} /></label>
            <label className="field">Chase on<input className="input" aria-label={`Pending ${index + 1} reminder`} value={item.reminderDate} placeholder="YYYY-MM-DD" onChange={event => editPendingItem(item.id, { reminderDate: event.target.value })} /></label>
            <label className="field">Waiting on<select className="input" aria-label={`Pending ${index + 1} waiting on`} value={item.waitingOn} onChange={event => editPendingItem(item.id, { waitingOn: event.target.value as NotesDraft["pending"][number]["waitingOn"] })}><option>Client</option><option>AM review</option></select></label>
          </div>
        </div>)}
      </section> : null}
      </> : null}
      {blockers.length || undecided ? <section className="card">
        <div className="eyebrow muted">Before the follow-through can be finished</div>
        <ul className="mt-2 grid gap-2">
          {blockers.map(line => <li key={line} className="text-sm" style={{ color: "var(--text-2)" }}>· {line}</li>)}
          {undecided ? <li className="text-sm" style={{ color: "var(--text-2)" }}>· Decide the remaining {undecided === 1 ? "client action" : `${undecided} client actions`} above.</li> : null}
        </ul>
      </section> : null}
      {preview ? <pre className="card text-sm" style={{ whiteSpace: "pre-wrap" }}>{renderNotesMarkdown(draft)}</pre> : null}
    </>}
  </div>;
}
