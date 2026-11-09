"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { COMPARISON_MODE_LABEL, type ComparisonMode } from "@/src/lib/contracts/call-report";
import type { NumberFilterOption } from "@/src/lib/contracts/call-dashboard";
import { LEAD_WINDOW_LABEL, type LeadWindowPreset } from "@/src/lib/mtos-data";

/**
 * The dashboard's filters, which live in the URL rather than in component state.
 *
 * In the URL because the whole screen is server-rendered from one stored read: changing the period
 * has to go back to the server anyway, and a URL that carries the filters means an AM can send
 * "look at this client's spam calls for October" as a link, and the back button undoes a filter
 * instead of leaving the page.
 *
 * `useTransition` keeps the old figures on screen, dimmed, while the new ones are fetched. The
 * alternative -- blanking the panels -- makes a 300ms navigation look like a page that broke.
 */

const PRESETS: LeadWindowPreset[] = ["last_7_days", "last_30_days", "last_90_days", "this_month", "last_month"];
const COMPARISONS: ComparisonMode[] = ["previous_period", "same_period_last_year", "none"];

export function CallDashboardToolbar({
  clientId,
  preset,
  comparison,
  number,
  numbers,
  children,
}: {
  clientId: string;
  preset: LeadWindowPreset;
  comparison: ComparisonMode;
  number?: string;
  numbers: NumberFilterOption[];
  /** The actions that belong beside the filters: AI review, Describe calls, Export. */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  /** Replace one parameter and keep the rest, so filters compose instead of resetting each other. */
  function set(key: string, value: string | undefined) {
    const next = new URLSearchParams(params.toString());
    next.set("client", clientId);
    if (value) next.set(key, value);
    else next.delete(key);
    // Changing the period can leave a label filter showing nothing; that is handled by the
    // table's own "filtered to nothing" state, which offers to clear it. Silently dropping the
    // filter here would be worse -- the screen would stop matching the URL the AM is looking at.
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  }

  return (
    <div
      className="flex flex-wrap items-end gap-3"
      style={{ opacity: pending ? 0.55 : 1, transition: "opacity 120ms" }}
    >
      <label className="grid gap-1">
        <span className="stat-label">Period</span>
        <select
          className="input"
          value={preset}
          onChange={(event) => set("period", event.target.value)}
          style={{ minWidth: 150 }}
        >
          {PRESETS.map((option) => (
            <option key={option} value={option}>
              {LEAD_WINDOW_LABEL[option]}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1">
        <span className="stat-label">Compared with</span>
        <select
          className="input"
          value={comparison}
          onChange={(event) => set("compare", event.target.value)}
          style={{ minWidth: 190 }}
        >
          {COMPARISONS.map((mode) => (
            <option key={mode} value={mode}>
              {COMPARISON_MODE_LABEL[mode]}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1">
        <span className="stat-label">Tracking number</span>
        <select
          className="input"
          value={number || ""}
          onChange={(event) => set("number", event.target.value || undefined)}
          style={{ minWidth: 200 }}
          disabled={numbers.length === 0}
        >
          <option value="">
            {numbers.length ? "Every number" : "No number recorded yet"}
          </option>
          {numbers.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} ({option.count})
            </option>
          ))}
        </select>
      </label>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {pending ? (
          <span className="muted inline-flex items-center gap-1.5 text-[0.76rem]">
            <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />
            Updating
          </span>
        ) : null}
        {children}
      </div>
    </div>
  );
}
