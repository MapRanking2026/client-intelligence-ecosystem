"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, LoaderCircle, Mail, ShieldCheck, Sparkles, Ticket } from "lucide-react";

import type {
  DraftTicket,
  MonthlyTouchRecord,
  PostMeetingReview,
  QaReview,
} from "@/src/lib/mtos-data";

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
  const [ticketDecisions, setTicketDecisions] = useState<Record<string, "approved" | "declined">>(() =>
    Object.fromEntries(
      (postMeeting?.draftTickets || [])
        .filter((ticket) => ticket.status !== "pending")
        .map((ticket) => [ticket.id, ticket.status as "approved" | "declined"]),
    ),
  );
  const [approveEmail, setApproveEmail] = useState(postMeeting?.clientEmail?.status === "approved");
  const [victorNote, setVictorNote] = useState("");

  const pendingTickets = useMemo(
    () => (postMeeting?.draftTickets || []).filter((ticket) => ticket.status === "pending"),
    [postMeeting?.draftTickets],
  );

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
            className="mt-3 inline-flex items-center gap-2 rounded-full border border-[#d7f5ec]/20 bg-[#d7f5ec] px-4 py-2 text-sm font-semibold text-[#0c1524] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
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

          {/* Step 2: draft tickets + email, AM approval gate */}
          <div className="rounded-[24px] border border-white/8 bg-black/20 p-5">
            <div className="flex items-center gap-2">
              <Ticket className="h-4 w-4 text-[#d7f5ec]" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                Step 2 -- Draft tickets (approval required)
              </p>
            </div>
            <div className="mt-3 space-y-3">
              {(postMeeting.draftTickets || []).map((ticket) => {
                const decision = ticketDecisions[ticket.id] || (ticket.status !== "pending" ? ticket.status : undefined);
                return (
                  <div key={ticket.id} className="rounded-2xl border border-white/8 bg-white/4 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] font-medium ${departmentTone(ticket.department)}`}>
                          {ticket.department}
                        </span>
                        <p className="mt-2 text-sm font-semibold text-white">{ticket.title}</p>
                        <p className="mt-1 text-sm text-slate-300">{ticket.description}</p>
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
                      {!decisionsApplied ? (
                        <div className="flex shrink-0 gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setTicketDecisions((prev) => ({ ...prev, [ticket.id]: "approved" }))
                            }
                            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                              decision === "approved"
                                ? "border-emerald-400/30 bg-emerald-500/20 text-emerald-100"
                                : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                            }`}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setTicketDecisions((prev) => ({ ...prev, [ticket.id]: "declined" }))
                            }
                            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                              decision === "declined"
                                ? "border-rose-400/30 bg-rose-500/20 text-rose-100"
                                : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                            }`}
                          >
                            Decline
                          </button>
                        </div>
                      ) : (
                        <span
                          className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${
                            ticket.status === "approved"
                              ? "border-emerald-400/30 bg-emerald-500/20 text-emerald-100"
                              : "border-rose-400/30 bg-rose-500/20 text-rose-100"
                          }`}
                        >
                          {ticket.status === "approved" ? "Approved" : "Declined"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {!(postMeeting.draftTickets || []).length ? (
                <p className="text-sm text-slate-400">No follow-up tickets were extracted from this transcript.</p>
              ) : null}
            </div>
          </div>

          <div className="rounded-[24px] border border-white/8 bg-black/20 p-5">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-[#d7f5ec]" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                Client follow-up email
              </p>
            </div>
            {postMeeting.clientEmail ? (
              <div className="mt-3 rounded-2xl border border-white/8 bg-white/4 p-4">
                <p className="text-sm font-semibold text-white">{postMeeting.clientEmail.subject}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{postMeeting.clientEmail.body}</p>
                {!decisionsApplied ? (
                  <label className="mt-3 flex items-center gap-2 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={approveEmail}
                      onChange={(event) => setApproveEmail(event.target.checked)}
                      className="h-4 w-4 rounded border-white/20 bg-black/30"
                    />
                    Approve this draft to send to the client
                  </label>
                ) : (
                  <p className="mt-3 text-xs text-slate-400">
                    {postMeeting.clientEmail.status === "approved"
                      ? "Approved -- copy this into an email to the client (sending isn't wired to a connected mailbox yet)."
                      : "Not approved."}
                  </p>
                )}
              </div>
            ) : null}
          </div>

          {!decisionsApplied ? (
            <button
              type="button"
              onClick={() =>
                run("apply_post_meeting_decisions", {
                  action: "apply_post_meeting_decisions",
                  ticketDecisions,
                  approveEmail,
                })
              }
              disabled={isPending || (pendingTickets.length > 0 && Object.keys(ticketDecisions).length < (postMeeting.draftTickets || []).length)}
              className="inline-flex items-center gap-2 rounded-full border border-[#d7f5ec]/20 bg-[#d7f5ec] px-4 py-2 text-sm font-semibold text-[#0c1524] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
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
