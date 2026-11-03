"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";

import { readJsonResponse } from "@/src/lib/api/read-json-response";
import {
  BILLING_CHANGE_TYPES,
  BILLING_DEFAULT_ASSIGNEE,
  CANCEL_SPLIT_CATEGORIES,
  CANCEL_SPLIT_TOTAL,
  OWNER_NEEDED,
  PRIORITY_LABEL,
  TICKET_DEPARTMENTS,
  TICKET_PRIORITIES,
  cancelSplitTotal,
  departmentOwner,
  dueDateAfterPriorityChange,
  itemBlockers,
  itemChips,
  itemTitle,
  type BillingDraftForm,
  type ClickUpTag,
  type DepartmentOwners,
  type FollowThroughItem,
  type ItemDecision,
  type TicketDraftForm,
  type TicketPriorityName,
} from "@/src/lib/contracts/follow-through-tickets";
import type { BillingChangeType } from "@/src/lib/mtos-data";

/**
 * Every action from the call as the ClickUp form it will be filed as.
 *
 * The form is the real one, field for field, because what is approved here is created in ClickUp
 * exactly as approved. Collecting half the fields and leaving the rest "for ClickUp later" is how
 * you get a queue full of tickets with no owner and no estimate.
 *
 * Deny and delete both clear an item from the gate, and they are not the same thing: a denied
 * item stays in the notes as a decision that was made, a deleted one was never really an action.
 */

function Chips({ item, overLong }: { item: FollowThroughItem; overLong: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {itemChips(item, { overLongAction: overLong }).map((chip, index) => (
        <span key={`${chip.label}-${index}`} className={`chip ${chip.tone}`}>
          {chip.label}
        </span>
      ))}
    </div>
  );
}

function Decide({
  decision,
  onDecide,
}: {
  decision?: ItemDecision;
  onDecide: (next: ItemDecision) => void;
}) {
  return (
    <div className="seg" role="group" aria-label="Decision">
      <button type="button" className={`seg-btn ${decision === "approved" ? "on" : ""}`} onClick={() => onDecide("approved")}>
        <Check />
        Approve
      </button>
      <button type="button" className={`seg-btn ${decision === "denied" ? "on" : ""}`} onClick={() => onDecide("denied")}>
        <X />
        Deny
      </button>
      <button type="button" className={`seg-btn ${decision === "deleted" ? "on" : ""}`} onClick={() => onDecide("deleted")}>
        <Trash2 />
        Delete
      </button>
    </div>
  );
}

