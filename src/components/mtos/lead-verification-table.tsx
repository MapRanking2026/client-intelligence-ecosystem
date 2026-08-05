"use client";

import { useMemo, useState, useTransition } from "react";
import { Check, ClipboardCheck, ExternalLink, LoaderCircle, Plus, RefreshCw, Upload, X } from "lucide-react";

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
  VerifiedLead,
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
  missed_call: "border-l-2 border-l-sky-400/60",
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
  const [showCompare, setShowCompare] = useState(false);

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
            onClick={() => setShowCompare((value) => !value)}
            className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/4 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/8"
          >
            <ClipboardCheck className="h-4 w-4" />
            Compare a list
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

      {showCompare ? (
        <CompareListPanel
          leads={review?.leads ?? []}
          disabled={isPending}
          onAddSelected={(rows) => post({ action: "add_manual_leads", leads: rows }, "compare-add")}
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
                  <td className="px-4 py-3 text-slate-300">
                    {LEAD_TYPE_LABEL[lead.type]}
                    {lead.type === "call" && typeof lead.callDurationSec === "number" ? (
                      <span className="block text-xs text-slate-500">
                        {lead.callDurationSec}s{lead.callStatus ? ` · ${lead.callStatus}` : ""}
                      </span>
                    ) : null}
                  </td>
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
                      // preload="none" so the audio is only fetched when the AM hits play,
                      // not once per call row on page load.
                      <audio
                        controls
                        preload="none"
                        src={lead.recordingUrl}
                        className="h-9 w-48 max-w-[220px]"
                      >
                        <a href={lead.recordingUrl} target="_blank" rel="noreferrer">
                          Listen
                        </a>
                      </audio>
                    ) : lead.contactUrl ? (
                      <a
                        href={lead.contactUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-200"
                      >
                        {lead.type === "call" ? "Listen in GHL" : "In GHL"} <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : lead.type === "call" ? (
                      <span className="text-xs text-slate-600">no recording</span>
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

interface CompareRow {
  name?: string;
  phone?: string;
  email?: string;
  source?: string;
  date?: string;
}

interface CompareAddRow {
  name?: string;
  phone?: string;
  email?: string;
  receivedAt?: string;
  source?: string;
  status: "valid";
  category: "valid_new_lead";
}

const normPhone = (value?: string) => (value || "").replace(/\D/g, "").slice(-10);
const normEmail = (value?: string) => (value || "").trim().toLowerCase();

/** Parse pasted/CSV rows: honor a header row if present, else positional name,phone,email,source,date. */
/**
 * Full CSV/TSV tokenizer. Walks the ENTIRE text respecting "quoted" fields, so a
 * newline *inside* a quoted cell (common in Excel/Sheets exports — e.g. a
 * bilingual header like "Customer Name\nNombre del Cliente") stays part of that
 * cell instead of shattering the row. Returns records → cells.
 */
function tokenizeDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else if (ch === "\r") {
      // ignore — handled by the \n branch (covers \r\n and lone \r via lookahead)
      if (text[i + 1] !== "\n") {
        row.push(cell);
        cell = "";
        rows.push(row);
        row = [];
      }
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  // Collapse whitespace/line breaks inside cells and drop fully-empty records.
  return rows
    .map((cells) => cells.map((value) => value.replace(/\s+/g, " ").trim()))
    .filter((cells) => cells.some((value) => value.length > 0));
}

/** Pick the most likely delimiter by counting candidates outside the noise. */
function detectDelimiter(text: string): string {
  const sample = text.slice(0, 5000);
  let tabs = 0;
  let semis = 0;
  let commas = 0;
  for (const ch of sample) {
    if (ch === "\t") tabs += 1;
    else if (ch === ";") semis += 1;
    else if (ch === ",") commas += 1;
  }
  if (tabs > 0 && tabs >= commas && tabs >= semis) return "\t";
  if (semis > commas) return ";";
  return ",";
}

function parseCompareRows(text: string): CompareRow[] {
  const clean = text.replace(/^﻿/, ""); // strip BOM from Excel/Sheets exports
  if (!clean.trim()) {
    return [];
  }
  const delimiter = detectDelimiter(clean);
  const records = tokenizeDelimited(clean, delimiter);
  if (!records.length) {
    return [];
  }

  const headerCells = records[0].map((cell) => cell.toLowerCase());
  const hasHeader = headerCells.some((cell) =>
    /name|phone|email|date|source|number|caller|contact|nombre|cliente|tel|correo|fecha|fuente/.test(cell),
  );
  const findCol = (...needles: string[]) => {
    for (const needle of needles) {
      const index = headerCells.findIndex((cell) => cell.includes(needle));
      if (index >= 0) {
        return index;
      }
    }
    return -1;
  };
  const idx = hasHeader
    ? {
        // English + Spanish header synonyms (bilingual exports are common here).
        name: findCol("name", "caller", "contact", "full", "nombre", "cliente"),
        phone: findCol("phone", "mobile", "cell", "tel", "número", "numero", "number"),
        email: findCol("email", "e-mail", "correo"),
        source: findCol("source", "channel", "medium", "fuente"),
        date: findCol("date", "time", "received", "fecha"),
      }
    : { name: 0, phone: 1, email: 2, source: 3, date: 4 };
  const dataRecords = hasHeader ? records.slice(1) : records;

  return dataRecords
    .map((parts) => {
      const at = (i: number) => (i >= 0 && i < parts.length ? parts[i] : "");
      return {
        name: at(idx.name) || undefined,
        phone: at(idx.phone) || undefined,
        email: at(idx.email) || undefined,
        source: at(idx.source) || undefined,
        date: at(idx.date) || undefined,
      };
    })
    .filter((row) => row.name || row.phone || row.email);
}

function matchLead(row: CompareRow, leads: VerifiedLead[]): VerifiedLead | null {
  const phone = normPhone(row.phone);
  const email = normEmail(row.email);
  return (
    leads.find((lead) => (phone && normPhone(lead.phone) === phone) || (email && normEmail(lead.email) === email)) ||
    null
  );
}

/**
 * Compare a pasted / uploaded list of leads against what GoHighLevel pulled.
 * Read-only report (Found / Not found), then a gated bulk-add of only the
 * selected "Not found" rows as manual leads.
 */
function CompareListPanel({
  leads,
  disabled,
  onAddSelected,
}: {
  leads: VerifiedLead[];
  disabled?: boolean;
  onAddSelected: (rows: CompareAddRow[]) => void;
}) {
  const [text, setText] = useState("");
  const [results, setResults] = useState<Array<{ row: CompareRow; match: VerifiedLead | null }> | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  function runCompare(source?: string) {
    const rows = parseCompareRows(source ?? text);
    setResults(rows.map((row) => ({ row, match: matchLead(row, leads) })));
    setSelected(new Set());
  }

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === "string" ? reader.result : "";
      setText(content);
      runCompare(content);
    };
    reader.readAsText(file);
  }

  const rows = results || [];
  const foundCount = rows.filter((r) => r.match).length;
  const notFoundIndexes = rows.map((r, i) => (r.match ? -1 : i)).filter((i) => i >= 0);
  const parsedPreview = text.trim() ? parseCompareRows(text).length : 0;

  function toggle(index: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  function addSelected() {
    const toAdd: CompareAddRow[] = rows
      .filter((_, index) => selected.has(index) && !rows[index].match)
      .map(({ row }) => ({
        name: row.name,
        phone: row.phone,
        email: row.email,
        receivedAt: row.date,
        source: row.source || "Compared list",
        status: "valid",
        category: "valid_new_lead",
      }));
    if (toAdd.length) {
      onAddSelected(toAdd);
      setSelected(new Set());
    }
  }

  return (
    <div className="space-y-3 rounded-[24px] border border-white/8 bg-black/20 p-5">
      <div className="flex items-center gap-2 text-white">
        <ClipboardCheck className="h-4 w-4" />
        <p className="text-sm font-semibold">Compare a list against GoHighLevel</p>
      </div>
      <p className="text-xs text-slate-500">
        Paste rows from Excel/Google Sheets, or upload a .csv. Columns:{" "}
        <span className="text-slate-300">name, phone, email, source, date</span> (a header row is detected
        automatically). Each row is matched to the pulled leads by phone or email.
      </p>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={4}
        placeholder={"name, phone, email, source, date\nJane Doe, (555) 123-4567, jane@email.com, Meta Ads, 2026-07-12"}
        className="w-full rounded-2xl border border-white/12 bg-black/30 px-4 py-3 text-sm text-slate-100 outline-none focus:border-white/30"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => runCompare()}
          disabled={!text.trim()}
          style={{ color: "#0d1625" }}
          className="inline-flex items-center gap-2 rounded-full border border-[#d7f5ec]/20 bg-[#d7f5ec] px-4 py-2 text-sm font-semibold text-[#0d1625] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          <ClipboardCheck className="h-4 w-4" />
          Compare
        </button>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/12 bg-white/4 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/8">
          <Upload className="h-4 w-4" />
          Upload .csv
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                onFile(file);
              }
              event.target.value = "";
            }}
          />
        </label>
        {text.trim() ? (
          <span className="text-xs text-slate-400">{parsedPreview} row{parsedPreview === 1 ? "" : "s"} ready</span>
        ) : null}
      </div>

      {leads.length === 0 ? (
        <p className="rounded-2xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-xs text-amber-200/90">
          No leads are loaded yet, so every row will come back “Not found.” Run <span className="font-semibold">Verify</span>{" "}
          or <span className="font-semibold">Refresh from sources</span> first, then compare.
        </p>
      ) : null}

      {results ? (
        rows.length === 0 ? (
          <p className="text-sm text-slate-400">
            No rows detected. Make sure the first columns are name, phone, email — or include a header row.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-200">
              <span className="font-semibold text-emerald-200">{foundCount}</span> of {rows.length} found in
              GoHighLevel · <span className="font-semibold text-amber-200">{notFoundIndexes.length}</span> not found
            </p>
            <div className="overflow-x-auto rounded-[20px] border border-white/8 bg-black/20">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    <th className="px-4 py-3 font-medium">Your row</th>
                    <th className="px-4 py-3 font-medium">Result</th>
                    <th className="px-4 py-3 font-medium">Add</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((result, index) => (
                    <tr key={index} className="border-t border-white/6 align-top">
                      <td className="px-4 py-3">
                        <p className="text-white">{result.row.name || "—"}</p>
                        <p className="text-xs text-slate-400">
                          {result.row.phone || result.row.email || "no contact info"}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {result.match ? (
                          <span className="inline-flex items-center gap-1 text-emerald-200">
                            <Check className="h-3.5 w-3.5" /> Found
                            <span className="ml-1 text-xs text-slate-400">
                              ({result.match.name || result.match.phone || result.match.email})
                            </span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-200">
                            <X className="h-3.5 w-3.5" /> Not found
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {result.match ? (
                          <span className="text-slate-600">—</span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={selected.has(index)}
                            onChange={() => toggle(index)}
                            className="h-4 w-4 accent-[#d7f5ec]"
                            aria-label="Select to add as manual lead"
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={addSelected}
              disabled={disabled || selected.size === 0}
              style={{ color: "#0d1625" }}
              className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white px-4 py-2 text-sm font-semibold text-[#0d1625] transition hover:bg-[#d7f5ec] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="h-4 w-4" />
              Add {selected.size || ""} selected as manual lead{selected.size === 1 ? "" : "s"}
            </button>
          </div>
        )
      ) : null}
    </div>
  );
}
