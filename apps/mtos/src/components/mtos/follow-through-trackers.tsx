"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, RefreshCw, Save, Trash2, X } from "lucide-react";

import { readJsonResponse } from "@/src/lib/api/read-json-response";
import {
  HEALTH_TRACKER_FIELDS,
  RISK_REGISTER_FIELDS,
  STAKEHOLDER_FIELDS,
  cardLabel,
  changeCount,
  diffRow,
  trackerBlockers,
  type FieldDiff,
  type TrackerCard,
  type TrackerDecision,
  type TrackerField,
} from "@/src/lib/contracts/follow-through-trackers";

/**
 * The three tracker rows this touch would write, each against the row as it stands.
 *
 * Every field that changes shows what it was. These rows are read by people who were not on the
 * call -- the Health Tracker by anyone looking at the book, the Risk Register by whoever runs
 * retention -- so "MRR: $2,400 (was $1,900)" is the difference between an approval and a signature
 * on something the AM never actually looked at.
 *
 * When the current row cannot be read, the card says so and every field reads as new. That is
 * deliberately louder than a quiet empty "was", which would look like a row with nothing in it.
 */

type AnyRow = Record<string, unknown>;

function fieldsFor(kind: TrackerCard["kind"]): TrackerField<AnyRow>[] {
  const list =
    kind === "health" ? HEALTH_TRACKER_FIELDS : kind === "risk" ? RISK_REGISTER_FIELDS : STAKEHOLDER_FIELDS;
  return list as unknown as TrackerField<AnyRow>[];
}

