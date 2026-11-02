"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ExternalLink,
  FileText,
  Lock,
  LoaderCircle,
  Mail,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";

import { SmartMarkdown } from "@/src/components/mtos/annotate";
import {
  PREP_STAGE_LABEL,
  PREP_STAGE_ORDER,
  type PrepStageId,
  type PrepStageStatus,
  type PrepWorkflowState,
} from "@/src/lib/contracts/prep-workflow";
import { readJsonResponse } from "@/src/lib/api/read-json-response";

/**
 * The preparation workflow, as the AM works it.
 *
 * Four numbered steps in one column, in the order they have to happen, each showing what it did and
 * what it is waiting for. A step whose turn has not come is visibly locked and says why -- and the
 * server refuses it too, so the lock is the rule rather than a hint.
 *
 * Nothing here decides anything. Every state on the screen comes from the workflow the server
 * returned, which is why the panel can no longer say "Not prepared yet" next to a readiness score
 * of 94: both now read the same record.
 */

type Action =
  | "run_research"
  | "generate_confirmation_email"
  | "approve_confirmation_email"
  | "send_confirmation_email"
  | "mark_confirmation_email_sent"
  | "generate_prep_notes"
  | "approve_prep_notes"
  | "file_prep_notes";

interface PrepWorkflowPanelProps {
  touchId: string;
  workflow: PrepWorkflowState;
  clientName: string;
}

const STEP_NUMBER: Record<PrepStageId, number> = {
  research: 1,
  confirmation_email: 2,
  prep_notes: 3,
  clickup_filing: 4,
};

function StatusChip({ status }: { status: PrepStageStatus }) {
  const map: Record<PrepStageStatus, { label: string; tone: string }> = {
    blocked: { label: "Waiting on the step above", tone: "muted" },
    ready: { label: "Ready to run", tone: "info" },
    running: { label: "Running", tone: "watch" },
    complete: { label: "Done", tone: "good" },
    failed: { label: "Failed", tone: "risk" },
  };
  const { label, tone } = map[status];
  return (
    <span className={`chip ${tone}`}>
      <span className={`sig-dot ${tone === "muted" || tone === "info" ? "muted" : tone}`} />
      {label}
    </span>
  );
}