function TicketForm({
  form,
  tags,
  members,
  owners,
  onChange,
}: {
  form: TicketDraftForm;
  tags: ClickUpTag[];
  members: string[];
  owners: DepartmentOwners;
  onChange: (next: TicketDraftForm) => void;
}) {
  return (
    <div className="mt-3 grid gap-3">
      <div className="field">
        <label className="field-label">🏷️ Task Name *</label>
        <input className="input" value={form.taskName} onChange={(e) => onChange({ ...form, taskName: e.target.value })} />
      </div>

      <div className="field">
        <label className="field-label">🗂️ Business Name</label>
        <input
          className="input"
          value={form.businessName || ""}
          onChange={(e) => onChange({ ...form, businessName: e.target.value })}
        />
      </div>

      <div className="field">
        <label className="field-label">ℹ️ Task Description *</label>
        <textarea
          className="textarea"
          rows={4}
          value={form.description}
          onChange={(e) => onChange({ ...form, description: e.target.value })}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="field">
          <label className="field-label">🧩 Department *</label>
          <select
            className="input"
            value={form.department || ""}
            onChange={(e) => {
              const department = e.target.value;
              const owner = departmentOwner(department, owners);
              onChange({
                ...form,
                department,
                // Changing the department re-routes the ticket, so the owner follows it -- unless
                // the AM has already named somebody, which is a decision and stays.
                assignee:
                  !form.assignee || form.assignee === OWNER_NEEDED || departmentOwner(form.department, owners) === form.assignee
                    ? owner || OWNER_NEEDED
                    : form.assignee,
              });
            }}
          >
            <option value="">—</option>
            {TICKET_DEPARTMENTS.map((department) => (
              <option key={department} value={department}>
                {department}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field-label">👤 Assignee *</label>
          {members.length ? (
            <select
              className="input"
              value={form.assignee || ""}
              onChange={(e) => onChange({ ...form, assignee: e.target.value })}
            >
              <option value="">—</option>
              {form.assignee === OWNER_NEEDED ? <option value={OWNER_NEEDED}>{OWNER_NEEDED}</option> : null}
              {members.map((member) => (
                <option key={member} value={member}>
                  {member}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="input"
              value={form.assignee || ""}
              onChange={(e) => onChange({ ...form, assignee: e.target.value })}
            />
          )}
          {form.assignee === OWNER_NEEDED ? (
            <span className="field-hint">
              No default owner is set for this department. Pick someone — this ticket cannot be filed without one.
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="field">
          <label className="field-label">⏳ Time Estimate * (minutes)</label>
          <input
            className="input"
            type="number"
            min={5}
            step={5}
            value={form.timeEstimateMinutes || ""}
            onChange={(e) =>
              onChange({ ...form, timeEstimateMinutes: Number(e.target.value) || undefined })
            }
          />
        </div>

        <div className="field">
          <label className="field-label">🚩 Priority *</label>
          <select
            className="input"
            value={form.priority || ""}
            onChange={(e) => {
              const priority = (e.target.value || undefined) as TicketPriorityName | undefined;
              onChange({
                ...form,
                priority,
                dueDate: dueDateAfterPriorityChange(priority, form, new Date()),
              });
            }}
          >
            <option value="">—</option>
            {TICKET_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABEL[priority]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field-label">🗓️ Due date</label>
          <input
            className="input"
            type="date"
            value={form.dueDate || ""}
            onChange={(e) => onChange({ ...form, dueDate: e.target.value, dueDateAgreedOnCall: true })}
          />
          <span className="field-hint">
            {form.dueDateAgreedOnCall
              ? "Agreed on the call — changing the priority will not move it."
              : "From the priority. Set it yourself if the client was given a date."}
          </span>
        </div>
      </div>

      {tags.length ? (
        <div className="field">
          <label className="field-label">🎟️ Tags</label>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => {
              const on = form.tags?.includes(tag.name);
              return (
                <button
                  key={tag.name}
                  type="button"
                  className={`chip ${on ? "info" : "muted"}`}
                  style={on && tag.background ? { background: tag.background, color: tag.foreground || "#fff" } : undefined}
                  onClick={() =>
                    onChange({
                      ...form,
                      tags: on
                        ? (form.tags || []).filter((name) => name !== tag.name)
                        : [...(form.tags || []), tag.name],
                    })
                  }
                >
                  {tag.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BillingForm({
  form,
  members,
  onChange,
}: {
  form: BillingDraftForm;
  members: string[];
  onChange: (next: BillingDraftForm) => void;
}) {
  const total = cancelSplitTotal(form.cancelSplit);
  return (
    <div className="mt-3 grid gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="field">
          <label className="field-label">Business</label>
          <input
            className="input"
            value={form.businessName || ""}
            onChange={(e) => onChange({ ...form, businessName: e.target.value })}
          />
        </div>
        <div className="field">
          <label className="field-label">Change *</label>
          <select
            className="input"
            value={form.changeType || ""}
            onChange={(e) => onChange({ ...form, changeType: (e.target.value || undefined) as BillingChangeType | undefined })}
          >
            <option value="">—</option>
            {BILLING_CHANGE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="field">
          <label className="field-label">Date it was Requested *</label>
          <input
            className="input"
            type="date"
            value={form.dateRequested || ""}
            onChange={(e) => onChange({ ...form, dateRequested: e.target.value })}
          />
        </div>
        <div className="field">
          <label className="field-label">Due date *</label>
          <input
            className="input"
            type="date"
            value={form.dueDate || ""}
            onChange={(e) => onChange({ ...form, dueDate: e.target.value })}
          />
        </div>
        <div className="field">
          <label className="field-label">Assignee *</label>
          {members.length ? (
            <select
              className="input"
              value={form.assignee || ""}
              onChange={(e) => onChange({ ...form, assignee: e.target.value })}
            >
              <option value="">—</option>
              {members.map((member) => (
                <option key={member} value={member}>
                  {member}
                </option>
              ))}
              {members.includes(BILLING_DEFAULT_ASSIGNEE) ? null : (
                <option value={BILLING_DEFAULT_ASSIGNEE}>{BILLING_DEFAULT_ASSIGNEE}</option>
              )}
            </select>
          ) : (
            <input
              className="input"
              value={form.assignee || ""}
              onChange={(e) => onChange({ ...form, assignee: e.target.value })}
            />
          )}
        </div>
      </div>

      <div className="field">
        <label className="field-label">Change details</label>
        <textarea
          className="textarea"
          rows={3}
          value={form.details}
          onChange={(e) => onChange({ ...form, details: e.target.value })}
        />
      </div>

      {form.changeType === "Cancel" ? (
        <div className="card" style={{ padding: "12px 14px" }}>
          <div className="card-head">
            <div className="card-title">Why they cancelled</div>
            <span className={`chip ${total === CANCEL_SPLIT_TOTAL ? "good" : "risk"}`}>
              {total} of {CANCEL_SPLIT_TOTAL} points
            </span>
          </div>
          <p className="muted text-[0.8rem]">
            Five points, split across the five reasons. The churn analysis is built from this, so a
            row that does not add up skews it.
          </p>
          <div className="mt-2 grid gap-2 md:grid-cols-5">
            {CANCEL_SPLIT_CATEGORIES.map((category) => (
              <div key={category} className="field">
                <label className="field-label">{category}</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={5}
                  value={form.cancelSplit?.[category] ?? 0}
                  onChange={(e) =>
                    onChange({
                      ...form,
                      cancelSplit: { ...form.cancelSplit, [category]: Number(e.target.value) || 0 },
                    })
                  }
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function FollowThroughItems({
  touchId,
  items,
  tags,
  tagsReason,
  members,
  owners,
  overLongActionIds,
  note,
}: {
  touchId: string;
  items?: FollowThroughItem[];
  tags: ClickUpTag[];
  tagsReason?: string;
  members: string[];
  owners: DepartmentOwners;
  overLongActionIds?: string[];
  note?: string;
}) {
  const [list, setList] = useState<FollowThroughItem[] | undefined>(items);
  const [overLong, setOverLong] = useState<string[]>(overLongActionIds || []);
  const [message, setMessage] = useState(note || "");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const blockers = useMemo(() => (list ? itemBlockers(list) : []), [list]);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await fetch(`/api/monthly-touches/${touchId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await readJsonResponse<{
        data?: { items?: FollowThroughItem[]; overLongActionIds?: string[]; note?: string };
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
    try {
      const data = await post({ action: "build_items" });
      if (data?.items) setList(data.items);
      setOverLong(data?.overLongActionIds || []);
      setMessage(data?.note || "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The tickets could not be built.");
    } finally {
      setBusy("");
    }
  }

  async function save() {
    if (!list) return;
    setBusy("save");
    setError("");
    try {
      await post({ action: "save_items", items: list });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The tickets were not saved.");
    } finally {
      setBusy("");
    }
  }

  function update(index: number, next: FollowThroughItem) {
    setList((previous) => previous?.map((item, position) => (position === index ? next : item)));
  }

  if (!list) {
    return (
      <div className="grid gap-3">
        <p className="text-[0.86rem] leading-7" style={{ color: "var(--text-2)" }}>
          Every action in the notes becomes a ticket here, pre-filled on the real ClickUp form.
          Nothing is created until you finish the follow-through.
        </p>
        <div>
          <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void build()}>
            <RefreshCw />
            {busy === "build" ? "Building…" : "Build the tickets from the notes"}
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
    <div className="grid gap-4">
      {message ? <div className="callout"><div className="callout-body">{message}</div></div> : null}
      {tagsReason ? (
        <p className="muted text-[0.8rem]">Tags are unavailable: {tagsReason}</p>
      ) : null}

      <ul className="grid gap-3">
        {list.map((item, index) => {
          const expanded = open[item.id];
          const isOverLong = Boolean(item.actionId && overLong.includes(item.actionId));
          return (
            <li key={item.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  onClick={() => setOpen((previous) => ({ ...previous, [item.id]: !previous[item.id] }))}
                >
                  {expanded ? <ChevronDown /> : <ChevronRight />}
                  <span className="min-w-0">
                    <span className="block text-[0.9rem] font-semibold" style={{ color: "var(--text)" }}>
                      {itemTitle(item) || "Untitled"}
                    </span>
                    <span className="muted text-[0.78rem]">
                      {expanded ? "Hide the form" : "Edit ticket"}
                    </span>
                  </span>
                </button>
                <Decide decision={item.decision} onDecide={(next) => update(index, { ...item, decision: next })} />
              </div>

              <div className="mt-2">
                <Chips item={item} overLong={isOverLong} />
              </div>

              {expanded ? (
                item.formType === "billing" ? (
                  <BillingForm form={item} members={members} onChange={(next) => update(index, next)} />
                ) : (
                  <TicketForm
                    form={item}
                    tags={tags}
                    members={members}
                    owners={owners}
                    onChange={(next) => update(index, next)}
                  />
                )
              ) : null}
            </li>
          );
        })}
      </ul>

      {!list.length ? (
        <p className="muted text-[0.84rem]">No actions in the notes, so there are no tickets to file.</p>
      ) : null}

      {blockers.length ? (
        <div className="card">
          <div className="eyebrow muted">Before these can be filed</div>
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
          {busy === "save" ? "Saving…" : "Save the tickets"}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() =>
            setList((previous) => [
              ...(previous || []),
              {
                id: `ticket-manual-${Date.now()}`,
                formType: "ticket",
                taskName: "",
                description: "",
                assignee: OWNER_NEEDED,
                priority: "normal",
              },
            ])
          }
        >
          <Plus />
          Add a ticket
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => void build()}>
          <RefreshCw />
          {busy === "build" ? "Rebuilding…" : "Rebuild from the notes"}
        </button>
        <span className="muted text-[0.78rem]">
          Rebuilding keeps every ticket you have already edited or decided on.
        </span>
      </div>

      {error ? (
        <p role="alert" className="text-[0.82rem]" style={{ color: "var(--risk)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
