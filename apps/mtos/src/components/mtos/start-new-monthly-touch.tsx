"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { readJsonResponse } from "@/src/lib/api/read-json-response";

export function StartNewMonthlyTouch({
  touchId,
  current,
  canDelete,
}: {
  touchId: string;
  current: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [date, setDate] = useState("");
  const [timeZone, setTimeZone] = useState("");

  function open() {
    const now = new Date();
    const today = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    setDate(today);
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    setError("");
    setShowForm(true);
  }

  async function submit(body: Record<string, unknown>) {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/monthly-touches/${encodeURIComponent(touchId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await readJsonResponse<{ data?: { touchId?: string }; error?: string }>(response);
      if (!response.ok || !result?.data?.touchId) {
        throw new Error(result?.error || "MTOS could not update the touch.");
      }
      router.push(`/monthly-touch/${encodeURIComponent(result.data.touchId)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "MTOS could not update the touch.");
    } finally {
      setPending(false);
    }
  }

  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const scheduled = new Date(`${form.get("date")}T${form.get("time")}`);
    if (!Number.isFinite(scheduled.valueOf())) {
      setError("Enter the actual meeting date and time.");
      return;
    }
    void submit({
      action: "start_new_touch",
      scheduledAt: scheduled.toISOString(),
      timeZone,
      deletePrevious: form.has("deletePrevious"),
    });
  }

  function remove() {
    if (window.confirm("Delete this test touch from the working history?")) {
      void submit({ action: "delete_test_touch" });
    }
  }

  if (!current && !canDelete) return null;

  return (
    <div className="text-[0.8rem]">
      <button
        type="button"
        className="ilink"
        disabled={pending}
        aria-expanded={current ? showForm : undefined}
        onClick={current ? open : remove}
      >
        {pending && !current ? "Deleting…" : current ? "Start a new Monthly Touch" : "Delete this test touch"}
      </button>
      {current && showForm ? (
        <form onSubmit={start} className="card mt-2 grid gap-3">
          <p>Enter the actual meeting time. The earlier attempt stays in history unless you choose to delete it.</p>
          <div className="flex flex-wrap gap-3">
            <label className="grid gap-1">
              Meeting date
              <input type="date" name="date" className="input" defaultValue={date} required />
            </label>
            <label className="grid gap-1">
              Meeting time
              <input type="time" name="time" className="input" required />
            </label>
          </div>
          <div className="muted">Time zone {timeZone}</div>
          {canDelete ? (
            <label className="flex items-center gap-2">
              <input type="checkbox" name="deletePrevious" />
              Delete the earlier test touch from history
            </label>
          ) : null}
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
              {pending ? "Starting…" : "Start from Prep"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {error ? <p role="alert" className="text-[var(--risk)]">{error}</p> : null}
    </div>
  );
}