function Step({
  stage,
  status,
  title,
  summary,
  children,
}: {
  stage: PrepStageId;
  status: PrepStageStatus;
  title: string;
  summary: string;
  children?: React.ReactNode;
}) {
  const cls =
    status === "complete"
      ? "is-done"
      : status === "failed"
        ? "is-failed"
        : status === "blocked"
          ? "is-blocked"
          : "is-current";
  return (
    <section className={`wf-step ${cls}`} aria-labelledby={`wf-${stage}`}>
      <div className="wf-step-head">
        <div className="flex min-w-0 items-start gap-3">
          <span className="wf-num">{status === "complete" ? <Check /> : STEP_NUMBER[stage]}</span>
          <div className="min-w-0">
            <h3 id={`wf-${stage}`} className="h4">
              {title}
            </h3>
            <p className="muted mt-1 text-[0.8rem]">{summary}</p>
          </div>
        </div>
        <StatusChip status={status} />
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

function Notice({ tone, children }: { tone: "info" | "risk" | "good" | "watch"; children: React.ReactNode }) {
  return (
    <p
      className="rounded-[10px] px-3 py-2.5 text-[0.82rem]"
      style={{ background: `var(--${tone}-bg)`, color: `var(--${tone})` }}
    >
      {children}
    </p>
  );
}

export function PrepWorkflowPanel({ touchId, workflow, clientName }: PrepWorkflowPanelProps) {
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const email = workflow.confirmationEmail;
  const document = workflow.document;
  const filing = workflow.filing;
  const research = workflow.research;

  // The AM's edits live here until they approve, so approving sends exactly what they read.
  const [subject, setSubject] = useState(email?.subject ?? "");
  const [body, setBody] = useState(email?.body ?? "");
  const [recipient, setRecipient] = useState(email?.recipient ?? "");
  const [timeZone, setTimeZone] = useState(email?.timeZone ?? "");
  const [manualChannel, setManualChannel] = useState("email from my own inbox");
  const [showNotes, setShowNotes] = useState(false);

  async function run(action: Action, payload: Record<string, unknown> = {}) {
    setPending(action);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/monthly-touches/${touchId}/prep-workflow`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const result = await readJsonResponse<{ data?: { message?: string }; error?: string }>(response);
      if (!response.ok) {
        throw new Error(result?.error || "That step could not be completed.");
      }
      setMessage(result?.data?.message ?? null);
      // The whole screen is derived from the touch, so a reload is the honest refresh: every score,
      // stage and gate comes back from the server rather than being patched up locally.
      globalThis.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That step could not be completed.");
    } finally {
      setPending(null);
    }
  }

  const busy = pending !== null;
  const stages = workflow.stages;
  const emailSent = email?.status === "sent" || email?.status === "sent_manually";

  return (
    <div>
      <div className="section-head" style={{ marginTop: 0 }}>
        <div>
          <div className="eyebrow muted">
            <Sparkles />
            <span>Preparation workflow</span>
          </div>
          <h2 className="h3 mt-2">Four steps, in this order</h2>
          <p className="muted mt-1.5 max-w-2xl text-[0.84rem]">
            The account review comes first, because the client email and the notes are both written from what it
            finds. Nothing reaches {clientName} or ClickUp until you have read it and approved it.
          </p>
        </div>
      </div>

      {error ? (
        <div className="mb-3">
          <Notice tone="risk">{error}</Notice>
        </div>
      ) : null}
      {message && !error ? (
        <div className="mb-3">
          <Notice tone="good">{message}</Notice>
        </div>
      ) : null}

      {/* ---------- 1. Prepare the Monthly Touch ---------- */}
      <Step
        stage="research"
        status={stages.research.status}
        title={PREP_STAGE_LABEL.research}
        summary="Reads every connected source, reconciles last month's promises, and sets this meeting's agenda."
      >
        {stages.research.status === "failed" && stages.research.errorMessage ? (
          <div className="mb-3">
            <Notice tone="risk">{stages.research.errorMessage}</Notice>
          </div>
        ) : null}

        {research ? (
          <div className="mb-4 grid gap-2.5">
            <p className="muted text-[0.8rem]">
              Completed {new Date(research.completedAt).toLocaleString()} · agenda of {research.agenda.length} items.
            </p>
            <details>
              <summary className="ilink text-[0.82rem]">
                Which sources answered ({research.sourceChecks.filter((check) => check.reachable).length} of{" "}
                {research.sourceChecks.length})
              </summary>
              <ul className="mt-2.5 grid gap-1.5">
                {research.sourceChecks.map((check) => (
                  <li key={check.key} className="flex items-start gap-2 text-[0.82rem]">
                    <span
                      className={`sig-dot ${check.reachable ? "good" : check.checked ? "watch" : "muted"}`}
                      style={{ marginTop: 6 }}
                    />
                    <span>
                      <strong style={{ color: "var(--text)" }}>{check.label}</strong> — {check.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
            {research.dataGaps.length ? (
              <Notice tone="watch">
                <AlertTriangle style={{ width: 14, height: 14, display: "inline", marginRight: 6 }} />
                {research.dataGaps.length} gaps to check or ask about: {research.dataGaps.slice(0, 3).join("; ")}
                {research.dataGaps.length > 3 ? "; …" : ""}
              </Notice>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => run("run_research")}
        >
          {pending === "run_research" ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          {stages.research.status === "complete" ? "Run the account review again" : "Generate Preparation"}
        </button>
        <p className="field-hint mt-2">Usually 3-5 minutes — it reads every connected dashboard, then writes the analysis.</p>
      </Step>

      {/* ---------- 2. Client confirmation email ---------- */}
      <Step
        stage="confirmation_email"
        status={stages.confirmation_email.status}
        title={PREP_STAGE_LABEL.confirmation_email}
        summary="The client-facing agenda, written from the agenda above. You approve the wording before it goes anywhere."
      >
        {stages.confirmation_email.status === "blocked" ? (
          <Notice tone="info">
            <Lock style={{ width: 14, height: 14, display: "inline", marginRight: 6 }} />
            The account review has to finish first — the email tells the client the agenda it produces.
          </Notice>
        ) : !email ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => run("generate_confirmation_email")}
          >
            {pending === "generate_confirmation_email" ? <LoaderCircle className="animate-spin" /> : <Mail />}
            Write the confirmation email
          </button>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2 text-[0.82rem]">
              <p>
                <span className="muted">Channel:</span> {email.channel}
              </p>
              <p>
                <span className="muted">Meeting time as the client reads it:</span>{" "}
                <strong style={{ color: "var(--text)" }}>{email.meetingWhen}</strong>{" "}
                <span className="muted">({email.timeZoneSource})</span>
              </p>
              <p className="muted">{email.recipientSource}</p>
            </div>

            {email.gaps.length ? (
              <Notice tone="watch">
                <strong>Before you approve this:</strong>
                <br />
                {email.gaps.join(" ")}
              </Notice>
            ) : null}

            {emailSent ? (
              <Notice tone="good">
                <CheckCircle2 style={{ width: 14, height: 14, display: "inline", marginRight: 6 }} />
                Sent {email.sentAt ? new Date(email.sentAt).toLocaleString() : ""} — {email.sentVia}. The wording below is
                what the client received.
              </Notice>
            ) : email.status === "approved" ? (
              <Notice tone="watch">
                Approved, <strong>not sent yet</strong>. The client has not been told the agenda.
              </Notice>
            ) : email.status === "failed" ? (
              <Notice tone="risk">{email.lastError}</Notice>
            ) : (
              <Notice tone="info">A draft. Read it, edit anything that does not fit, then approve it.</Notice>
            )}

            <div className="field">
              <label className="field-label" htmlFor="confirm-to">
                To
              </label>
              <input
                id="confirm-to"
                className="input"
                type="email"
                value={recipient}
                disabled={emailSent || busy}
                placeholder="the address you use for this client"
                onChange={(event) => setRecipient(event.target.value)}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="confirm-tz">
                Client time zone
              </label>
              <input
                id="confirm-tz"
                className="input"
                value={timeZone}
                disabled={emailSent || busy}
                placeholder="America/Phoenix"
                onChange={(event) => setTimeZone(event.target.value)}
              />
              <span className="field-hint">
                Changing this restates the meeting time — write the email again afterwards so the hour is right.
              </span>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="confirm-subject">
                Subject
              </label>
              <input
                id="confirm-subject"
                className="input"
                value={subject}
                disabled={emailSent || busy}
                onChange={(event) => setSubject(event.target.value)}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="confirm-body">
                Email the client receives
              </label>
              <textarea
                id="confirm-body"
                className="textarea"
                rows={14}
                value={body}
                disabled={emailSent || busy}
                onChange={(event) => setBody(event.target.value)}
              />
            </div>

            {!emailSent ? (
              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy || !subject.trim() || !body.trim()}
                  onClick={() =>
                    run("approve_confirmation_email", {
                      subject,
                      body,
                      ...(recipient.trim() ? { recipient: recipient.trim() } : {}),
                      ...(timeZone.trim() ? { timeZone: timeZone.trim() } : {}),
                    })
                  }
                >
                  {pending === "approve_confirmation_email" ? <LoaderCircle className="animate-spin" /> : <Check />}
                  {email.status === "draft" ? "Approve this wording" : "Approve the edits"}
                </button>

                {email.status === "approved" || email.status === "failed" ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy || !recipient.trim()}
                    onClick={() => run("send_confirmation_email")}
                  >
                    {pending === "send_confirmation_email" ? <LoaderCircle className="animate-spin" /> : <Send />}
                    {email.deliveryAttempts > 0 ? "Try sending again" : "Send it"}
                  </button>
                ) : null}

                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => run("generate_confirmation_email", { ...(timeZone.trim() ? { timeZone: timeZone.trim() } : {}) })}
                >
                  <RefreshCw />
                  Write it again
                </button>
              </div>
            ) : null}

            {!emailSent && (email.status === "approved" || email.status === "failed") ? (
              <div className="quick-ref">
                <div className="quick-ref-label">Sent it yourself?</div>
                <p className="mt-1.5 text-[0.82rem]">
                  MTOS can only send through a Gmail connection with permission to send. If you sent this from your own
                  inbox, record it here — the preparation notes will say you sent it, not MTOS.
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-2.5">
                  <div className="field" style={{ minWidth: 220, flex: 1 }}>
                    <label className="field-label" htmlFor="manual-channel">
                      How you sent it
                    </label>
                    <input
                      id="manual-channel"
                      className="input"
                      value={manualChannel}
                      disabled={busy}
                      onChange={(event) => setManualChannel(event.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy || !manualChannel.trim()}
                    onClick={() => run("mark_confirmation_email_sent", { channel: manualChannel.trim() })}
                  >
                    {pending === "mark_confirmation_email_sent" ? <LoaderCircle className="animate-spin" /> : <Check />}
                    I sent this myself
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </Step>

      {/* ---------- 3. Preparation notes ---------- */}
      <Step
        stage="prep_notes"
        status={stages.prep_notes.status}
        title={PREP_STAGE_LABEL.prep_notes}
        summary="The full preparation document — section 0 through section 16, in the order the SOP sets."
      >
        {stages.prep_notes.status === "blocked" ? (
          <Notice tone="info">
            <Lock style={{ width: 14, height: 14, display: "inline", marginRight: 6 }} />
            {!email
              ? "Write and approve the client email first. The notes reproduce the agenda the client received, so they cannot be written before the client has it."
              : email.status === "draft"
                ? "Approve the email wording first, so the notes and what the client receives describe the same meeting."
                : "The email is approved but has not gone out yet. Send it, or send it yourself and press “I sent this myself” — then the notes can be written."}
          </Notice>
        ) : (
          <div className="grid gap-4">
            {document?.errorMessage ? <Notice tone="risk">{document.errorMessage}</Notice> : null}

            {document?.markdown ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip">
                    {document.sections.filter((section) => section.included).length} sections written
                  </span>
                  {document.sections.filter((section) => !section.included).length ? (
                    <span className="chip muted">
                      {document.sections.filter((section) => !section.included).length} not applicable
                    </span>
                  ) : null}
                  {document.missing.length ? (
                    <span className="chip watch">{document.missing.length} evidence gaps flagged</span>
                  ) : null}
                  {document.approvedAt ? (
                    <span className="chip good">
                      <span className="sig-dot good" />
                      Approved
                    </span>
                  ) : null}
                  <span className="muted text-[0.76rem]">
                    Written {new Date(document.generatedAt).toLocaleString()}
                    {document.provider ? ` · via ${document.provider}` : ""}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {document.sections.map((section) => (
                    <span
                      key={section.id}
                      className={`chip ${section.failed ? "risk" : section.included ? "" : "muted"}`}
                      title={section.skippedReason || section.title}
                    >
                      {section.id}. {section.title}
                    </span>
                  ))}
                </div>

                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowNotes((open) => !open)}>
                  <FileText />
                  {showNotes ? "Hide the notes" : "Read the notes"}
                </button>

                {showNotes ? (
                  <div
                    className="doc-prose rounded-[10px] p-4"
                    style={{ background: "var(--surface-2)", border: "1px solid var(--hair)", maxHeight: 620, overflowY: "auto" }}
                  >
                    <SmartMarkdown text={document.markdown} />
                  </div>
                ) : null}
              </>
            ) : null}

            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                className={`btn ${document?.markdown ? "btn-ghost" : "btn-primary"}`}
                disabled={busy}
                onClick={() => run("generate_prep_notes")}
              >
                {pending === "generate_prep_notes" ? <LoaderCircle className="animate-spin" /> : <FileText />}
                {document?.markdown ? "Write the notes again" : "Write the preparation notes"}
              </button>
              {document?.markdown && !document.missingSections.length && !document.approvedAt ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => run("approve_prep_notes")}
                >
                  {pending === "approve_prep_notes" ? <LoaderCircle className="animate-spin" /> : <Check />}
                  Approve the notes
                </button>
              ) : null}
            </div>
          </div>
        )}
      </Step>

      {/* ---------- 4. File in the Client's Book ---------- */}
      <Step
        stage="clickup_filing"
        status={stages.clickup_filing.status}
        title={PREP_STAGE_LABEL.clickup_filing}
        summary="Files the notes as this touch's Monthly Touch page under Client Meetings Notes, with an empty Post Monthly Touch Notes subpage inside it for the write-up after the call."
      >
        {stages.clickup_filing.status === "blocked" ? (
          <Notice tone="info">
            <Lock style={{ width: 14, height: 14, display: "inline", marginRight: 6 }} />
            Approve the preparation notes first. Nothing is written into {clientName}&apos;s ClickUp book before you have
            read it.
          </Notice>
        ) : (
          <div className="grid gap-3.5">
            {filing?.status === "failed" || filing?.errorMessage ? (
              <Notice tone="risk">{filing.errorMessage}</Notice>
            ) : null}

            {filing?.status === "filed" ? (
              <div className="grid gap-2 text-[0.82rem]">
                <p className="muted">{filing.destination}</p>
                <div className="flex flex-wrap gap-3">
                  {filing.links?.prepPageUrl ? (
                    <a className="ilink inline-flex items-center gap-1.5" href={filing.links.prepPageUrl} target="_blank" rel="noreferrer">
                      {filing.pageName || "Monthly Touch"} <ExternalLink style={{ width: 13, height: 13 }} />
                    </a>
                  ) : null}
                  {filing.links?.postPageUrl ? (
                    <a className="ilink inline-flex items-center gap-1.5" href={filing.links.postPageUrl} target="_blank" rel="noreferrer">
                      Post Monthly Touch Notes <ExternalLink style={{ width: 13, height: 13 }} />
                    </a>
                  ) : null}
                </div>
              </div>
            ) : null}

            <button
              type="button"
              className={`btn ${filing?.status === "filed" ? "btn-ghost" : "btn-primary"}`}
              disabled={busy}
              onClick={() => run("file_prep_notes")}
            >
              {pending === "file_prep_notes" ? <LoaderCircle className="animate-spin" /> : <ExternalLink />}
              {filing?.status === "filed" ? "File again (updates the same page)" : "File in the Client's Book"}
            </button>
            <p className="field-hint">
              Filing again edits the page MTOS already wrote rather than adding a second one for the same date. The
              post-meeting notes are written into this page as a subpage after the call, not now.
            </p>
          </div>
        )}
      </Step>

      <p className="muted mt-4 text-[0.78rem]">
        Steps run in this order: {PREP_STAGE_ORDER.map((stage) => PREP_STAGE_LABEL[stage]).join(" → ")}.
      </p>
    </div>
  );
}
