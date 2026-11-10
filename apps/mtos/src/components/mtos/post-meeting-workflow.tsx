"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  FileText,
  Gauge,
  LoaderCircle,
  Mail,
  NotebookPen,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Ticket,
  Trash2,
} from "lucide-react";

import { AiProgressPanel, useAiRun } from "@/src/components/mtos/ai-progress";

import type {
  BillingChangeType,
  DraftTicket,
  MonthlyTouchRecord,
  PostMeetingReview,
  QaReview,
  RiskRegisterEntry,
  RiskTier,
  StakeholderMapEntry,
  TicketDepartment,
  TicketPriority,
  TicketType,
} from "@/src/lib/mtos-data";
import { DateField } from "@/src/components/mtos/date-field";
import {
  npsBand,
  reviewBlockers,
  riskRegisterRequired,
} from "@/src/lib/contracts/post-meeting-review";
import Link from "next/link";
import { LEGACY_QA_TAG, legacyGradeLabel, legacyStatusLabel } from "@/src/lib/contracts/qc-legacy";

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

/** Mirrors MeetingTranscriptLookup from the meeting-transcript service. */
interface TranscriptLookup {
  status:
    | "loaded"
    | "not_connected"
    | "needs_reconsent"
    | "no_calendar_event"
    | "artifact_not_ready"
    | "no_transcript"
    | "doc_unreadable"
    | "failed";
  reason: string;
  transcript?: string;
  doc?: { id: string; title: string; url: string };
  matchedBy?: "calendar_attachment" | "calendar_search" | "title_and_time" | "client_and_time";
  sections?: { fullNotes: boolean; transcript: boolean };
}

/**
 * Whether the AM can clear this themselves by reconnecting Google, versus states where the
 * right move is simply to wait or to paste by hand.
 */
const RECONNECT_STATUSES = new Set(["not_connected", "needs_reconsent"]);

/**
 * Ask the server for this touch's Gemini transcript. The endpoint reports expected outcomes as
 * a status rather than an error, so only a genuinely unreachable service lands in the catch.
 */
async function requestTranscript(touchId: string): Promise<TranscriptLookup> {
  try {
    const response = await fetch(`/api/monthly-touches/${touchId}/transcript`);
    const payload = (await response.json()) as { data?: TranscriptLookup; error?: string };
    return (
      payload.data || {
        status: "failed",
        reason: payload.error || "Couldn't reach the transcript service. Paste the transcript below instead.",
      }
    );
  } catch {
    return {
      status: "failed",
      reason: "Couldn't reach the transcript service. Paste the transcript below instead.",
    };
  }
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
      {type === "date" ? (
        <DateField variant="dark" value={value} onChange={onChange} />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className={fieldInputClass}
        />
      )}
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
  /**
   * True once this touch has gone to QC.
   *
   * It replaces the A–F step below rather than sitting beside it: two grades on one call, from two
   * instruments, with two different people entitled to argue about them, is worse than either on
   * its own. The old review stays readable on a touch that already had one.
   */
  hasQc?: boolean;
}

interface TouchActionResponse {
  data?: {
    touch?: MonthlyTouchRecord;
  };
  error?: string;
  /** Present on a 409: everything still outstanding in the review. */
  blockers?: string[];
}

/**
 * The server refusing a review because the AM still has something to decide.
 *
 * Separate from a failure on purpose: nothing was written, nothing is wrong, and the screen keeps
 * every edit and simply says what is outstanding.
 */
class ReviewIncompleteError extends Error {
  readonly blockers: string[];
  constructor(blockers: string[]) {
    super(blockers[0] || "There is still something to decide.");
    this.name = "ReviewIncompleteError";
    this.blockers = blockers;
  }
}

