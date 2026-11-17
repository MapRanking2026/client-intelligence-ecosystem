"use client";
import { useState } from "react";
import { clientZone } from "@/src/lib/contracts/client-time-zone";

export function ClientTimeZoneField({ touchId, timeZone, source, disabled, beforeSave }: {
  touchId: string; timeZone?: string; source?: string; disabled?: boolean; beforeSave: () => Promise<void>;
}) {
  const [value, setValue] = useState(timeZone || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setSaving(true); setError("");
    try {
      await beforeSave();
      const response = await fetch(`/api/monthly-touches/${encodeURIComponent(touchId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "set_client_time_zone", timeZone: value }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Client time zone could not be saved.");
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Client time zone could not be saved. Reload to check the saved value before retrying."); }
    finally { setSaving(false); }
  }
  return <div className="card grid gap-2">
    <label className="field-label" htmlFor={`client-zone-${touchId}`}>Client time zone</label>
    <div className="flex flex-wrap gap-2"><input id={`client-zone-${touchId}`} className="input" list={`client-time-zones-${touchId}`} value={value} placeholder="e.g. America/Los_Angeles" disabled={disabled || saving} onChange={(event) => setValue(event.target.value)} />
      <button type="button" className="btn btn-ghost btn-sm" disabled={disabled || saving || !clientZone(value) || value === timeZone} onClick={() => void save()}>{saving ? "Saving…" : "Save client time zone"}</button></div>
    <datalist id={`client-time-zones-${touchId}`}>{["America/Los_Angeles", "America/Denver", "America/Phoenix", "America/Chicago", "America/New_York", "America/Anchorage", "Pacific/Honolulu", "America/Tijuana", "America/Toronto", "America/Vancouver", "Europe/London", "UTC"].map((zone) => <option key={zone} value={zone} />)}</datalist>
    <p className="field-hint">{source || "Set the client's local zone, not your own. Daylight saving is applied for the meeting date."} Saving updates the draft’s displayed time; it does not move the meeting.</p>
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
