"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, RotateCcw, Save, TriangleAlert } from "lucide-react";

import { readJsonResponse } from "@/src/lib/api/read-json-response";
import {
  DEFAULT_PREFERENCES,
  PREFERENCE_GROUPS,
  changedPreferenceCount,
  resolvePreferences,
  type NotificationPreferences,
  type PreferenceField,
  type UserPreferences,
} from "@/src/lib/contracts/user-preferences";
import { applyAppearance } from "@/src/lib/appearance";

/**
 * The preferences screen, drawn from the contract rather than hand-written field by field.
 *
 * Two things it does on purpose:
 *
 *  - **Applies appearance the moment it is saved.** Theme and Highlight facts change the document
 *    immediately, so the AM sees the result of the switch they just moved rather than having to
 *    reload to find out whether it took.
 *  - **Says where a value takes effect, under every field.** Two of them are recorded and read by
 *    nothing yet; those carry a plain note instead of being quietly presented as working.
 */

/** The zones the team actually works in, offered as suggestions. Any valid zone may be typed. */
const TIME_ZONE_SUGGESTIONS = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Phoenix",
  "America/Chicago",
  "America/New_York",
  "America/Bogota",
  "America/Mexico_City",
  "Europe/London",
  "Europe/Madrid",
  "UTC",
];

type FieldValue = string | number | boolean;

function notificationKey(field: PreferenceField): keyof NotificationPreferences | null {
  return field.key.startsWith("notifications.")
    ? (field.key.slice("notifications.".length) as keyof NotificationPreferences)
    : null;
}

export function PreferencesClient({ initial }: { initial: UserPreferences }) {
  const [stored, setStored] = useState<UserPreferences>(initial);
  const [draft, setDraft] = useState<UserPreferences>(initial);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const resolved = useMemo(() => resolvePreferences(draft), [draft]);
  const changed = changedPreferenceCount(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(stored);

  const read = useCallback(
    (field: PreferenceField): FieldValue => {
      const notify = notificationKey(field);
      if (notify) return resolved.notifications[notify];
      return resolved[field.key as keyof typeof resolved] as FieldValue;
    },
    [resolved],
  );

  function write(field: PreferenceField, value: FieldValue) {
    setSaved(false);
    const notify = notificationKey(field);
    setDraft((previous) =>
      notify
        ? { ...previous, notifications: { ...(previous.notifications || {}), [notify]: Boolean(value) } }
        : { ...previous, [field.key]: value },
    );
  }

  async function save() {
    setBusy("save");
    setError("");
    try {
      const response = await fetch("/api/settings/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const payload = await readJsonResponse<{ data?: UserPreferences; error?: string }>(response);
      if (!response.ok) throw new Error(payload?.error || "Your preferences were not saved.");
      const next = payload?.data || {};
      setStored(next);
      setDraft(next);
      setSaved(true);
      // The appearance preferences are the two an AM can see, so they take effect here rather than
      // on the next load. The same call also mirrors them into local storage, which is what the
      // pre-paint script in the root layout reads on a hard navigation.
      applyAppearance(resolvePreferences(next));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your preferences were not saved.");
    } finally {
      setBusy("");
    }
  }

  async function reset() {
    setBusy("reset");
    setError("");
    setConfirmReset(false);
    try {
      const response = await fetch("/api/settings/preferences", { method: "DELETE" });
      const payload = await readJsonResponse<{ data?: UserPreferences; error?: string }>(response);
      if (!response.ok) throw new Error(payload?.error || "Your preferences were not reset.");
      setStored({});
      setDraft({});
      setSaved(true);
      applyAppearance(DEFAULT_PREFERENCES);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Your preferences were not reset.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className={`chip ${changed ? "info" : "muted"}`}>
          {changed === 0
            ? "Everything is at its default"
            : `${changed} ${changed === 1 ? "preference" : "preferences"} away from the defaults`}
        </span>
        {saved && !dirty ? (
          <span className="chip good">
            <Check />
            Saved to your account
          </span>
        ) : null}
      </div>

      {PREFERENCE_GROUPS.map((group) => (
        <section key={group.id} className="card">
          <div className="card-head">
            <div>
              <div className="card-title">{group.title}</div>
              <p className="muted mt-1 text-[0.83rem] leading-6">{group.subtitle}</p>
            </div>
          </div>

          <div className="mt-3 grid gap-4">
            {group.fields.map((field) => {
              const value = read(field);
              const id = `pref-${field.key.replace(".", "-")}`;
              return (
                <div key={field.key} className="field">
                  {field.kind === "switch" ? (
                    <label className="flex cursor-pointer items-start gap-3" htmlFor={id}>
                      <input
                        id={id}
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(event) => write(field, event.target.checked)}
                        style={{ marginTop: 3, width: 16, height: 16, accentColor: "var(--accent)" }}
                      />
                      <span className="min-w-0">
                        <span className="field-label" style={{ display: "block" }}>
                          {field.label}
                        </span>
                        <span className="field-hint">{field.hint}</span>
                      </span>
                    </label>
                  ) : (
                    <>
                      <label className="field-label" htmlFor={id}>
                        {field.label}
                      </label>
                      {field.kind === "select" ? (
                        <select
                          id={id}
                          className="input"
                          value={String(value)}
                          onChange={(event) => {
                            const raw = event.target.value;
                            const numeric = field.options?.some((option) => typeof option.value === "number");
                            write(field, numeric ? Number(raw) : raw);
                          }}
                        >
                          {(field.options || []).map((option) => (
                            <option key={String(option.value)} value={String(option.value)}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : field.kind === "textarea" ? (
                        <textarea
                          id={id}
                          className="textarea"
                          rows={4}
                          value={String(value)}
                          onChange={(event) => write(field, event.target.value)}
                        />
                      ) : field.kind === "timezone" ? (
                        <>
                          <input
                            id={id}
                            className="input"
                            list="pref-time-zones"
                            value={String(value)}
                            onChange={(event) => write(field, event.target.value)}
                          />
                          <datalist id="pref-time-zones">
                            {TIME_ZONE_SUGGESTIONS.map((zone) => (
                              <option key={zone} value={zone} />
                            ))}
                          </datalist>
                        </>
                      ) : (
                        <input
                          id={id}
                          className="input"
                          value={String(value)}
                          onChange={(event) => write(field, event.target.value)}
                        />
                      )}
                      <span className="field-hint">{field.hint}</span>
                    </>
                  )}
                  {field.notWiredYet ? (
                    <span className="chip watch mt-1" style={{ alignSelf: "flex-start" }}>
                      <TriangleAlert />
                      Recorded, not yet acted on
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary" disabled={Boolean(busy) || !dirty} onClick={() => void save()}>
          <Save />
          {busy === "save" ? "Saving…" : dirty ? "Save preferences" : "Saved"}
        </button>
        {confirmReset ? (
          <>
            <span className="chip watch">This puts every preference back to its default.</span>
            <button type="button" className="btn btn-risk btn-sm" disabled={Boolean(busy)} onClick={() => void reset()}>
              {busy === "reset" ? "Resetting…" : "Yes, reset"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmReset(false)}>
              Keep mine
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={Boolean(busy) || changed === 0}
            onClick={() => setConfirmReset(true)}
          >
            <RotateCcw />
            Reset to defaults
          </button>
        )}
        <span className="muted text-[0.78rem]">
          Saved against your account, not this browser — they follow you to another computer.
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