async function postAction(touchId: string, body: Record<string, unknown>) {
  const response = await fetch(`/api/monthly-touches/${touchId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as TouchActionResponse;
  if (response.status === 409 && payload.blockers?.length) {
    throw new ReviewIncompleteError(payload.blockers);
  }
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

/** What each AI-backed action is called while it runs, for the progress panel. */
const ACTION_STEP: Record<string, string> = {
  analyze_transcript: "Reading the transcript and drafting the recap",
  retry_client_intelligence: "Re-reading the call for client intelligence",
  record_client_health: "Recording client health",
  apply_client_intelligence: "Applying client intelligence",
  apply_post_meeting_decisions: "Filing tickets, commitments and the recap",
  generate_qa_review: "Scoring the call against the QA rubric",
};

const ACTION_TYPICAL: Record<string, string> = {
  analyze_transcript: "Usually 1-3 minutes, longer for a long transcript",
  retry_client_intelligence: "Usually under a minute",
  apply_post_meeting_decisions: "Usually under a minute",
  generate_qa_review: "Usually 1-2 minutes",
};

export function PostMeetingWorkflow({ touchId, postMeeting, qaReview, hasQc }: PostMeetingWorkflowProps) {
  const [transcript, setTranscript] = useState(postMeeting?.transcript || "");
  const [error, setError] = useState<string | null>(null);
  /** What is still left to decide before the review can be submitted, in the AM's own words. */
  const [blockers, setBlockers] = useState<string[]>([]);
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const router = useRouter();
  const ai = useAiRun();
  const isPending = activeAction !== null;
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

  // Automatic transcript retrieval. The Gemini notes Doc for the call is fetched when this step
  // opens so the usual case needs no paste at all; everything else degrades to the manual paste
  // this step has always supported, which is still the only option for Zoom calls, for touches
  // with no calendar event, and for recaps typed from memory.
  const [transcriptLookup, setTranscriptLookup] = useState<TranscriptLookup | null>(null);
  const [isFetchingTranscript, setIsFetchingTranscript] = useState(false);

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
  // Client health: the AM confirms the NPS and risk status, starting from the
  // transcript-grounded suggestions. Every change to a score swaps in that score's
  // suggested reason, unless the AM has already typed over it.
  const healthSuggestion = clientIntelligence?.healthSuggestion;
  const recordedHealth = clientIntelligence?.health;
  const [npsScore, setNpsScore] = useState<number | null>(
    recordedHealth?.nps ?? healthSuggestion?.suggestedNps ?? null,
  );
  const [npsReason, setNpsReason] = useState(
    recordedHealth?.npsReason || healthSuggestion?.suggestedNpsReason || "",
  );
  const [npsReasonEdited, setNpsReasonEdited] = useState(Boolean(recordedHealth?.npsReason));
  /**
   * Whether the AM has actually picked the score, as opposed to looking at the suggestion.
   *
   * The suggestion is pre-filled so the usual case is one click, but it stays a suggestion until
   * that click: the score is the AM's own read of the account and it decides whether this client
   * must be logged in the Risk Register, so it is never taken as given.
   */
  const [npsChosen, setNpsChosen] = useState(Boolean(recordedHealth));
  const [healthRiskTier, setHealthRiskTier] = useState<RiskTier | undefined>(
    recordedHealth?.riskTier ?? clientIntelligence?.riskTier ?? undefined,
  );
  const [healthRiskReason, setHealthRiskReason] = useState(
    recordedHealth?.riskReason || healthSuggestion?.riskReason || "",
  );
  const [healthRiskReasonEdited, setHealthRiskReasonEdited] = useState(Boolean(recordedHealth?.riskReason));

  /** Pick a score and pull in its suggested reason, unless the AM wrote their own. */
  function chooseNps(score: number | null) {
    setNpsScore(score);
    setNpsChosen(true);
    if (npsReasonEdited) return;
    const suggested =
      score === null
        ? healthSuggestion?.suggestedNpsReason
        : score === healthSuggestion?.suggestedNps
          ? healthSuggestion?.suggestedNpsReason
          : healthSuggestion?.npsReasonsByScore?.[String(score)];
    setNpsReason(suggested || "");
  }

  /** Same for the risk tier. */
  function chooseRiskTier(tier: RiskTier | undefined) {
    setHealthRiskTier(tier);
    if (healthRiskReasonEdited) return;
    const suggested =
      tier && tier === (clientIntelligence?.riskTier ?? undefined)
        ? healthSuggestion?.riskReason
        : tier
          ? healthSuggestion?.riskReasonsByTier?.[tier]
          : undefined;
    setHealthRiskReason(suggested || "");
  }

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

  const alreadyAnalyzed = postMeeting?.status === "draft_ready" || postMeeting?.status === "approved";

  /**
   * Run a lookup and reflect it in the UI.
   *
   * `overwrite` is what separates the two callers: the fetch on open must never replace text
   * the AM has typed, while an explicit re-fetch is them asking for exactly that.
   */
  async function loadTranscript({ overwrite }: { overwrite: boolean }) {
    setIsFetchingTranscript(true);
    try {
      const lookup = await requestTranscript(touchId);
      setTranscriptLookup(lookup);
      if (lookup.status === "loaded" && lookup.transcript) {
        const fetched = lookup.transcript;
        setTranscript((current) => (overwrite || !current.trim() ? fetched : current));
      }
    } finally {
      setIsFetchingTranscript(false);
    }
  }

  // Fetch on open, for a touch that hasn't been analyzed and has nothing saved yet. One read per
  // visit -- no polling and nothing stale, since the Doc is read at the moment the AM looks at it.
  const shouldAutoFetchTranscript = !alreadyAnalyzed && !(postMeeting?.transcript || "").trim();
  useEffect(() => {
    if (!shouldAutoFetchTranscript) return;
    let cancelled = false;
    (async () => {
      setIsFetchingTranscript(true);
      const lookup = await requestTranscript(touchId);
      if (cancelled) return;
      setTranscriptLookup(lookup);
      if (lookup.status === "loaded" && lookup.transcript) {
        const fetched = lookup.transcript;
        setTranscript((current) => (current.trim() ? current : fetched));
      }
      setIsFetchingTranscript(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [touchId, shouldAutoFetchTranscript]);

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

  const emailValid = !approveEmail || Boolean(emailSubject.trim() && emailBody.trim());

  /**
   * Is this client required to go on the Risk Register? The score decides, and only the score:
   * 6 or below is mandatory, 7 or above is not.
   */
  const registerRequired = riskRegisterRequired(npsChosen ? npsScore : null);

  const approvedCount = tickets.filter((ticket) => ticket.decision === "approved").length;

  /**
   * Everything still outstanding before the one submission can go.
   *
   * Computed from the same rules the server checks, so the screen and the server never disagree
   * about whether a review is finished -- and so a 409 from the server can only ever be a race,
   * never a surprise.
   */
  const reviewLeft = blockers.length
    ? blockers
    : reviewBlockers({
        nps: npsScore,
        npsReason,
        npsChosen,
        tickets: tickets.map((ticket) => ({
          decision: ticket.decision,
          title: ticket.title,
          description: ticket.description,
          ticketType: ticket.ticketType,
          billingChangeType: ticket.billingChangeType,
        })),
        risk: {
          decision: riskDecision,
          entry: { ...riskEntry, riskScore: riskFlagCount, riskTier: derivedRiskTier },
          offered: Boolean(clientIntelligence?.riskRegister),
        },
        ...(clientIntelligence?.stakeholderMap
          ? { stakeholder: { decision: stakeDecision, entry: stakeEntry, offered: true } }
          : {}),
        email: { subject: emailSubject, body: emailBody, approve: approveEmail },
      });

  /**
   * Run one action and pull the fresh server state in.
   *
   * `router.refresh()`, never a page reload. A reload threw away every edit on this screen that
   * had not been submitted yet -- which is exactly what made the old three-button sequence
   * unusable: recording the score wiped the ticket edits, so the AM had to start over. A refresh
   * re-renders the server components and merges the result without touching client state, so the
   * panel updates around whatever the AM is still typing.
   *
   * Not wrapped in startTransition -- see ai-progress.tsx for why that hides the panel.
   */
  function run(action: string, body: Record<string, unknown>) {
    setError(null);
    setBlockers([]);
    setActiveAction(action);
    ai.start([ACTION_STEP[action] || "Working"], ACTION_TYPICAL[action]);

    void (async () => {
      try {
        await postAction(touchId, body);
        router.refresh();
      } catch (caught) {
        if (caught instanceof ReviewIncompleteError) {
          setBlockers(caught.blockers);
        } else {
          setError(caught instanceof Error ? caught.message : "That action failed");
        }
      } finally {
        ai.stop();
        setActiveAction(null);
      }
    })();
  }

  const analysisReady = alreadyAnalyzed;
  const decisionsApplied = postMeeting?.status === "approved";

  return (
    <div className="space-y-6">
      {/* Step 1: transcript in, analysis out */}
      <div className="rounded-[24px] border border-white/8 bg-black/20 p-5">
        <p className="card-title">
          Step 1 -- Meeting transcript
        </p>
        <p className="mt-1 text-sm text-slate-300">
          For a Google Meet touch, the transcript loads from the exact selected conference.
          The analysis treats the transcript as the
          source of truth. Edit the text, or replace it
          with your own paste (Zoom, or a manual recap): the recap, draft follow-up tickets, and
          client email draft are grounded only in what&apos;s in this box.
        </p>

        {/* Retrieval status. Every outcome says what happened and what to do next, because the
            manual paste below stays available in all of them. */}
        {!analysisReady ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            {isFetchingTranscript ? (
              <span className="inline-flex items-center gap-2 text-xs text-slate-400">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                Looking for this meeting&apos;s transcript...
              </span>
            ) : (
              <button
                type="button"
                onClick={() => loadTranscript({ overwrite: true })}
                className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {transcriptLookup?.status === "loaded" ? "Re-fetch transcript" : "Fetch transcript"}
              </button>
            )}
            {transcriptLookup?.doc ? (
              <a
                href={transcriptLookup.doc.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-slate-400 underline decoration-white/20 transition hover:text-slate-200"
              >
                <FileText className="h-3.5 w-3.5" />
                Open the notes Doc
              </a>
            ) : null}
            {RECONNECT_STATUSES.has(transcriptLookup?.status || "") ? (
              <a
                href="/settings/integrations"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-200 underline decoration-amber-200/40 transition hover:text-amber-100"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Reconnect Google Meet
              </a>
            ) : null}
          </div>
        ) : null}

        {!analysisReady && transcriptLookup && !isFetchingTranscript ? (
          <p
            className={
              transcriptLookup.status === "loaded"
                ? "mt-2 text-xs leading-5 text-emerald-200/90"
                : transcriptLookup.status === "failed"
                  ? "mt-2 text-xs leading-5 text-rose-300/90"
                  : "mt-2 text-xs leading-5 text-amber-200/90"
            }
          >
            {transcriptLookup.reason}
          </p>
        ) : null}

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
            disabled={isPending || isFetchingTranscript || transcript.trim().length < 40}
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

      {ai.run ? <AiProgressPanel run={ai.run} elapsed={ai.elapsed} /> : null}

      {error ? <p className="text-sm text-rose-300">{error}</p> : null}

      {analysisReady && postMeeting ? (
        <>
          <div className="rounded-[24px] border border-white/8 bg-black/20 p-5">
            <p className="card-title">Internal recap</p>
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

          {/* Client Intelligence -- report (always saved with the client) + risk-gated forms */}
          {clientIntelligence ? (
            <div className="rounded-[24px] border border-white/8 bg-black/20 p-5">
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4 text-[#d7f5ec]" />
                <p className="card-title">
                  Step 2 -- Account health score, then the registers
                </p>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Pick the score first — it decides whether this client has to go on the Risk Register. The
                report below is saved with the client&apos;s record and never posted to ClickUp. Nothing on
                this screen is written anywhere until you submit the review at the bottom, in one press.
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

              {/* Client health -- NPS + risk status, suggested from the transcript and
                  confirmed by the AM. Sits here rather than at the end of the live
                  guide because only the transcript can tell you how the client felt. */}
              <div className="mt-4 space-y-3 rounded-2xl border border-[#2dd4bf]/20 bg-[#2dd4bf]/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-white">Client health — NPS &amp; risk status</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {healthSuggestion
                        ? "Suggested from the transcript. Change either value and the reason updates to match."
                        : "No suggestion was generated — set the score from how the call actually went."}
                    </p>
                  </div>
                  {recordedHealth ? (
                    <span className="rounded-full border border-emerald-400/30 bg-emerald-500/20 px-3 py-1 text-xs text-emerald-100">
                      Recorded
                    </span>
                  ) : null}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {/* A picker, not a dropdown: the AM gets through this by tapping, and the
                      suggestion sits beside the numbers as one option among them rather than as a
                      default that happens unless they intervene. */}
                  <div className="block sm:col-span-2">
                    <span className="text-xs text-slate-400">NPS / Account Health score (1–10)</span>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {healthSuggestion?.suggestedNps !== null && healthSuggestion?.suggestedNps !== undefined ? (
                        <button
                          type="button"
                          onClick={() => chooseNps(healthSuggestion.suggestedNps)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${npsChosen && npsScore === healthSuggestion.suggestedNps ? "border-[#2dd4bf]/50 bg-[#2dd4bf]/25 text-white" : "border-white/12 bg-white/5 text-slate-200 hover:bg-white/10"}`}
                        >
                          Suggested {healthSuggestion.suggestedNps}
                        </button>
                      ) : null}
                      {Array.from({ length: 10 }, (_, index) => index + 1).map((score) => (
                        <button
                          key={score}
                          type="button"
                          onClick={() => chooseNps(score)}
                          className={`h-8 w-8 rounded-full border text-xs font-medium transition ${npsChosen && npsScore === score ? "border-[#2dd4bf]/50 bg-[#2dd4bf]/25 text-white" : "border-white/12 bg-white/5 text-slate-200 hover:bg-white/10"}`}
                        >
                          {score}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => chooseNps(null)}
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${npsChosen && npsScore === null ? "border-amber-400/40 bg-amber-500/20 text-amber-100" : "border-white/12 bg-white/5 text-slate-300 hover:bg-white/10"}`}
                      >
                        No score
                      </button>
                    </div>
                    <p className="mt-1.5 text-[11px] text-slate-500">
                      Your read of the account, not something the client said — the client never gives a
                      number. 9–10 healthy · 7–8 stable with friction · 5–6 at risk · 3–4 critical · 1–2
                      churn imminent.
                    </p>
                  </div>

                  <label className="block">
                    <span className="text-xs text-slate-400">
                      Risk status
                      {clientIntelligence.riskTier ? ` · suggested ${clientIntelligence.riskTier}` : ""}
                    </span>
                    <select
                      value={healthRiskTier || ""}
                      onChange={(event) =>
                        chooseRiskTier(event.target.value ? (event.target.value as RiskTier) : undefined)
                      }
                      className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none"
                    >
                      <option value="" style={{ color: "#0d1625" }}>
                        Not set
                      </option>
                      {(["Healthy", "Low", "Medium", "High", "Critical"] as RiskTier[]).map((tier) => (
                        <option key={tier} value={tier} style={{ color: "#0d1625" }}>
                          {tier}
                          {tier === clientIntelligence.riskTier ? " (suggested)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="block">
                  <span className="text-xs text-slate-400">Reason for the score</span>
                  <textarea
                    value={npsReason}
                    onChange={(event) => {
                      setNpsReason(event.target.value);
                      setNpsReasonEdited(true);
                    }}
                    rows={2}
                    placeholder="One line on why this score — in the client's own terms."
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>

                <label className="block">
                  <span className="text-xs text-slate-400">Reason for the risk status</span>
                  <textarea
                    value={healthRiskReason}
                    onChange={(event) => {
                      setHealthRiskReason(event.target.value);
                      setHealthRiskReasonEdited(true);
                    }}
                    rows={2}
                    placeholder="What drives this risk read right now."
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 outline-none"
                  />
                </label>

                {/* No button of its own. The score is part of the one submission at the bottom --
                    recording it separately used to reload the screen and wipe every ticket edit the
                    AM had made. What it changes right now is shown instead, because the score is a
                    gate: 6 or below makes the Risk Register entry below mandatory. */}
                {npsScore !== null ? (
                  <p className={`rounded-xl border px-3 py-2 text-xs ${registerRequired ? "border-amber-400/25 bg-amber-500/5 text-amber-200" : "border-emerald-400/20 bg-emerald-500/5 text-emerald-100"}`}>
                    {npsScore}/10 — {npsBand(npsScore)}.{" "}
                    {registerRequired
                      ? "A score of 6 or below requires a Risk Register entry, the matching red-flag playbook and a Manager @-tag in the client channel. The entry below has to be decided before you can submit."
                      : "A score of 7 or above needs no Risk Register entry — nothing is logged there unless you approve it."}
                  </p>
                ) : (
                  <p className="rounded-xl border border-white/10 bg-white/4 px-3 py-2 text-xs text-slate-300">
                    Pick a score before deciding the rest. Whether this client has to go on the Risk Register
                    is decided by the number: 6 or below is mandatory, 7 or above is not.
                  </p>
                )}
                {recordedHealth ? (
                  <p className="text-xs text-slate-400">
                    Last recorded: {recordedHealth.nps === null ? "no score given" : `${recordedHealth.nps}/10`}
                    {recordedHealth.riskTier ? ` · ${recordedHealth.riskTier}` : ""}
                    {recordedHealth.overrodeSuggestion ? " · changed from the suggestion" : ""}
                  </p>
                ) : null}
              </div>

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
                  <div className="grid gap-3 sm:grid-cols-3">
                    <FieldInput label="Personality" value={stakeEntry.personality || ""} onChange={(v) => updateStake({ personality: v })} placeholder="One word, e.g. Analytical" />
                    <FieldInput label="What They Care About" value={stakeEntry.whatTheyCareAbout || ""} onChange={(v) => updateStake({ whatTheyCareAbout: v })} placeholder="One word, e.g. Leads" />
                    <FieldInput label="Known History" value={stakeEntry.knownHistory || ""} onChange={(v) => updateStake({ knownHistory: v })} placeholder="One word, e.g. Longtime" />
                  </div>
                  {clientIntelligence.stakeholderMapTaskUrl ? (
                    <a href={clientIntelligence.stakeholderMapTaskUrl} target="_blank" rel="noreferrer" className="inline-block text-xs text-[#d7f5ec] underline">
                      View in ClickUp
                    </a>
                  ) : null}
                </div>
              ) : null}

              {/* Risk Register. Shown when the score requires it (6 or below), or when the call
                  surfaced a flag, or when the row already carries an open case. The score is the
                  only thing that makes it mandatory. */}
              {registerRequired || (clientIntelligence.riskDetected && clientIntelligence.riskRegister) ? (
                <div className="mt-4 space-y-3 rounded-2xl border border-rose-400/20 bg-rose-500/5 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-rose-100">
                      {clientIntelligence.riskResolved
                        ? "Risk Register · resolved — confirm to clear"
                        : `Risk Register${clientIntelligence.riskTier ? ` · ${clientIntelligence.riskTier} risk` : ""}`}
                      {registerRequired ? (
                        <span className="ml-2 rounded-full border border-rose-400/40 bg-rose-500/20 px-2 py-0.5 text-[11px] font-medium text-rose-100">
                          Required — score {npsScore}
                        </span>
                      ) : null}
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
                  <FieldInput label="Next Action" value={riskEntry.nextAction || ""} onChange={(v) => updateRisk({ nextAction: v })} placeholder="2-4 words, e.g. Schedule check-in" />
                  <FieldTextarea label="Latest Comments (notes)" value={riskEntry.latestComments || ""} onChange={(v) => updateRisk({ latestComments: v })} rows={2} placeholder="One short sentence (optional)…" />
                  {clientIntelligence.riskRegisterTaskUrl ? (
                    <a href={clientIntelligence.riskRegisterTaskUrl} target="_blank" rel="noreferrer" className="inline-block text-xs text-[#d7f5ec] underline">
                      View in ClickUp
                    </a>
                  ) : null}
                </div>
              ) : !clientIntelligence.errorMessage ? (
                <p className="mt-4 rounded-2xl border border-emerald-400/15 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-100">
                  {npsChosen && npsScore !== null
                    ? `No Risk Register change — score ${npsScore}, no flags, no open case.`
                    : "No risk detected on the call. A score of 6 or below would still make a Risk Register entry mandatory."}
                </p>
              ) : null}

              {clientIntelligence.executionNote ? (
                <p className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                  {clientIntelligence.executionNote}
                </p>
              ) : null}

              {/* Nothing is written from here either. Both entries go to ClickUp with the one
                  submission at the bottom of this screen, each as its own write, so one failing
                  still leaves the other standing. */}
            </div>
          ) : null}

          {/* Step 2: draft tickets + email, AM edits + approval gate */}
          <div className="rounded-[24px] border border-white/8 bg-black/20 p-5">
            <div className="flex items-center gap-2">
              <Ticket className="h-4 w-4 text-[#d7f5ec]" />
              <p className="card-title">
                Step 3 -- Tickets and the client recap email (edit &amp; approve)
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
                          <DateField
                            variant="dark"
                            value={ticket.dateRequested || ""}
                            onChange={(v) => updateTicket(ticket.id, { dateRequested: v || undefined })}
                          />
                        </div>
                        <div>
                          <label className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Due date</label>
                          <DateField
                            variant="dark"
                            value={ticket.dueDate || ""}
                            onChange={(v) => updateTicket(ticket.id, { dueDate: v || undefined })}
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
                        <DateField
                          variant="dark"
                          value={ticket.dueDate || ""}
                          onChange={(v) => updateTicket(ticket.id, { dueDate: v || undefined })}
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
              <p className="card-title">
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

          {/* ---------- One submission for the whole review ----------
              Everything above is a draft until this button: the score, every ticket, the Risk
              Register entry, the Stakeholder Map entry and the client recap email. Pressing it is
              the AM's approval for exactly what they approved, and nothing else -- and because it
              is one press, nothing they edited is lost on the way to it. */}
          {!decisionsApplied ? (
            <div className="space-y-3 rounded-[24px] border border-[#2dd4bf]/25 bg-[#2dd4bf]/5 p-5">
              <p className="card-title">Submit the review</p>
              <p className="text-xs text-slate-300">
                Nothing has been created, written or filed yet. This files the approved tickets in ClickUp,
                writes each approved entry to the client&apos;s Health Tracker row, saves the notes as a
                subpage of this touch&apos;s Monthly Touch page, and records the recap email.
                Denied items stay in the notes as a record; deleted ones are dropped.
              </p>

              {reviewLeft.length ? (
                <ul className="space-y-1.5">
                  {reviewLeft.map((item) => (
                    <li key={item} className="rounded-xl border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-xl border border-emerald-400/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-100">
                  Everything is decided. {approvedCount === 1 ? "1 ticket" : `${approvedCount} tickets`} will be
                  created{riskDecision === "approved" ? ", the Risk Register entry written" : ""}
                  {stakeDecision === "approved" ? ", the Stakeholder Map entry written" : ""}
                  {approveEmail ? ", and the recap email recorded as approved" : ""}.
                </p>
              )}

              <button
                type="button"
                onClick={() =>
                  run("apply_post_meeting_review", {
                    action: "apply_post_meeting_review",
                    nps: npsScore,
                    npsReason,
                    riskTier: healthRiskTier,
                    riskReason: healthRiskReason,
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
                    riskRegister: riskDecision
                      ? { ...riskEntry, riskScore: riskFlagCount, riskTier: derivedRiskTier, decision: riskDecision }
                      : undefined,
                    stakeholderMap: stakeDecision ? { ...stakeEntry, decision: stakeDecision } : undefined,
                  })
                }
                disabled={isPending || reviewLeft.length > 0}
                style={{ color: "#0d1625" }}
                className="inline-flex items-center gap-2 rounded-full border border-[#d7f5ec]/20 bg-[#d7f5ec] px-4 py-2 text-sm font-semibold text-[#0d1625] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPending && activeAction === "apply_post_meeting_review" ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Approve and file everything
              </button>
            </div>
          ) : null}

          {/* The internal record of the touch, written once the decisions were applied. The AM's own
              copy of the notes lives in the Client's Book, so the link matters more than the text --
              but the markdown is shown too, because a failed write-back must not lose the document. */}
          {postMeeting.notes ? (
            <div className="rounded-[24px] border border-white/8 bg-black/20 p-5">
              <div className="flex items-center gap-2">
                <NotebookPen className="h-4 w-4 text-[#d7f5ec]" />
                <p className="card-title">
                  Post-Monthly Touch Notes
                </p>
              </div>

              {postMeeting.notes.clientBook?.postPageUrl ? (
                <p className="mt-3 text-sm text-slate-300">
                  Filed in the client&apos;s Client&apos;s Book, under this month&apos;s touch page.{" "}
                  <a
                    href={postMeeting.notes.clientBook.postPageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[#d7f5ec] underline"
                  >
                    Open the page in ClickUp
                  </a>
                </p>
              ) : null}

              {postMeeting.notes.errorMessage ? (
                <p className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                  The notes weren&apos;t filed in the Client&apos;s Book: {postMeeting.notes.errorMessage}
                  {postMeeting.notes.markdown ? " They're below — copy them into the book by hand." : ""}
                </p>
              ) : null}

              {postMeeting.notes.markdown ? (
                <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-2xl border border-white/8 bg-black/30 p-3 text-xs leading-5 text-slate-300">
                  {postMeeting.notes.markdown}
                </pre>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {/* Step 4: QA. The old A–F gate, or a pointer to QC on a touch that went there instead. */}
      {decisionsApplied && hasQc ? (
        <div className="rounded-[24px] border border-white/8 bg-black/20 p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#d7f5ec]" />
            <p className="card-title">Step 4 -- QC</p>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            This touch is scored by QC against the 17-point rubric. There is no A&ndash;F grade to
            generate and no approval to give here &mdash; the score, what went well and the
            coaching plan arrive on the account manager&apos;s QA &amp; Coaching page.
          </p>
          <Link
            href="/qa"
            className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-[#d7f5ec] hover:underline"
          >
            Open QA &amp; Coaching
          </Link>
          {qaReview ? (
            <p className="mt-3 text-xs leading-5 text-slate-400">
              {LEGACY_QA_TAG}: this touch also has an older A&ndash;F review
              ({legacyGradeLabel(qaReview)}, {legacyStatusLabel(qaReview).toLowerCase()}). It is kept
              as it was and is not part of the QC score.
            </p>
          ) : null}
        </div>
      ) : decisionsApplied ? (
        <div className="rounded-[24px] border border-white/8 bg-black/20 p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#d7f5ec]" />
            <p className="card-title">
              Step 4 -- QA review and Victor approval
            </p>
          </div>
          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">{LEGACY_QA_TAG}</p>

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
                      ? "Victor approved this grade. This touch is marked Completed -- the internal notes are already filed in the client's Client's Book; the final report still goes to Drive Monthly Notes by hand."
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
