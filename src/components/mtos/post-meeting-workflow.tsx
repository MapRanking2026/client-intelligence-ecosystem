"use client";

import { useEffect, useState, useTransition } from "react";
import {
  CheckCircle2,
  Gauge,
  LoaderCircle,
  Mail,
  Plus,
  ShieldCheck,
  Sparkles,
  Ticket,
  Trash2,
} from "lucide-react";

import type {
  BillingChangeType,
  DraftTicket,
  MonthlyTouchRecord,
  PostMeetingReview,
  QaReview,
  RiskRegisterEntry,
  StakeholderMapEntry,
  TicketDepartment,
  TicketPriority,
  TicketType,
} from "@/src/lib/mtos-data";

const DEPARTMENTS: TicketDepartment[] = ["SEO", "Web Design", "Ads", "Account Manager", "Other"];

interface EditableTicket {
  id: string;
  title: string;
  description: string;
  department: TicketDepartment;
  /** ClickUp member id picked from the dropdown; undefined = unassigned. */
  assigneeId?: number;
  /** ClickUp Business Name option id picked from the dropdown; undefined = none. */
  businessOptionId?: string;
  priority: TicketPriority;
  timeEstimateMinutes: number;
  /** Optional explicit due date (YYYY-MM-DD); blank = auto from priority. */
  dueDate?: string;
  ticketType: TicketType;
  billingChangeType?: BillingChangeType;
  /** For billing tickets: the date the change was requested (YYYY-MM-DD). */
  dateRequested?: string;
  decision?: "approved" | "declined";
}

const BILLING_TYPES: BillingChangeType[] = [
  "Upsell",
  "Downsell",
  "New Sale",
  "Pause",
  "Cancel",
  "Payment Failed",
];

const PRIORITIES: { value: TicketPriority; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

const TIME_ESTIMATES: { minutes: number; label: string }[] = [
  { minutes: 30, label: "30m" },
  { minutes: 60, label: "1h" },
  { minutes: 120, label: "2h" },
  { minutes: 180, label: "3h" },
  { minutes: 240, label: "4h" },
  { minutes: 360, label: "6h" },
  { minutes: 480, label: "8h" },
];

interface ClickUpMemberOption {
  id: number;
  name: string;
}

interface ClickUpBusinessOption {
  id: string;
  name: string;
}

// Native <option> elements don't reliably honor Tailwind classes across browsers,
// so force a readable dark background + light text inline (fixes blue-on-blue).
const OPTION_STYLE = { backgroundColor: "#0d1625", color: "#e2e8f0" } as const;

// Client Intelligence option sets (mirror the ClickUp Risk Register / Stakeholder Map fields).
const CLIENT_TYPES = ["Direct", "White Label"] as const;
const CASE_STATUSES = ["Watching", "Working", "Requested Cancellation", "Resolved-Healthy"] as const;
const YES_NO = ["Yes", "No"] as const;
const YES_NO_MAYBE = ["Yes", "No", "maybe"] as const;
const YES_NO_KINDOF = ["Yes", "No", "kind of"] as const;
const RISK_CATEGORIES = ["Communication", "Expectations", "Gen. Business", "Product", "Onboarding"] as const;
const COMM_PREFS = ["Phone", "Email", "Face-to-Face", "Text/Chat"] as const;
const LITERACIES = ["Low", "Medium", "High"] as const;

const fieldInputClass =
  "mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200 outline-none placeholder:text-slate-500";
const fieldLabelClass = "text-[11px] uppercase tracking-[0.2em] text-slate-400";

function FieldSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  placeholder?: string;
}) {
  return (
    <div>
      <label className={fieldLabelClass}>{label}</label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{ color: "#e2e8f0" }}
        className={fieldInputClass}
      >
        {placeholder ? (
          <option value="" style={OPTION_STYLE}>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option} value={option} style={OPTION_STYLE}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label className={fieldLabelClass}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        style={type === "date" ? { color: "#e2e8f0", colorScheme: "dark" } : undefined}
        className={fieldInputClass}
      />
    </div>
  );
}

function FieldTextarea({
  label,
  value,
  onChange,
  rows = 2,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <div>
      <label className={fieldLabelClass}>{label}</label>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        placeholder={placeholder}
        className={fieldInputClass}
      />
    </div>
  );
}

interface PostMeetingWorkflowProps {
  touchId: string;
  postMeeting?: PostMeetingReview;
  qaReview?: QaReview;
}

interface TouchActionResponse {
  data?: {
    touch?: MonthlyTouchRecord;
  };
  error?: string;
}

