"use client";

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, Check, Eye, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";

import { readJsonResponse } from "@/src/lib/api/read-json-response";
import {
  GOAL_STATUSES,
  NO_AM_CONTEXT,
  SUMMARY_BULLETS,
  actionLineIssues,
  notesBlockers,
  renderNotesMarkdown,
  summaryBudget,
  summaryNumbering,
  type ActionLine,
  type ClientAction,
  type DepartmentNotes,
  type GoalStatus,
  type NotesDraft,
  type PendingItem,
} from "@/src/lib/contracts/follow-through-notes";

/**
 * The notes editor: eight numbered sections, every one of them editable.
 *
 * The numbering on screen is the numbering in the filed document, including the way section 2
 * splits into 2A and 2B the moment the AM adds their own context -- so what they are reading
 * here is what the next AM will read in the Client's Book, headings and all.
 *
 * Re-drafting is deliberately awkward. It is a second click behind a warning, because the AM's
 * own sentences are the only part of these notes a model cannot write, and the one-click version
 * of this button would eventually throw someone's twenty minutes of writing away.
 */

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

function ActionRow({
  action,
  onChange,
  onRemove,
}: {
  action: ActionLine;
  onChange: (next: ActionLine) => void;
  onRemove: () => void;
}) {
  const issues = actionLineIssues(action);
  return (
    <li className="card" style={{ padding: "12px 14px" }}>
      <div className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_auto]">
        <input
          className="input"
          value={action.what}
          placeholder="What we will do"
          onChange={(event) => onChange({ ...action, what: event.target.value })}
        />
        <input
          className="input"
          value={action.team}
          placeholder="Team"
          onChange={(event) => onChange({ ...action, team: event.target.value })}
        />
        <input
          className="input"
          value={action.due}
          placeholder="Due"
          onChange={(event) => onChange({ ...action, due: event.target.value })}
        />
        <button type="button" className="icon-btn" aria-label="Remove this action" onClick={onRemove}>
          <Trash2 />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[0.8rem]" style={{ color: "var(--text-2)" }}>
          <input
            type="checkbox"
            checked={Boolean(action.carryOver)}
            onChange={(event) => onChange({ ...action, carryOver: event.target.checked })}
          />
          Carry-over
        </label>
        <input
          className="input"
          style={{ maxWidth: 200 }}
          value={action.crossDepartment || ""}
          placeholder="Also touches (optional)"
          onChange={(event) => onChange({ ...action, crossDepartment: event.target.value })}
        />
        <input
          className="input"
          style={{ maxWidth: 220 }}
          value={action.dependsOn || ""}
          placeholder="After (a real dependency only)"
          onChange={(event) => onChange({ ...action, dependsOn: event.target.value })}
        />
      </div>
      {issues.length ? (
        <p className="mt-2 text-[0.78rem]" style={{ color: "var(--watch)" }}>
          {issues.join(" ")}
        </p>
      ) : null}
    </li>
  );
}