function DiffRow({
  diff,
  field,
  value,
  onChange,
}: {
  diff: FieldDiff;
  field: TrackerField<AnyRow>;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  const readOnly = field.kind === "readonly";
  return (
    <div className="grid gap-1 md:grid-cols-[200px_1fr] md:items-start">
      <span className="text-[0.82rem] font-semibold" style={{ color: "var(--text-2)" }}>
        {field.label}
        {diff.changed ? <span className="chip watch ml-2">changed</span> : null}
        {diff.isNew ? <span className="chip info ml-2">new</span> : null}
      </span>
      <div>
        {readOnly ? (
          <p className="text-[0.86rem]" style={{ color: "var(--text)" }}>
            {diff.now || "—"} <span className="muted">(set elsewhere)</span>
          </p>
        ) : field.kind === "longText" ? (
          <textarea
            className="textarea"
            rows={2}
            value={String(value ?? "")}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : field.kind === "select" ? (
          <select className="input" value={String(value ?? "")} onChange={(event) => onChange(event.target.value || undefined)}>
            <option value="">—</option>
            {(field.options || []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        ) : field.kind === "multi" ? (
          <input
            className="input"
            value={Array.isArray(value) ? value.join(", ") : String(value ?? "")}
            placeholder="Comma separated"
            onChange={(event) =>
              onChange(
                event.target.value
                  .split(",")
                  .map((entry) => entry.trim())
                  .filter(Boolean),
              )
            }
          />
        ) : (
          <input
            className="input"
            type={field.kind === "date" ? "date" : "text"}
            value={String(value ?? "")}
            onChange={(event) => onChange(event.target.value || undefined)}
          />
        )}
        {diff.changed ? (
          <p className="muted mt-1 text-[0.78rem]">was: {diff.was}</p>
        ) : null}
      </div>
    </div>
  );
}

export function FollowThroughTrackers({
  touchId,
  cards,
  reason,
}: {
  touchId: string;
  cards?: TrackerCard[];
  reason?: string;
}) {
  const [list, setList] = useState<TrackerCard[] | undefined>(cards);
  const [message, setMessage] = useState(reason || "");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  // Recomputed from the card the AM is editing, so "was" and the change chips track their typing
  // rather than the version the server last built.
  const diffs = useMemo(() => {
    const result: Record<string, FieldDiff[]> = {};
    for (const card of list || []) {
      result[card.id] = diffRow(
        card.current as AnyRow | undefined,
        card.next as AnyRow,
        fieldsFor(card.kind),
      );
    }
    return result;
  }, [list]);

  const blockers = useMemo(() => (list ? trackerBlockers(list, diffs) : []), [list, diffs]);

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await fetch(`/api/monthly-touches/${touchId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await readJsonResponse<{
        data?: { cards?: TrackerCard[]; reason?: string };
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
      const data = await post({ action: "build_tracker_cards" });
      if (data?.cards) setList(data.cards);
      setMessage(data?.reason || "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The tracker rows could not be built.");
    } finally {
      setBusy("");
    }
  }

  async function save() {
    if (!list) return;
    setBusy("save");
    setError("");
    try {
      await post({ action: "save_tracker_cards", cards: list });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The tracker rows were not saved.");
    } finally {
      setBusy("");
    }
  }

  function setField(cardIndex: number, key: string, value: unknown) {
    setList((previous) =>
      previous?.map((card, index) =>
        index === cardIndex ? ({ ...card, next: { ...card.next, [key]: value } } as TrackerCard) : card,
      ),
    );
  }

  function decide(cardIndex: number, decision: TrackerDecision) {
    setList((previous) =>
      previous?.map((card, index) => (index === cardIndex ? ({ ...card, decision } as TrackerCard) : card)),
    );
  }

  if (!list) {
    return (
      <div className="grid gap-3">
        <p className="text-[0.86rem] leading-7" style={{ color: "var(--text-2)" }}>
          MTOS will read the client&rsquo;s current rows out of ClickUp and show you what this call
          changes about each one, field by field.
        </p>
        <div>
          <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => void build()}>
            <RefreshCw />
            {busy === "build" ? "Reading the rows…" : "Build the tracker rows"}
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
      {message ? (
        <div className="callout">
          <div className="callout-body">
            {message} Every field below reads as new because there is nothing to compare it with.
          </div>
        </div>
      ) : null}

      <ul className="grid gap-3">
        {list.map((card, index) => {
          const cardDiffs = diffs[card.id] || [];
          const counts = changeCount(cardDiffs);
          const expanded = open[card.id];
          return (
            <li key={card.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-start gap-2 text-left"
                  onClick={() => setOpen((previous) => ({ ...previous, [card.id]: !previous[card.id] }))}
                >
                  {expanded ? <ChevronDown /> : <ChevronRight />}
                  <span className="min-w-0">
                    <span className="block text-[0.9rem] font-semibold" style={{ color: "var(--text)" }}>
                      {cardLabel(card)}
                    </span>
                    <span className="muted text-[0.78rem]">
                      {card.isNewRow
                        ? "New row"
                        : counts.changed || counts.added
                          ? `${counts.changed} changed, ${counts.added} filled in`
                          : "Nothing changes"}
                    </span>
                  </span>
                </button>
                <div className="seg" role="group" aria-label="Decision">
                  <button type="button" className={`seg-btn ${card.decision === "approved" ? "on" : ""}`} onClick={() => decide(index, "approved")}>
                    <Check />
                    Approve
                  </button>
                  <button type="button" className={`seg-btn ${card.decision === "denied" ? "on" : ""}`} onClick={() => decide(index, "denied")}>
                    <X />
                    Deny
                  </button>
                  <button type="button" className={`seg-btn ${card.decision === "deleted" ? "on" : ""}`} onClick={() => decide(index, "deleted")}>
                    <Trash2 />
                    Delete
                  </button>
                </div>
              </div>

              {!expanded && (counts.changed || counts.added) ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {cardDiffs
                    .filter((diff) => diff.changed || diff.isNew)
                    .map((diff) => (
                      <span key={diff.key} className={`chip ${diff.changed ? "watch" : "info"}`}>
                        {diff.label}
                        {diff.changed ? ` — was ${diff.was}` : ""}
                      </span>
                    ))}
                </div>
              ) : null}

              {expanded ? (
                <div className="mt-3 grid gap-3">
                  {cardDiffs.map((diff) => {
                    const field = fieldsFor(card.kind).find((candidate) => candidate.key === diff.key);
                    if (!field) return null;
                    return (
                      <DiffRow
                        key={diff.key}
                        diff={diff}
                        field={field}
                        value={(card.next as AnyRow)[diff.key]}
                        onChange={(value) => setField(index, diff.key, value)}
                      />
                    );
                  })}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {blockers.length ? (
        <div className="card">
          <div className="eyebrow muted">Before these can be written</div>
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
          {busy === "save" ? "Saving…" : "Save the tracker rows"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={() => void build()}>
          <RefreshCw />
          {busy === "build" ? "Re-reading…" : "Re-read the current rows"}
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