async function postAction(touchId: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/monthly-touches/${touchId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as TouchActionResponse;
  if (!response.ok) {
    throw new Error(payload.error || "That action failed");
  }
  return payload;
}

function departmentTone(department: DraftTicket["department"]) {
  switch (department) {
    case "SEO":
      return "border-emerald-400/15 bg-emerald-500/10 text-emerald-100";
    case "Web Design":
      return "border-sky-400/15 bg-sky-500/10 text-sky-100";
    case "Ads":
      return "border-amber-400/15 bg-amber-500/10 text-amber-100";
    case "Account Manager":
      return "border-violet-400/15 bg-violet-500/10 text-violet-100";
    default:
      return "border-white/10 bg-white/5 text-slate-200";
  }
}

export function PostMeetingWorkflow({ touchId, postMeeting, qaReview }: PostMeetingWorkflowProps) {
  const [transcript, setTranscript] = useState(postMeeting?.transcript || "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [tickets, setTickets] = useState<EditableTicket[]>(() =>
    (postMeeting?.draftTickets || []).map((ticket) => ({
      id: ticket.id,
      title: ticket.title,
      description: ticket.description,
      department: ticket.department,
      assigneeId: ticket.assigneeId,
      businessOptionId: ticket.businessOptionId,
      priority: ticket.priority || "normal",
      timeEstimateMinutes: ticket.timeEstimateMinutes ?? 60,
      dueDate: ticket.dueDate,
      ticketType: ticket.ticketType || "regular",
      billingChangeType: ticket.billingChangeType,
      dateRequested: ticket.dateRequested,
      decision: ticket.status === "pending" ? undefined : (ticket.status as "approved" | "declined"),
    })),
  );
  const [members, setMembers] = useState<ClickUpMemberOption[]>([]);
  const [membersReason, setMembersReason] = useState<string | null>(null);
  const [businesses, setBusinesses] = useState<ClickUpBusinessOption[]>([]);
  const [businessesReason, setBusinessesReason] = useState<string | null>(null);
  const [emailSubject, setEmailSubject] = useState(postMeeting?.clientEmail?.subject || "");
  const [emailBody, setEmailBody] = useState(postMeeting?.clientEmail?.body || "");
  const [approveEmail, setApproveEmail] = useState(postMeeting?.clientEmail?.status === "approved");
  const [victorNote, setVictorNote] = useState("");

  // Client Intelligence: editable Risk Register + Stakeholder Map entries (present when at risk).
  const clientIntelligence = postMeeting?.clientIntelligence;
  const [riskEntry, setRiskEntry] = useState<RiskRegisterEntry>(() => clientIntelligence?.riskRegister || {});
  const [stakeEntry, setStakeEntry] = useState<StakeholderMapEntry>(() => clientIntelligence?.stakeholderMap || {});
  const [riskDecision, setRiskDecision] = useState<"approved" | "declined" | undefined>(
    clientIntelligence?.riskRegisterStatus === "pending" ? undefined : clientIntelligence?.riskRegisterStatus,
  );
  const [stakeDecision, setStakeDecision] = useState<"approved" | "declined" | undefined>(
    clientIntelligence?.stakeholderMapStatus === "pending" ? undefined : clientIntelligence?.stakeholderMapStatus,
  );
  function updateRisk(patch: Partial<RiskRegisterEntry>) {
    setRiskEntry((prev) => ({ ...prev, ...patch }));
  }
  function updateStake(patch: Partial<StakeholderMapEntry>) {
    setStakeEntry((prev) => ({ ...prev, ...patch }));
  }
  // Risk Score = count of the six flags marked "Yes"; Tier follows the count (rubric).
  const riskFlagCount = [
    riskEntry.money,
    riskEntry.responsiveness,
    riskEntry.lifeChange,
    riskEntry.technical,
    riskEntry.otherAgency,
    riskEntry.performance,
  ].filter((value) => value === "Yes").length;
  const derivedRiskTier =
    riskFlagCount >= 6 ? "Critical" : riskFlagCount >= 4 ? "High" : riskFlagCount >= 2 ? "Medium" : riskFlagCount === 1 ? "Low" : "Healthy";

  // Load the real ClickUp members for the assignee dropdown. Only needed while the
  // AM is still editing (before decisions are applied).
  const analysisEditable = postMeeting?.status === "draft_ready";
  useEffect(() => {
    if (!analysisEditable) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/integrations/clickup/members");
        const payload = (await response.json()) as {
          data?: {
            members?: ClickUpMemberOption[];
            membersReason?: string;
            businesses?: ClickUpBusinessOption[];
            businessesReason?: string;
          };
          error?: string;
        };
        if (cancelled) return;
        setMembers(payload.data?.members || []);
        setMembersReason(payload.data?.membersReason || payload.error || null);
        setBusinesses(payload.data?.businesses || []);
        setBusinessesReason(payload.data?.businessesReason || payload.error || null);
      } catch {
        if (!cancelled) {
          setMembersReason("Couldn't load ClickUp members.");
          setBusinessesReason("Couldn't load ClickUp businesses.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [analysisEditable]);

  function updateTicket(id: string, patch: Partial<EditableTicket>) {
    setTickets((prev) => prev.map((ticket) => (ticket.id === id ? { ...ticket, ...patch } : ticket)));
  }
  function removeTicket(id: string) {
    setTickets((prev) => prev.filter((ticket) => ticket.id !== id));
  }
  // The client's business, inferred from the existing drafts, so a newly added
  // ticket starts under the same business by default (still editable).
  const defaultBusinessOptionId = tickets.find((ticket) => ticket.businessOptionId)?.businessOptionId;
  function addTicket() {
    const id = globalThis.crypto?.randomUUID?.() || `new-${Date.now()}-${tickets.length}`;
    setTickets((prev) => [
      ...prev,
      {
        id,
        title: "",
        description: "",
        department: "Other",
        assigneeId: undefined,
        businessOptionId: defaultBusinessOptionId,
        priority: "normal",
        timeEstimateMinutes: 60,
        ticketType: "regular",
        decision: "approved",
      },
    ]);
  }

  // Confirm is gated: every ticket must be decided, approved tickets need content,
  // and an approved email needs a subject + body.
  const allTicketsDecided = tickets.every(
    (ticket) => ticket.decision === "approved" || ticket.decision === "declined",
  );
  const approvedTicketsValid = tickets.every((ticket) => {
    if (ticket.decision !== "approved") return true;
    if (!ticket.title.trim() || !ticket.description.trim()) return false;
    // Billing tickets need a change type before they can be filed.
    if (ticket.ticketType === "billing" && !ticket.billingChangeType) return false;
    return true;
  });
  const emailValid = !approveEmail || Boolean(emailSubject.trim() && emailBody.trim());
  const confirmDisabled = isPending || !allTicketsDecided || !approvedTicketsValid || !emailValid;

  function run(action: string, body: Record<string, unknown>) {
    startTransition(async () => {
      setError(null);
      setActiveAction(action);
      try {
        await postAction(touchId, body);
        globalThis.location.reload();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "That action failed");
      } finally {
        setActiveAction(null);
      }
    });
  }

  const analysisReady = postMeeting?.status === "draft_ready" || postMeeting?.status === "approved";
  const decisionsApplied = postMeeting?.status === "approved";

  return (
    <div className="space-y-6">
      {/* Step 1: transcript in, analysis out */}
      <div className="rounded-[24px] border border-white/8 bg-black/20 p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
          Step 1 -- Meeting transcript
        </p>
        <p className="mt-1 text-sm text-slate-300">
          Paste the meeting transcript (from Gemini notes, Zoom, or a manual recap) to generate the
          internal recap, draft follow-up tickets, and a client email draft -- all grounded only in
          what was actually said.
        </p>
        <textarea
          value={transcript}
          onChange={(event) => setTranscript(event.target.value)}
          disabled={analysisReady}
          rows={6}
          placeholder="Paste the full transcript here..."
          className="mt-3 w-full rounded-2xl border border-white/10 bg-black/30 p-3 text-sm text-slate-200 outline-none placeholder:text-slate-500 disabled:opacity-60"
        />
        {!analysisReady ? (
          <button
            type="button"
            onClick={() => run("analyze_transcript", { action: "analyze_transcript", transcript })}
            disabled={isPending || transcript.trim().length < 40}
            style={{ color: "#0d1625" }}
            className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#d7f5ec]/20 bg-[#d7f5ec] px-4 py-2 text-sm font-semibold text-[#0d1625] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending && activeAction === "analyze_transcript" ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Analyze transcript
          </button>
        ) : (
          <p className="mt-3 text-xs text-slate-500">Analyzed {postMeeting?.analyzedAt ? new Date(postMeeting.analyzedAt).toLocaleString("en-US") : ""}</p>
        )}
      </div>

      {error ? <p className="text-sm text-rose-300">{error}</p> : null}

      {analysisReady && postMeeting ? (
        <>
          <div className="rounded-[24px] border border-white/8 bg-black/20 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Internal recap</p>
            <p className="mt-2 text-sm leading-6 text-slate-200">{postMeeting.recapSummary}</p>
            {postMeeting.extractedCommitments?.length ? (
              <div className="mt-4 space-y-2">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Commitments captured</p>
                {postMeeting.extractedCommitments.map((item) => (
                  <div key={item} className="rounded-xl border border-white/8 bg-white/4 px-3 py-2 text-sm text-slate-200">
                    {item}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* Step 2: draft tickets + email, AM edits + approval gate */}
          <div className="rounded-[24px] border border-white/8 bg-black/20 p-5">
            <div className="flex items-center gap-2">
              <Ticket className="h-4 w-4 text-[#d7f5ec]" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                Step 2 -- Draft tickets (edit &amp; approve)
              </p>
            </div>
            {!decisionsApplied ? (
              <p className="mt-1 text-xs text-slate-500">
                Business and assignee are pre-filled and editable — change the business for accounts that
                bill multiple profiles under one parent. Edit any ticket&apos;s content or department, add or
                remove tickets, then approve the ones to file. Approved tickets are created in ClickUp when
                you confirm; declined ones are kept as a record only.
              </p>
            ) : null}

            {/* Editable list before decisions are applied */}
            {!decisionsApplied ? (
              <div className="mt-3 space-y-3">
                {tickets.map((ticket) => (
                  <div key={ticket.id} className="space-y-3 rounded-2xl border border-white/8 bg-white/4 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={ticket.ticketType}
                          onChange={(event) =>
                            updateTicket(ticket.id, { ticketType: event.target.value as TicketType })
                          }
                          style={{ color: "#e2e8f0" }}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold outline-none ${
                            ticket.ticketType === "billing"
                              ? "border-fuchsia-400/30 bg-fuchsia-500/15 text-fuchsia-100"
                              : "border-white/10 bg-white/5 text-slate-200"
                          }`}
                        >
                          <option value="regular" style={OPTION_STYLE}>
                            Regular ticket
                          </option>
                          <option value="billing" style={OPTION_STYLE}>
                            Billing change
                          </option>
                        </select>
                        {ticket.ticketType === "regular" ? (
                          <select
                            value={ticket.department}
                            onChange={(event) =>
                              updateTicket(ticket.id, { department: event.target.value as TicketDepartment })
                            }
                            className={`rounded-full border px-3 py-1.5 text-xs font-medium outline-none ${departmentTone(ticket.department)}`}
                          >
                            {DEPARTMENTS.map((department) => (
                              <option key={department} value={department} style={OPTION_STYLE}>
                                {department}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="rounded-full border border-fuchsia-400/20 bg-fuchsia-500/10 px-2 py-1 text-[11px] text-fuchsia-100">
                            Routed to Carlos
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => updateTicket(ticket.id, { decision: "approved" })}
                          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                            ticket.decision === "approved"
                              ? "border-emerald-400/30 bg-emerald-500/20 text-emerald-100"
                              : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                          }`}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => updateTicket(ticket.id, { decision: "declined" })}
                          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                            ticket.decision === "declined"
                              ? "border-rose-400/30 bg-rose-500/20 text-rose-100"
                              : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                          }`}
                        >
                          Decline
                        </button>
                        <button
                          type="button"
                          onClick={() => removeTicket(ticket.id)}
                          aria-label="Delete ticket"
                          className="rounded-full border border-white/10 bg-white/5 p-1.5 text-slate-400 transition hover:border-rose-400/30 hover:bg-rose-500/20 hover:text-rose-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <input
                      value={ticket.title}
                      onChange={(event) => updateTicket(ticket.id, { title: event.target.value })}
                      placeholder="Ticket title"
                      className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm font-semibold text-white outline-none placeholder:text-slate-500"
                    />
                    <textarea
                      value={ticket.description}
                      onChange={(event) => updateTicket(ticket.id, { description: event.target.value })}
                      rows={3}
                      placeholder="What needs to happen, with any context the team needs..."
                      className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200 outline-none placeholder:text-slate-500"
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Assignee</label>
                        <select
                          value={ticket.assigneeId != null ? String(ticket.assigneeId) : ""}
                          onChange={(event) =>
                            updateTicket(ticket.id, {
                              assigneeId: event.target.value ? Number(event.target.value) : undefined,
                            })
                          }
                          disabled={!members.length}
                          style={{ color: "#e2e8f0" }}
                          className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200 outline-none disabled:opacity-60"
                        >
                          <option value="" style={OPTION_STYLE}>
                            Unassigned
                          </option>
                          {members.map((member) => (
                            <option key={member.id} value={member.id} style={OPTION_STYLE}>
                              {member.name}
                            </option>
                          ))}
                        </select>
                        {!members.length ? (
                          <p className="mt-1 text-xs text-slate-500">
                            {membersReason || "No assignable ClickUp members found — leave unassigned."}
                          </p>
                        ) : null}
                      </div>
                      <div>
                        <label className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Business</label>
                        <select
                          value={ticket.businessOptionId || ""}
                          onChange={(event) =>
                            updateTicket(ticket.id, { businessOptionId: event.target.value || undefined })
                          }
                          disabled={!businesses.length}
                          style={{ color: "#e2e8f0" }}
                          className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200 outline-none disabled:opacity-60"
                        >
                          <option value="" style={OPTION_STYLE}>
                            No business selected
                          </option>
                          {businesses.map((business) => (
                            <option key={business.id} value={business.id} style={OPTION_STYLE}>
                              {business.name}
                            </option>
                          ))}
                        </select>
                        {!businesses.length ? (
                          <p className="mt-1 text-xs text-slate-500">
                            {businessesReason || "No ClickUp businesses found."}
                          </p>
                        ) : businesses.length && !ticket.businessOptionId ? (
                          <p className="mt-1 rounded-lg border border-amber-400/30 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200">
                            ⚠ Couldn&apos;t match this to a business — please select the correct one. (Some
                            profiles bill under a parent account, e.g. Gables Plumbing → Sparkle Plumbing.)
                          </p>
                        ) : null}
                      </div>
                    </div>

                    {ticket.ticketType === "billing" ? (
                      /* Billing change fields -- match the ClickUp billing-change form */
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                            Change type
                          </label>
                          <select
                            value={ticket.billingChangeType || ""}
                            onChange={(event) =>
                              updateTicket(ticket.id, {
                                billingChangeType: (event.target.value || undefined) as BillingChangeType | undefined,
                              })
                            }
                            style={{ color: "#e2e8f0" }}
                            className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200 outline-none"
                          >
                            <option value="" style={OPTION_STYLE}>
                              Select type…
                            </option>
                            {BILLING_TYPES.map((type) => (
                              <option key={type} value={type} style={OPTION_STYLE}>
                                {type}
                              </option>
                            ))}
                          </select>
                          {ticket.decision === "approved" && !ticket.billingChangeType ? (
                            <p className="mt-1 text-xs text-amber-200">Pick a change type to file this ticket.</p>
                          ) : null}
                        </div>
                        <div>
                          <label className="text-[11px] uppercase tracking-[0.2em] text-slate-400">
                            Date requested
                          </label>
                          <input
                            type="date"
                            value={ticket.dateRequested || ""}
                            onChange={(event) =>
                              updateTicket(ticket.id, { dateRequested: event.target.value || undefined })
                            }
                            style={{ color: "#e2e8f0", colorScheme: "dark" }}
                            className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200 outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Due date</label>
                          <input
                            type="date"
                            value={ticket.dueDate || ""}
                            onChange={(event) =>
                              updateTicket(ticket.id, { dueDate: event.target.value || undefined })
                            }
                            style={{ color: "#e2e8f0", colorScheme: "dark" }}
                            className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200 outline-none"
                          />
                        </div>
                      </div>
                    ) : (
                    /* Priority / Time estimate / Due date -- required by the ClickUp ticket form */
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <label className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Priority</label>
                        <select
                          value={ticket.priority}
                          onChange={(event) =>
                            updateTicket(ticket.id, { priority: event.target.value as TicketPriority })
                          }
                          style={{ color: "#e2e8f0" }}
                          className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200 outline-none"
                        >
                          {PRIORITIES.map((option) => (
                            <option key={option.value} value={option.value} style={OPTION_STYLE}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Time estimate</label>
                        <select
                          value={String(ticket.timeEstimateMinutes)}
                          onChange={(event) =>
                            updateTicket(ticket.id, { timeEstimateMinutes: Number(event.target.value) })
                          }
                          style={{ color: "#e2e8f0" }}
                          className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200 outline-none"
                        >
                          {(TIME_ESTIMATES.some((option) => option.minutes === ticket.timeEstimateMinutes)
                            ? TIME_ESTIMATES
                            : [
                                {
                                  minutes: ticket.timeEstimateMinutes,
                                  label:
                                    ticket.timeEstimateMinutes % 60 === 0
                                      ? `${ticket.timeEstimateMinutes / 60}h`
                                      : `${ticket.timeEstimateMinutes}m`,
                                },
                                ...TIME_ESTIMATES,
                              ]
                          ).map((option) => (
                            <option key={option.minutes} value={option.minutes} style={OPTION_STYLE}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Due date</label>
                        <input
                          type="date"
                          value={ticket.dueDate || ""}
                          onChange={(event) => updateTicket(ticket.id, { dueDate: event.target.value || undefined })}
                          style={{ color: "#e2e8f0", colorScheme: "dark" }}
                          className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200 outline-none"
                        />
                        <p className="mt-1 text-[11px] text-slate-500">Blank = auto from priority.</p>
                      </div>
                    </div>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addTicket}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/10"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add ticket
                </button>
              </div>
            ) : (
              /* Read-only summary once decisions are applied */
              <div className="mt-3 space-y-3">
                {(postMeeting.draftTickets || []).map((ticket) => (
                  <div key={ticket.id} className="rounded-2xl border border-white/8 bg-white/4 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <span
                          className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-medium ${
                            ticket.ticketType === "billing"
                              ? "border-fuchsia-400/30 bg-fuchsia-500/15 text-fuchsia-100"
                              : departmentTone(ticket.department)
                          }`}
                        >
                          {ticket.ticketType === "billing"
                            ? `Billing${ticket.billingChangeType ? ` · ${ticket.billingChangeType}` : ""}`
                            : ticket.department}
                        </span>
                        <p className="mt-2 text-sm font-semibold text-white">{ticket.title}</p>
                        <p className="mt-1 text-sm text-slate-300">{ticket.description}</p>
                        {ticket.businessName ? (
                          <p className="mt-1 text-xs text-slate-400">Business: {ticket.businessName}</p>
                        ) : null}
                        {ticket.assignee ? (
                          <p className="mt-1 text-xs text-slate-400">Assignee: {ticket.assignee}</p>
                        ) : null}
                        {ticket.priority || ticket.timeEstimateMinutes ? (
                          <p className="mt-1 text-xs text-slate-400">
                            {ticket.priority ? `Priority: ${ticket.priority}` : ""}
                            {ticket.priority && ticket.timeEstimateMinutes ? " · " : ""}
                            {ticket.timeEstimateMinutes ? `Estimate: ${ticket.timeEstimateMinutes / 60}h` : ""}
                          </p>
                        ) : null}
                        {ticket.executionNote ? (
                          <p className="mt-2 text-xs text-amber-200">{ticket.executionNote}</p>
                        ) : null}
                        {ticket.clickupTaskUrl ? (
                          <a
                            href={ticket.clickupTaskUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-block text-xs text-[#d7f5ec] underline"
                          >
                            View in ClickUp
                          </a>
                        ) : null}
                      </div>
                      <span
                        className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${
                          ticket.status === "approved"
                            ? "border-emerald-400/30 bg-emerald-500/20 text-emerald-100"
                            : "border-rose-400/30 bg-rose-500/20 text-rose-100"
                        }`}
                      >
                        {ticket.status === "approved" ? "Approved" : "Declined"}
                      </span>
                    </div>
                  </div>
                ))}
                {!(postMeeting.draftTickets || []).length ? (
                  <p className="text-sm text-slate-400">No follow-up tickets were filed from this transcript.</p>
                ) : null}
              </div>
            )}
          </div>

          <div className="rounded-[24px] border border-white/8 bg-black/20 p-5">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-[#d7f5ec]" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                Client follow-up email
              </p>
            </div>
            {!decisionsApplied ? (
              <div className="mt-3 space-y-3 rounded-2xl border border-white/8 bg-white/4 p-4">
                <div>
                  <label className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Subject</label>
                  <input
                    value={emailSubject}
                    onChange={(event) => setEmailSubject(event.target.value)}
                    placeholder="Email subject"
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm font-semibold text-white outline-none placeholder:text-slate-500"
                  />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Body</label>
                  <textarea
                    value={emailBody}
                    onChange={(event) => setEmailBody(event.target.value)}
                    rows={10}
                    placeholder="Write or refine the follow-up email to the client..."
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm leading-6 text-slate-200 outline-none placeholder:text-slate-500"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={approveEmail}
                    onChange={(event) => setApproveEmail(event.target.checked)}
                    className="h-4 w-4 rounded border-white/20 bg-black/30"
                  />
                  Approve this draft to send to the client
                </label>
                {approveEmail && !emailValid ? (
                  <p className="text-xs text-amber-200">Add a subject and body before approving the email.</p>
                ) : null}
              </div>
            ) : postMeeting.clientEmail ? (
              <div className="mt-3 rounded-2xl border border-white/8 bg-white/4 p-4">
                <p className="text-sm font-semibold text-white">{postMeeting.clientEmail.subject}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{postMeeting.clientEmail.body}</p>
                <p className="mt-3 text-xs text-slate-400">
                  {postMeeting.clientEmail.status === "approved"
                    ? "Approved -- copy this into an email to the client (sending isn't wired to a connected mailbox yet)."
                    : "Not approved."}
                </p>
              </div>
            ) : null}
          </div>

          {/* Client Intelligence -- report (always saved with the client) + risk-gated forms */}
          {clientIntelligence ? (
            <div className="rounded-[24px] border border-white/8 bg-black/20 p-5">
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4 text-[#d7f5ec]" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                  Client intelligence
                </p>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                This report is saved with the client&apos;s record (never posted to ClickUp). The Risk
                Register and Stakeholder Map are filled ONLY when a risk is detected — and only after you
                approve.
              </p>

              {clientIntelligence.report ? (
                <div className="mt-3 rounded-2xl border border-white/8 bg-white/4 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Report</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-200">
                    {clientIntelligence.report}
                  </p>
                </div>
              ) : null}

              {clientIntelligence.errorMessage ? (
                <div className="mt-3 space-y-2 rounded-2xl border border-amber-400/20 bg-amber-500/5 p-3">
                  <p className="text-sm text-amber-200">
                    This step didn&apos;t finish last time: {clientIntelligence.errorMessage}
                  </p>
                  <button
                    type="button"
                    onClick={() => run("retry_client_intelligence", { action: "retry_client_intelligence" })}
                    disabled={isPending}
                    className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isPending && activeAction === "retry_client_intelligence" ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    Retry client intelligence
                  </button>
                </div>
              ) : null}

              {/* Stakeholder Map -- ALWAYS: every client must be listed & kept current */}
              {clientIntelligence.stakeholderMap ? (
                <div className="mt-4 space-y-3 rounded-2xl border border-white/8 bg-white/4 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-white">Stakeholder Map</p>
                      {clientIntelligence.stakeholderUpToDate ? (
                        <p className="mt-0.5 text-xs text-emerald-200">
                          Client already listed &amp; up to date — approve only to push changes.
                        </p>
                      ) : (
                        <p className="mt-0.5 text-xs text-slate-400">Updates this client&apos;s existing row.</p>
                      )}
                    </div>
                    {clientIntelligence.stakeholderMapStatus === "approved" ? (
                      <span className="rounded-full border border-emerald-400/30 bg-emerald-500/20 px-3 py-1 text-xs text-emerald-100">
                        Updated
                      </span>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setStakeDecision("approved")}
                          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${stakeDecision === "approved" ? "border-emerald-400/30 bg-emerald-500/20 text-emerald-100" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => setStakeDecision("declined")}
                          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${stakeDecision === "declined" ? "border-rose-400/30 bg-rose-500/20 text-rose-100" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}
                        >
                          Skip
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FieldInput label="Client Name" value={stakeEntry.clientName || ""} onChange={(v) => updateStake({ clientName: v })} />
                    <FieldInput label="Assignee" value={stakeEntry.assignee || ""} onChange={(v) => updateStake({ assignee: v })} />
                    <FieldSelect label="Client Type" value={stakeEntry.clientType || ""} onChange={(v) => updateStake({ clientType: (v || undefined) as StakeholderMapEntry["clientType"] })} options={CLIENT_TYPES} placeholder="Select…" />
                    <FieldInput label="Role / Title" value={stakeEntry.role || ""} onChange={(v) => updateStake({ role: v })} />
                    <FieldSelect label="Communication Preference" value={stakeEntry.communicationPreference || ""} onChange={(v) => updateStake({ communicationPreference: (v || undefined) as StakeholderMapEntry["communicationPreference"] })} options={COMM_PREFS} placeholder="Select…" />
                    <FieldSelect label="Marketing Literacy" value={stakeEntry.marketingLiteracy || ""} onChange={(v) => updateStake({ marketingLiteracy: (v || undefined) as StakeholderMapEntry["marketingLiteracy"] })} options={LITERACIES} placeholder="Select…" />
                  </div>
                  <FieldInput label="Services (comma-separated)" value={(stakeEntry.services || []).join(", ")} onChange={(v) => updateStake({ services: v.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="Map Pack Dominator, GBP +, …" />
                  <FieldTextarea label="Personality" value={stakeEntry.personality || ""} onChange={(v) => updateStake({ personality: v })} rows={2} />
                  <FieldTextarea label="What They Care About" value={stakeEntry.whatTheyCareAbout || ""} onChange={(v) => updateStake({ whatTheyCareAbout: v })} rows={2} />
                  <FieldTextarea label="Known History" value={stakeEntry.knownHistory || ""} onChange={(v) => updateStake({ knownHistory: v })} rows={2} />
                  {clientIntelligence.stakeholderMapTaskUrl ? (
                    <a href={clientIntelligence.stakeholderMapTaskUrl} target="_blank" rel="noreferrer" className="inline-block text-xs text-[#d7f5ec] underline">
                      View in ClickUp
                    </a>
                  ) : null}
                </div>
              ) : null}

              {/* Risk Register -- ONLY when a risk is detected */}
              {clientIntelligence.riskDetected && clientIntelligence.riskRegister ? (
                <div className="mt-4 space-y-3 rounded-2xl border border-rose-400/20 bg-rose-500/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-rose-100">
                      {clientIntelligence.riskResolved
                        ? "Risk Register · resolved — confirm to clear"
                        : `Risk Register${clientIntelligence.riskTier ? ` · ${clientIntelligence.riskTier} risk` : ""}`}
                    </p>
                    {clientIntelligence.riskRegisterStatus === "approved" ? (
                      <span className="rounded-full border border-emerald-400/30 bg-emerald-500/20 px-3 py-1 text-xs text-emerald-100">
                        Registered
                      </span>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setRiskDecision("approved")}
                          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${riskDecision === "approved" ? "border-emerald-400/30 bg-emerald-500/20 text-emerald-100" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => setRiskDecision("declined")}
                          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${riskDecision === "declined" ? "border-rose-400/30 bg-rose-500/20 text-rose-100" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}
                        >
                          Decline
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FieldInput label="Account Manager" value={riskEntry.accountManager || ""} onChange={(v) => updateRisk({ accountManager: v })} />
                    <FieldSelect label="Client Type" value={riskEntry.clientType || ""} onChange={(v) => updateRisk({ clientType: (v || undefined) as RiskRegisterEntry["clientType"] })} options={CLIENT_TYPES} placeholder="Select…" />
                    <FieldSelect label="Case Status" value={riskEntry.caseStatus || ""} onChange={(v) => updateRisk({ caseStatus: (v || undefined) as RiskRegisterEntry["caseStatus"] })} options={CASE_STATUSES} placeholder="Select…" />
                    <div>
                      <label className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Risk Score / Tier (auto)</label>
                      <div className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-200">
                        {riskFlagCount}/6 flags · <span className="font-semibold">{derivedRiskTier}</span>
                      </div>
                    </div>
                    <FieldSelect label="Primary Category" value={riskEntry.primaryCategory || ""} onChange={(v) => updateRisk({ primaryCategory: (v || undefined) as RiskRegisterEntry["primaryCategory"] })} options={RISK_CATEGORIES} placeholder="Select…" />
                    <FieldInput label="Date Flagged" type="date" value={riskEntry.dateFlagged || ""} onChange={(v) => updateRisk({ dateFlagged: v || undefined })} />
                    <FieldInput label="Next Action Owner" value={riskEntry.nextActionOwner || ""} onChange={(v) => updateRisk({ nextActionOwner: v })} />
                    <FieldInput label="Due Date" type="date" value={riskEntry.dueDate || ""} onChange={(v) => updateRisk({ dueDate: v || undefined })} />
                    <FieldInput label="Last Monthly Touch" type="date" value={riskEntry.lastMonthlyTouch || ""} onChange={(v) => updateRisk({ lastMonthlyTouch: v || undefined })} />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <FieldSelect label="Money / Cash Flow" value={riskEntry.money || ""} onChange={(v) => updateRisk({ money: (v || undefined) as RiskRegisterEntry["money"] })} options={YES_NO} />
                    <FieldSelect label="Responsiveness" value={riskEntry.responsiveness || ""} onChange={(v) => updateRisk({ responsiveness: (v || undefined) as RiskRegisterEntry["responsiveness"] })} options={YES_NO} />
                    <FieldSelect label="Life Change" value={riskEntry.lifeChange || ""} onChange={(v) => updateRisk({ lifeChange: (v || undefined) as RiskRegisterEntry["lifeChange"] })} options={YES_NO_MAYBE} />
                    <FieldSelect label="Technical" value={riskEntry.technical || ""} onChange={(v) => updateRisk({ technical: (v || undefined) as RiskRegisterEntry["technical"] })} options={YES_NO} />
                    <FieldSelect label="Other Agency" value={riskEntry.otherAgency || ""} onChange={(v) => updateRisk({ otherAgency: (v || undefined) as RiskRegisterEntry["otherAgency"] })} options={YES_NO_KINDOF} />
                    <FieldSelect label="Performance" value={riskEntry.performance || ""} onChange={(v) => updateRisk({ performance: (v || undefined) as RiskRegisterEntry["performance"] })} options={YES_NO} />
                  </div>
                  <FieldTextarea label="Next Action" value={riskEntry.nextAction || ""} onChange={(v) => updateRisk({ nextAction: v })} rows={2} placeholder="The plan to defuse this risk…" />
                  <FieldTextarea label="Latest Comments" value={riskEntry.latestComments || ""} onChange={(v) => updateRisk({ latestComments: v })} rows={2} placeholder="Quick note (optional)…" />
                  {clientIntelligence.riskRegisterTaskUrl ? (
                    <a href={clientIntelligence.riskRegisterTaskUrl} target="_blank" rel="noreferrer" className="inline-block text-xs text-[#d7f5ec] underline">
                      View in ClickUp
                    </a>
                  ) : null}
                </div>
              ) : !clientIntelligence.errorMessage ? (
                <p className="mt-4 rounded-2xl border border-emerald-400/15 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-100">
                  No risk detected — the Risk Register is skipped for this touch.
                </p>
              ) : null}

              {clientIntelligence.executionNote ? (
                <p className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                  {clientIntelligence.executionNote}
                </p>
              ) : null}

              {clientIntelligence.stakeholderMap || clientIntelligence.riskRegister ? (
                <button
                  type="button"
                  onClick={() =>
                    run("apply_client_intelligence", {
                      action: "apply_client_intelligence",
                      riskRegister:
                        riskDecision && clientIntelligence.riskRegisterStatus !== "approved"
                          ? { ...riskEntry, riskScore: riskFlagCount, riskTier: derivedRiskTier, decision: riskDecision }
                          : undefined,
                      stakeholderMap:
                        stakeDecision && clientIntelligence.stakeholderMapStatus !== "approved"
                          ? { ...stakeEntry, decision: stakeDecision }
                          : undefined,
                    })
                  }
                  disabled={
                    isPending ||
                    (!(riskDecision && clientIntelligence.riskRegisterStatus !== "approved") &&
                      !(stakeDecision && clientIntelligence.stakeholderMapStatus !== "approved"))
                  }
                  style={{ color: "#0d1625" }}
                  className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#d7f5ec]/20 bg-[#d7f5ec] px-4 py-2 text-sm font-semibold text-[#0d1625] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPending && activeAction === "apply_client_intelligence" ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  Apply to ClickUp
                </button>
              ) : null}
            </div>
          ) : null}

          {!decisionsApplied ? (
            <button
              type="button"
              onClick={() =>
                run("apply_post_meeting_decisions", {
                  action: "apply_post_meeting_decisions",
                  tickets: tickets.map((ticket) => ({
                    id: ticket.id,
                    title: ticket.title.trim(),
                    description: ticket.description.trim(),
                    department: ticket.department,
                    assigneeId: ticket.assigneeId,
                    assignee: members.find((member) => member.id === ticket.assigneeId)?.name,
                    businessOptionId: ticket.businessOptionId,
                    businessName: businesses.find((business) => business.id === ticket.businessOptionId)?.name,
                    priority: ticket.priority,
                    timeEstimateMinutes: ticket.timeEstimateMinutes,
                    dueDate: ticket.dueDate || undefined,
                    ticketType: ticket.ticketType,
                    billingChangeType: ticket.ticketType === "billing" ? ticket.billingChangeType : undefined,
                    dateRequested: ticket.ticketType === "billing" ? ticket.dateRequested || undefined : undefined,
                    decision: ticket.decision === "approved" ? "approved" : "declined",
                  })),
                  email: { subject: emailSubject.trim(), body: emailBody, approve: approveEmail },
                })
              }
              disabled={confirmDisabled}
              style={{ color: "#0d1625" }}
              className="inline-flex items-center gap-2 rounded-full border border-[#d7f5ec]/20 bg-[#d7f5ec] px-4 py-2 text-sm font-semibold text-[#0d1625] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending && activeAction === "apply_post_meeting_decisions" ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Confirm decisions
            </button>
          ) : null}
        </>
      ) : null}

      {/* Step 3: QA / Victor gate */}
      {decisionsApplied ? (
        <div className="rounded-[24px] border border-white/8 bg-black/20 p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#d7f5ec]" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
              Step 3 -- QA review and Victor approval
            </p>
          </div>

          {!qaReview || qaReview.status === "not_started" ? (
            <button
              type="button"
              onClick={() => run("generate_qa_review", { action: "generate_qa_review" })}
              disabled={isPending}
              style={{ color: "#0d1625" }}
              className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/12 bg-white px-4 py-2 text-sm font-medium text-[#0d1625] transition hover:bg-[#d7f5ec] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending && activeAction === "generate_qa_review" ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Generate QA review
            </button>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-300">Overall grade</p>
                <span className="rounded-full border border-white/10 bg-white px-3 py-1 text-sm font-semibold text-[#0d1625]">
                  {qaReview.overallGrade}
                </span>
              </div>
              <p className="text-sm leading-6 text-slate-300">{qaReview.summary}</p>
              <div className="space-y-2">
                {(qaReview.scorecard || []).map((category) => (
                  <div key={category.category} className="rounded-xl border border-white/8 bg-white/4 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-white">{category.category}</p>
                      <span className="text-sm font-semibold text-[#d7f5ec]">{category.score}/5</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">{category.notes}</p>
                  </div>
                ))}
              </div>

              {qaReview.status === "pending_victor_approval" ? (
                <div className="space-y-2 rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Victor&apos;s decision</p>
                  <textarea
                    value={victorNote}
                    onChange={(event) => setVictorNote(event.target.value)}
                    rows={2}
                    placeholder="Optional note for the AM..."
                    className="w-full rounded-xl border border-white/10 bg-black/30 p-2 text-sm text-slate-200 outline-none placeholder:text-slate-500"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        run("record_victor_decision", {
                          action: "record_victor_decision",
                          decision: "approved",
                          note: victorNote || undefined,
                        })
                      }
                      disabled={isPending}
                      className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/20 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Approve grade
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        run("record_victor_decision", {
                          action: "record_victor_decision",
                          decision: "changes_requested",
                          note: victorNote || undefined,
                        })
                      }
                      disabled={isPending}
                      style={{ color: "#0d1625" }}
                      className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white px-4 py-2 text-sm font-medium text-[#0d1625] transition hover:bg-[#d7f5ec] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Request changes
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <p className="text-sm text-slate-200">
                    {qaReview.status === "approved"
                      ? "Victor approved this grade. This touch is marked Completed -- file the final report to Drive Monthly Notes and the ClickUp Client Book manually until write access is connected."
                      : "Victor requested changes."}
                  </p>
                  {qaReview.victorNote ? <p className="mt-1 text-xs text-slate-400">Note: {qaReview.victorNote}</p> : null}
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