export function FollowThroughNotes({
  touchId,
  notes,
  draftNote,
}: {
  touchId: string;
  /** Absent until the AM asks MTOS to read the call -- the first draft is a model pass. */
  notes?: NotesDraft;
  draftNote?: string;
}) {
  const [draft, setDraft] = useState<NotesDraft | undefined>(notes);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState(draftNote || "");
  const [confirmRedraft, setConfirmRedraft] = useState(false);
  const [preview, setPreview] = useState(false);

  const budget = summaryBudget(draft?.summary || "");
  const numbering = summaryNumbering(draft?.amContext !== undefined);
  const blockers = useMemo(() => (draft ? notesBlockers(draft) : []), [draft]);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await fetch(`/api/monthly-touches/${touchId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await readJsonResponse<{
        data?: { notes?: NotesDraft; note?: string };
        error?: string;
      }>(response);
      if (!response.ok) throw new Error(result?.error || "That did not work.");
      return result?.data;
    },
    [touchId],
  );

  async function save() {
    if (!draft) return;
    setBusy("save");
    setError("");
    try {
      await post({ action: "save_notes", notes: draft });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The notes were not saved.");
    } finally {
      setBusy("");
    }
  }

  async function redraft() {
    setBusy("draft");
    setError("");
    setConfirmRedraft(false);
    try {
      const data = await post({ action: "draft_notes" });
      if (data?.notes) setDraft(data.notes);
      setNote(data?.note || "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The notes could not be drafted.");
    } finally {
      setBusy("");
    }
  }

  function setDepartment(index: number, next: DepartmentNotes) {
    setDraft((previous) =>
      previous
        ? {
            ...previous,
            departments: previous.departments.map((entry, position) =>
              position === index ? next : entry,
            ),
          }
        : previous,
    );
  }

  // Every editor below runs on a loaded draft, so the state updates narrow through this rather
  // than repeating the same guard in forty places.
  function edit(change: (previous: NotesDraft) => NotesDraft) {
    setDraft((previous) => (previous ? change(previous) : previous));
  }

  if (!draft) {
    return (
      <div className="grid gap-3">
        <p className="text-[0.86rem] leading-7" style={{ color: "var(--text-2)" }}>
          MTOS has not read the call for the notes yet. Drafting is a pass over the whole
          transcript, so it is a button rather than something this page does on its own.
        </p>
        <div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={Boolean(busy)}
            onClick={() => void redraft()}
          >
            <RefreshCw />
            {busy === "draft" ? "Reading the call…" : "Draft the notes from the call"}
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

  return (
    <div className="grid gap-5">
      {note ? (
        <div className="callout">
          <span className="callout-ic">
            <AlertTriangle />
          </span>
          <div>
            <div className="callout-title">About this draft</div>
            <div className="callout-body">{note}</div>
          </div>
        </div>
      ) : null}

      {/* 1 */}
      <section className="card">
        <div className="card-head">
          <div className="card-title">1 · Meeting identification</div>
        </div>
        <p className="mono text-[0.8rem]" style={{ color: "var(--text-2)" }}>
          {draft.title}
        </p>
        <div className="mt-3 grid gap-3">
          <Field label="NPS / Account Health">
            <p className="text-[0.88rem]" style={{ color: "var(--text)" }}>
              <strong>{draft.nps === null ? "No score recorded" : `${draft.nps}/10`}</strong>
              <span className="muted"> — confirmed on the screen above</span>
            </p>
          </Field>
          <Field label="Why this score">
            <textarea
              className="textarea"
              rows={2}
              value={draft.npsJustification}
              onChange={(event) => edit((p) => ({ ...p, npsJustification: event.target.value }))}
            />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={`Quarterly goal${draft.goalQuarter ? ` (${draft.goalQuarter})` : ""}`}>
              <input
                className="input"
                value={draft.goalText}
                placeholder="The goal as the client states it"
                onChange={(event) => edit((p) => ({ ...p, goalText: event.target.value }))}
              />
            </Field>
            <Field label="Status">
              <select
                className="input"
                value={draft.goalStatus}
                onChange={(event) =>
                  edit((p) => ({ ...p, goalStatus: event.target.value as GoalStatus }))
                }
              >
                {GOAL_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Evidence" hint="What on the call puts the goal where you say it is.">
            <textarea
              className="textarea"
              rows={2}
              value={draft.goalEvidence}
              onChange={(event) => edit((p) => ({ ...p, goalEvidence: event.target.value }))}
            />
          </Field>
        </div>
      </section>

      {/* 2 / 2A / 2B */}
      <section className="card">
        <div className="card-head">
          <div className="card-title">{numbering.summary} · Meeting summary</div>
          <span className={`chip ${budget.over ? "watch" : "muted"}`}>
            {budget.count} of {budget.max} sentences
          </span>
        </div>
        <textarea
          className="textarea"
          rows={4}
          value={draft.summary}
          placeholder="Four sentences at most. What happened, and what it means for the account."
          onChange={(event) => edit((p) => ({ ...p, summary: event.target.value }))}
        />
        {budget.over ? (
          <p className="mt-1 text-[0.78rem]" style={{ color: "var(--watch)" }}>
            Over four sentences. Not a blocker — but this is the part people read in a hurry.
          </p>
        ) : null}

        <div className="mt-3 grid gap-2">
          {SUMMARY_BULLETS.map((bullet) => (
            <div key={bullet.key} className="grid gap-2 md:grid-cols-[160px_1fr] md:items-center">
              <span className="text-[0.82rem] font-semibold" style={{ color: "var(--text-2)" }}>
                {bullet.label}
              </span>
              <input
                className="input"
                value={draft.bullets[bullet.key] || ""}
                onChange={(event) =>
                  edit((p) => ({ ...p, bullets: { ...p.bullets, [bullet.key]: event.target.value } }))
                }
              />
            </div>
          ))}
        </div>

        {draft.amContext === undefined ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm mt-3"
            onClick={() => edit((p) => ({ ...p, amContext: "" }))}
          >
            <Plus />
            Add additional AM context
          </button>
        ) : (
          <div className="mt-4">
            <div className="card-head">
              <div className="card-title">{numbering.context} · Additional AM context</div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  edit((p) => {
                    const { amContext: _dropped, ...rest } = p;
                    void _dropped;
                    return rest;
                  })
                }
              >
                Remove
              </button>
            </div>
            <textarea
              className="textarea"
              rows={3}
              value={draft.amContext}
              placeholder="What the transcript does not show. Left empty, the notes will say “None provided.”"
              onChange={(event) => edit((p) => ({ ...p, amContext: event.target.value }))}
            />
            {!draft.amContext.trim() ? (
              <span className="field-hint">The notes will read “{NO_AM_CONTEXT}”</span>
            ) : null}
          </div>
        )}
      </section>

      {/* 3 */}
      <section className="card">
        <div className="card-head">
          <div className="card-title">3 · Action items by department</div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              edit((p) => ({
                ...p,
                departments: [...p.departments, { department: "", clientFeedback: "", actions: [] }],
              }))
            }
          >
            <Plus />
            Add a department
          </button>
        </div>
        {!draft.departments.length ? (
          <p className="muted text-[0.84rem]">No department actions came out of this call.</p>
        ) : null}
        <div className="grid gap-4">
          {draft.departments.map((department, index) => (
            <div key={`${department.department}-${index}`} className="grid gap-2">
              <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                <input
                  className="input"
                  value={department.department}
                  placeholder="Department"
                  onChange={(event) => setDepartment(index, { ...department, department: event.target.value })}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Remove this department"
                  onClick={() =>
                    edit((p) => ({
                      ...p,
                      departments: p.departments.filter((_, position) => position !== index),
                    }))
                  }
                >
                  <Trash2 />
                </button>
              </div>
              <Field label="Client feedback">
                <textarea
                  className="textarea"
                  rows={2}
                  value={department.clientFeedback}
                  onChange={(event) =>
                    setDepartment(index, { ...department, clientFeedback: event.target.value })
                  }
                />
              </Field>
              <ul className="grid gap-2">
                {department.actions.map((action, actionIndex) => (
                  <ActionRow
                    key={action.id}
                    action={action}
                    onChange={(next) =>
                      setDepartment(index, {
                        ...department,
                        actions: department.actions.map((entry, position) =>
                          position === actionIndex ? next : entry,
                        ),
                      })
                    }
                    onRemove={() =>
                      setDepartment(index, {
                        ...department,
                        actions: department.actions.filter((_, position) => position !== actionIndex),
                      })
                    }
                  />
                ))}
              </ul>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  setDepartment(index, {
                    ...department,
                    actions: [
                      ...department.actions,
                      {
                        id: `d${index + 1}-${department.actions.length + 1}-${Date.now()}`,
                        what: "",
                        team: department.department,
                        due: "",
                      },
                    ],
                  })
                }
              >
                <Plus />
                Add an action
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* 4 */}
      {draft.healthRisk ? (
        <section className="card">
          <div className="card-head">
            <div className="card-title">4 · Account health / risk</div>
          </div>
          <div className="grid gap-3">
            <Field label="Risk Register">
              <input
                className="input"
                value={draft.healthRisk.registerNote}
                onChange={(event) =>
                  edit((p) => ({
                    ...p,
                    healthRisk: { ...p.healthRisk!, registerNote: event.target.value },
                  }))
                }
              />
            </Field>
            <Field label="Playbook">
              <input
                className="input"
                value={draft.healthRisk.playbook}
                onChange={(event) =>
                  edit((p) => ({ ...p, healthRisk: { ...p.healthRisk!, playbook: event.target.value } }))
                }
              />
            </Field>
            <Field label="Manager">
              <input
                className="input"
                value={draft.healthRisk.managerTag}
                onChange={(event) =>
                  edit((p) => ({ ...p, healthRisk: { ...p.healthRisk!, managerTag: event.target.value } }))
                }
              />
            </Field>
          </div>
        </section>
      ) : null}

      {/* 5 */}
      <section className="card">
        <div className="card-head">
          <div className="card-title">5 · Client / participation</div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              edit((p) => ({
                ...p,
                clientActions: [...p.clientActions, { id: `c-${Date.now()}`, what: "", due: "" }],
              }))
            }
          >
            <Plus />
            Add
          </button>
        </div>
        {!draft.clientActions.length ? (
          <p className="muted text-[0.84rem]">Nothing is owed by the client from this call.</p>
        ) : null}
        <ul className="grid gap-2">
          {draft.clientActions.map((item, index) => (
            <li key={item.id} className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_auto] md:items-center">
              <input
                className="input"
                value={item.what}
                placeholder="What the client is doing"
                onChange={(event) => updateClientAction(index, { ...item, what: event.target.value })}
              />
              <input
                className="input"
                value={item.due}
                placeholder="By when"
                onChange={(event) => updateClientAction(index, { ...item, due: event.target.value })}
              />
              <input
                className="input"
                value={item.blocks || ""}
                placeholder="Holds up"
                onChange={(event) => updateClientAction(index, { ...item, blocks: event.target.value })}
              />
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-[0.78rem]" style={{ color: "var(--text-2)" }}>
                  <input
                    type="checkbox"
                    checked={Boolean(item.tentative)}
                    onChange={(event) => updateClientAction(index, { ...item, tentative: event.target.checked })}
                  />
                  Tentative
                </label>
                {/*
                  A client action creates no ticket, but approving it is what puts it in the recap
                  email as something the client agreed to -- so it is a decision, not prose.
                */}
                <div className="seg" role="group" aria-label="Decision">
                  <button
                    type="button"
                    className={`seg-btn ${item.decision === "approved" ? "on" : ""}`}
                    onClick={() => updateClientAction(index, { ...item, decision: "approved" })}
                  >
                    <Check />
                  </button>
                  <button
                    type="button"
                    className={`seg-btn ${item.decision === "denied" ? "on" : ""}`}
                    onClick={() => updateClientAction(index, { ...item, decision: "denied" })}
                  >
                    <X />
                  </button>
                  <button
                    type="button"
                    className={`seg-btn ${item.decision === "deleted" ? "on" : ""}`}
                    onClick={() => updateClientAction(index, { ...item, decision: "deleted" })}
                  >
                    <Trash2 />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* 6 */}
      <section className="card">
        <div className="card-head">
          <div className="card-title">6 · Pending info — draft tickets</div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              edit((p) => ({
                ...p,
                pending: [
                  ...p.pending,
                  {
                    id: `p-${Date.now()}`,
                    waitingOn: "Client",
                    missing: "",
                    from: "",
                    team: "",
                    owner: "",
                    reminderDate: "",
                  },
                ],
              }))
            }
          >
            <Plus />
            Add
          </button>
        </div>
        {!draft.pending.length ? <p className="muted text-[0.84rem]">Nothing is pending.</p> : null}
        <ul className="grid gap-3">
          {draft.pending.map((item, index) => (
            <li key={item.id} className="card" style={{ padding: "12px 14px" }}>
              <div className="grid gap-2 md:grid-cols-[160px_1fr_auto]">
                <select
                  className="input"
                  value={item.waitingOn}
                  onChange={(event) =>
                    updatePending(index, { ...item, waitingOn: event.target.value as PendingItem["waitingOn"] })
                  }
                >
                  <option value="Client">Waiting on Client</option>
                  <option value="AM review">AM review</option>
                </select>
                <input
                  className="input"
                  value={item.missing}
                  placeholder="What is missing"
                  onChange={(event) => updatePending(index, { ...item, missing: event.target.value })}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Remove"
                  onClick={() =>
                    edit((p) => ({ ...p, pending: p.pending.filter((_, position) => position !== index) }))
                  }
                >
                  <Trash2 />
                </button>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-4">
                <input
                  className="input"
                  value={item.from}
                  placeholder="From whom"
                  onChange={(event) => updatePending(index, { ...item, from: event.target.value })}
                />
                <input
                  className="input"
                  value={item.team}
                  placeholder="Team"
                  onChange={(event) => updatePending(index, { ...item, team: event.target.value })}
                />
                <input
                  className="input"
                  value={item.owner}
                  placeholder="AM owner"
                  onChange={(event) => updatePending(index, { ...item, owner: event.target.value })}
                />
                <input
                  className="input"
                  value={item.reminderDate}
                  placeholder="Chase on"
                  onChange={(event) => updatePending(index, { ...item, reminderDate: event.target.value })}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>

      {blockers.length ? (
        <div className="card">
          <div className="eyebrow muted">Still missing from the notes</div>
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
          {busy === "save" ? "Saving…" : "Save the notes"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreview((open) => !open)}>
          <Eye />
          {preview ? "Hide the preview" : "Preview final notes"}
        </button>
        {confirmRedraft ? (
          <>
            <span className="chip watch">This replaces everything you have written.</span>
            <button type="button" className="btn btn-risk btn-sm" disabled={Boolean(busy)} onClick={() => void redraft()}>
              {busy === "draft" ? "Drafting…" : "Yes, re-draft from the call"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmRedraft(false)}>
              Keep what I wrote
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmRedraft(true)}>
            <RefreshCw />
            Re-draft from the call
          </button>
        )}
      </div>

      {preview ? (
        <pre
          className="card mono"
          style={{ whiteSpace: "pre-wrap", fontSize: "0.8rem", lineHeight: 1.7, color: "var(--text-2)" }}
        >
          {renderNotesMarkdown(draft)}
        </pre>
      ) : null}

      {error ? (
        <p role="alert" className="text-[0.82rem]" style={{ color: "var(--risk)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );

  function updateClientAction(index: number, next: ClientAction) {
    edit((previous) => ({
      ...previous,
      clientActions: previous.clientActions.map((entry, position) => (position === index ? next : entry)),
    }));
  }

  function updatePending(index: number, next: PendingItem) {
    edit((previous) => ({
      ...previous,
      pending: previous.pending.map((entry, position) => (position === index ? next : entry)),
    }));
  }
}
