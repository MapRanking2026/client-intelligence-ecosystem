"use client";

import { useMemo, useState, useTransition } from "react";
import { ExternalLink, LoaderCircle, Plus, RefreshCw } from "lucide-react";

import {
  LEAD_CATEGORY_LABEL,
  LEAD_CHANNEL_LABEL,
  LEAD_STATUS_LABEL,
  LEAD_TYPE_LABEL,
} from "@/src/lib/mtos-data";
import type {
  LeadCategory,
  LeadChannel,
  LeadStatus,
  LeadVerificationReview,
} from "@/src/lib/mtos-data";
import { LeadVerificationSummary } from "@/src/components/mtos/lead-verification-summary";

const STATUS_OPTIONS = Object.keys(LEAD_STATUS_LABEL) as LeadStatus[];
const CATEGORY_OPTIONS = Object.keys(LEAD_CATEGORY_LABEL) as LeadCategory[];
const CHANNEL_OPTIONS = Object.keys(LEAD_CHANNEL_LABEL) as LeadChannel[];

interface ActionResponse {
  data?: LeadVerificationReview | null;
  error?: string;
}

function formatDate(value?: string) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const statusRowTone: Record<LeadStatus, string> = {
  valid: "border-l-2 border-l-emerald-400/50",
  flagged: "border-l-2 border-l-rose-400/50",
  needs_review: "border-l-2 border-l-amber-400/50",
};

export function LeadVerificationTable({
  clientId,
  initialReview,
}: {
  clientId: string;
  initialReview: LeadVerificationReview | null;
}) {
  const [review, setReview] = useState<LeadVerificationReview | null>(initialReview);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<LeadChannel | "all">("all");
  const [statusFilter, setStatusFilter] = useState<LeadStatus | "all">("all");
  const [showManual, setShowManual] = useState(false);

  function post(body: unknown, actionLabel: string) {
    startTransition(async () => {
      setError(null);
      setPendingAction(actionLabel);
      try {
        const response = await fetch(`/api/clients/${clientId}/lead-verification`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = (await response.json()) as ActionResponse;
        if (!response.ok) {
          throw new Error(payload.error || "Action failed");
        }
        setReview(payload.data ?? null);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Action failed");
      } finally {
        setPendingAction(null);
      }
    });
  }

  const leads = review?.leads ?? [];
  const filteredLeads = useMemo(
    () =>
      (review?.leads ?? []).filter(
        (lead) =>
          (channelFilter === "all" || lead.channel === channelFilter) &&
          (statusFilter === "all" || lead.status === statusFilter),
      ),
    [review, channelFilter, statusFilter],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => post({ action: "refresh" }, "refresh")}
            disabled={isPending}
            style={{ color: "#0d1625" }}
            className="inline-flex items-center gap-2 rounded-full border border-[#d7f5ec]/20 bg-[#d7f5ec] px-4 py-2 text-sm font-semibold text-[#0d1625] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending && pendingAction === "refresh" ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Refresh from sources
          </button>
          <button
            type="button"
            onClick={() => setShowManual((value) => !value)}
            className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/4 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/8"
          >
            <Plus className="h-4 w-4" />
            Add / paste leads
          </button>
        </div>
        {review?.generatedAt ? (
          <p className="text-xs text-slate-500">Last run {formatDate(review.generatedAt)}</p>
        ) : null}
      </div>

      {error ? <p className="text-sm text-rose-300">{error}</p> : null}

      {showManual ? (
        <ManualLeadPanel
          disabled={isPending}
          onSubmit={(rows) => post({ action: "add_manual_leads", leads: rows }, "manual")}
        />
      ) : null}

      {review ? <LeadVerificationSummary review={review} clientId={clientId} showLink={false} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <FilterSelect
          label="Channel"
          value={channelFilter}
          onChange={(value) => setChannelFilter(value as LeadChannel | "all")}
          options={[["all", "All channels"], ...CHANNEL_OPTIONS.map((c) => [c, LEAD_CHANNEL_LABEL[c]] as const)]}
        />
        <FilterSelect
          label="Status"
          value={statusFilter}
          onChange={(value) => setStatusFilter(value as LeadStatus | "all")}
          options={[["all", "All statuses"], ...STATUS_OPTIONS.map((s) => [s, LEAD_STATUS_LABEL[s]] as const)]}
        />
        <p className="text-xs text-slate-500">
          {filteredLeads.length} of {leads.length} lead{leads.length === 1 ? "" : "s"}
        </p>
      </div>

      {leads.length === 0 ? (
        <div className="rounded-[24px] border border-white/8 bg-black/20 px-5 py-8 text-center text-sm text-slate-400">
          No leads to show yet. Click <span className="text-slate-200">Refresh from sources</span> to pull the latest
          from GoHighLevel, or add leads manually.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[24px] border border-white/8 bg-black/20">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                <th className="px-4 py-3 font-medium">Lead</th>
                <th className="px-4 py-3 font-medium">Received</th>
                <th className="px-4 py-3 font-medium">Channel</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Conf.</th>
                <th className="px-4 py-3 font-medium">Recording</th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.map((lead) => (
                <tr key={lead.id} className={`border-t border-white/6 align-top ${statusRowTone[lead.status]}`}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-white">{lead.name || "Unknown"}</p>
                    <p className="text-xs text-slate-400">{lead.phone || lead.email || "No contact info"}</p>
                    {lead.reason ? <p className="mt-1 text-xs text-slate-500">{lead.reason}</p> : null}
                    {lead.manual ? (
                      <span className="mt-1 inline-block rounded-full bg-white/8 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-slate-400">
                        Manual
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-300">{formatDate(lead.receivedAt)}</td>
                  <td className="px-4 py-3 text-slate-300">{LEAD_CHANNEL_LABEL[lead.channel]}</td>
                  <td className="px-4 py-3 text-slate-300">{LEAD_TYPE_LABEL[lead.type]}</td>
                  <td className="px-4 py-3">
                    <InlineSelect
                      value={lead.status}
                      disabled={isPending}
                      onChange={(value) =>
                        post({ action: "set_verdict", verdicts: { [lead.id]: { status: value } } }, `status-${lead.id}`)
                      }
                      options={STATUS_OPTIONS.map((s) => [s, LEAD_STATUS_LABEL[s]] as const)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <InlineSelect
                      value={lead.category}
                      disabled={isPending}
                      onChange={(value) =>
                        post(
                          { action: "set_verdict", verdicts: { [lead.id]: { category: value } } },
                          `category-${lead.id}`,
                        )
                      }
                      options={CATEGORY_OPTIONS.map((c) => [c, LEAD_CATEGORY_LABEL[c]] as const)}
                    />
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {typeof lead.confidence === "number" ? `${lead.confidence}%` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {lead.recordingUrl ? (
                      <a
                        href={lead.recordingUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-slate-200 hover:text-white"
                      >
                        Listen <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : lead.contactUrl ? (
                      <a
                        href={lead.contactUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-200"
                      >
                        In GHL <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
}) {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-slate-400">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-full border border-white/12 bg-black/30 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-white/30"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue} className="bg-slate-900">
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function InlineSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-lg border border-white/12 bg-black/30 px-2 py-1 text-xs text-slate-100 outline-none focus:border-white/30 disabled:opacity-60"
    >
      {options.map(([optionValue, optionLabel]) => (
        <option key={optionValue} value={optionValue} className="bg-slate-900">
          {optionLabel}
        </option>
      ))}
    </select>
  );
}

interface ManualRow {
  name?: string;
  phone?: string;
  email?: string;
  source?: string;
}

/**
 * Add leads that aren't in a connected source. Accepts a pasted block (one lead
 * per line, comma- or tab-separated: name, phone, email, source) so an AM can
 * drop in a table from a spreadsheet or another tool.
 */
function ManualLeadPanel({ onSubmit, disabled }: { onSubmit: (rows: ManualRow[]) => void; disabled?: boolean }) {
  const [text, setText] = useState("");

  function parse(): ManualRow[] {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, phone, email, source] = line.split(/\t|,/).map((cell) => cell.trim());
        return { name, phone, email, source };
      })
      .filter((row) => row.name || row.phone || row.email);
  }

  const rows = parse();

  return (
    <div className="space-y-3 rounded-[24px] border border-white/8 bg-black/20 p-5">
      <div>
        <p className="text-sm font-medium text-white">Add or paste leads</p>
        <p className="mt-1 text-xs text-slate-500">
          One lead per line: <span className="text-slate-300">name, phone, email, source</span> (comma or tab
          separated). Paste straight from a spreadsheet. These are added alongside the connected-source leads and
          tagged as manual.
        </p>
      </div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={4}
        placeholder={"Jane Doe, (555) 123-4567, jane@email.com, Meta Ads\nJohn Smith, (555) 987-6543, , Referral"}
        className="w-full rounded-2xl border border-white/12 bg-black/30 px-4 py-3 text-sm text-slate-100 outline-none focus:border-white/30"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={disabled || rows.length === 0}
          onClick={() => {
            onSubmit(rows);
            setText("");
          }}
          style={{ color: "#0d1625" }}
          className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white px-4 py-2 text-sm font-semibold text-[#0d1625] transition hover:bg-[#d7f5ec] disabled:cursor-not-allowed disabled:opacity-60"
        >
          Add {rows.length || ""} lead{rows.length === 1 ? "" : "s"}
        </button>
        <span className="text-xs text-slate-500">{rows.length} row{rows.length === 1 ? "" : "s"} detected</span>
      </div>
    </div>
  );
}
