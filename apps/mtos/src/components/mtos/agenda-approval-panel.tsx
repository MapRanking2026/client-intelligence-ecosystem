"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Loader2, Mail, Presentation, Rocket, Send, Undo2, X } from "lucide-react";

import { useTouchAutosave } from "@/src/components/mtos/use-touch-autosave";
import {
  APPROVAL_STEPS,
  APPROVAL_STEP_LABEL,
  approvalHint,
  approvalPlan,
  emptyApprovalState,
  nextApprovalStep,
  stepIsSettled,
  type ApprovalStepId,
  type TouchApprovalState,
} from "@/src/lib/contracts/touch-approval";
import type { AgendaSendOutcome } from "@/src/lib/contracts/agenda-email";
import type { LiveCallFormat, TouchAgendaEmailState } from "@/src/lib/mtos-data";

/**
 * The last three parts of the review: the client-facing agenda email, the live-call format, and
 * the single button that ends the review step.
 *
 * The email can be sent from here, with "Approve and Send", or left for the approval to send. Both
 * go through one sender on the server, which refuses a second send against the Intercom
 * conversation id the first one stored -- so an AM who sends it here and then approves does not
 * put two agendas for the same meeting in a client's inbox.
 *
 * One component rather than three, because the three are one decision. The format chosen here is
 * what the button builds, the email shown here is what the button sends, and the plan printed
 * above the button is generated from the same values -- so the screen cannot promise one thing and
 * the server do another.
 *
 * The editing surface shows the email as the client will receive it, not a text box that becomes
 * an email later. The AM is the last person who reads this before a client does, and they can only
 * catch a wrong hour or a wrong name if they are looking at the real thing.
 */

const TOOLBAR: { command: string; label: string; title: string }[] = [
  { command: "bold", label: "B", title: "Bold" },
  { command: "italic", label: "I", title: "Italic" },
  { command: "underline", label: "U", title: "Underline" },
  { command: "insertUnorderedList", label: "• List", title: "Bulleted list" },
  { command: "insertOrderedList", label: "1. List", title: "Numbered list" },
  { command: "createLink", label: "Link", title: "Add link" },
  { command: "removeFormat", label: "Clear", title: "Clear formatting" },
];

export interface AgendaApprovalPanelProps {
  touchId: string;
  email: TouchAgendaEmailState;
  /** True when the stored HTML is what the client already received; the card then locks. */
  sent: boolean;
  /** Addresses the cc preference would copy, and whether it is on. */
  availableCc: string[];
  ccEnabled: boolean;
  /** The format the approval will build, from this touch or the AM's preference. */
  format: LiveCallFormat;
  approval?: TouchApprovalState;
  /** How many sections are not declined, and which are. */
  approving: number;
  declined: string[];
  /** The Client's Book page the approval will write, so the AM can catch a wrong date. */
  pageName: string;
}

export function AgendaApprovalPanel({
  touchId,
  email,
  sent,
  availableCc,
  ccEnabled,
  format: initialFormat,
  approval: storedApproval,
  approving,
  declined,
  pageName,
}: AgendaApprovalPanelProps) {
  const autosave = useTouchAutosave(touchId);
  const [subject, setSubject] = useState(email.subject);
  const [declinedEmail, setDeclinedEmail] = useState(Boolean(email.declined));
  const [format, setFormat] = useState<LiveCallFormat>(initialFormat);
  const [makeDefault, setMakeDefault] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [approval, setApproval] = useState<TouchApprovalState | undefined>(storedApproval);
  const [running, setRunning] = useState(false);
  const [sending, setSending] = useState(false);
  // What the last send attempt did, in the server's own words, kept on the card rather than in a
  // toast: "it went out" and "it could not go out" are both things the AM needs to still be able
  // to read a minute later, while they are deciding whether to approve.
  const [sendOutcome, setSendOutcome] = useState<AgendaSendOutcome | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [showModal, setShowModal] = useState(false);

  const alreadySent =
    sent || sendOutcome?.status === "sent" || sendOutcome?.status === "already_sent";
  const locked = alreadySent || Boolean(approval?.finishedAt);
  const blocking = email.blockingGaps || [];

  const plan = useMemo(
    () =>
      approvalPlan({
        approving,
        declined,
        sendingEmail: !declinedEmail,
        ...(alreadySent ? { alreadySent: true } : {}),
        recipient: email.recipient || "",
        format,
        pageName,
      }),
    [alreadySent, approving, declined, declinedEmail, email.recipient, format, pageName],
  );

  const toggleDecline = useCallback(() => {
    setDeclinedEmail((current) => {
      const next = !current;
      autosave.save({ agendaEmail: { declined: next } });
      return next;
    });
  }, [autosave]);

  const onSubject = useCallback(
    (value: string) => {
      setSubject(value);
      autosave.save({ agendaEmail: { subject: value } });
    },
    [autosave],
  );

  /**
   * Send the agenda now, before the approval.
   *
   * The owner's case: the AM has read the brief, the email is right, and the client should have the
   * time in their inbox while the AM is still editing section 9. Flushes the autosave first, so
   * what goes out is the wording on the screen rather than the wording the server last stored.
   */
  const send = useCallback(async () => {
    setSending(true);
    setSendOutcome(undefined);
    await autosave.flush();
    try {
      const response = await fetch(`/api/monthly-touches/${touchId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "send_agenda_email" }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        data?: AgendaSendOutcome;
        error?: string;
      };
      setSendOutcome(
        body.data ?? {
          status: "failed",
          detail: body.error || "The send could not be completed. Nothing was sent.",
        },
      );
    } catch (error) {
      setSendOutcome({
        status: "failed",
        detail: `The send request did not reach MTOS (${error instanceof Error ? error.message : "unknown error"}). Nothing was sent. Try again.`,
      });
    } finally {
      setSending(false);
    }
  }, [autosave, touchId]);

  const approve = useCallback(async () => {
    setRunning(true);
    setShowModal(true);
    setMessage(undefined);
    await autosave.flush();
    try {
      const response = await fetch(`/api/monthly-touches/${touchId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "approve_and_go_live",
          format,
          ...(makeDefault ? { makeDefault: true } : {}),
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        data?: { approval?: TouchApprovalState; message?: string };
        error?: string;
      };
      if (!response.ok) {
        setMessage(body.error || "The approval could not be completed. Nothing further was sent or written.");
      } else {
        setApproval(body.data?.approval);
        setMessage(body.data?.message);
      }
    } catch (error) {
      setMessage(
        `The approval request did not reach MTOS (${error instanceof Error ? error.message : "unknown error"}). Nothing was sent. Try again.`,
      );
    } finally {
      setRunning(false);
    }
  }, [autosave, format, makeDefault, touchId]);

  return (
    <div className="flex flex-col gap-4">
      <EmailCard
        email={email}
        subject={subject}
        onSubject={onSubject}
        declined={declinedEmail}
        onToggleDecline={toggleDecline}
        locked={locked}
        sent={Boolean(alreadySent)}
        availableCc={availableCc}
        ccEnabled={ccEnabled}
        blocking={blocking}
        onHtml={(html) => autosave.save({ agendaEmail: { html } })}
        onSend={send}
        sending={sending}
        {...(sendOutcome ? { outcome: sendOutcome } : {})}
      />

      <FormatOptions
        format={format}
        onFormat={setFormat}
        open={optionsOpen}
        onToggle={() => setOptionsOpen((value) => !value)}
        makeDefault={makeDefault}
        onMakeDefault={setMakeDefault}
        locked={locked}
      />

      <div className="card">
        <div className="card-head">
          <div className="card-title">What this one button will do</div>
          {approval?.finishedAt ? <span className="chip good">Done</span> : <span className="chip info">Nothing yet</span>}
        </div>
        <ul className="flex flex-col gap-2">
          {plan.map((line) => (
            <li key={line} className="flex gap-2 text-[0.85rem] leading-6" style={{ color: "var(--text-2)" }}>
              <span className="sig-dot good" style={{ flexShrink: 0, marginTop: 8 }} />
              <span>{line}</span>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn btn-primary"
            onClick={approve}
            disabled={running || Boolean(approval?.finishedAt)}
          >
            {running ? <Loader2 className="animate-spin" /> : <Rocket />}
            {approval?.finishedAt ? "Approved — go to the Live call" : "Approve & go to Live call"}
          </button>
          <span className="muted text-[0.8rem]">
            {approvalHint({ approving, declined, ...(approval?.finishedAt ? { finishedAt: whenLabel(approval.finishedAt) } : {}) })}
          </span>
        </div>
        {!approval?.finishedAt ? (
          <p className="muted mt-2 text-[0.78rem]">
            Nothing is sent, written or created until you press it.
          </p>
        ) : null}
      </div>

      {showModal ? (
        <ProgressModal
          approval={approval}
          running={running}
          format={format}
          message={message}
          onClose={() => setShowModal(false)}
          touchId={touchId}
        />
      ) : null}
    </div>
  );
}

function whenLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function EmailCard({
  email,
  subject,
  onSubject,
  declined,
  onToggleDecline,
  locked,
  sent,
  availableCc,
  ccEnabled,
  blocking,
  onHtml,
  onSend,
  sending,
  outcome,
}: {
  email: TouchAgendaEmailState;
  subject: string;
  onSubject: (value: string) => void;
  declined: boolean;
  onToggleDecline: () => void;
  locked: boolean;
  sent: boolean;
  availableCc: string[];
  ccEnabled: boolean;
  blocking: string[];
  onHtml: (html: string) => void;
  onSend: () => void;
  sending: boolean;
  outcome?: AgendaSendOutcome;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  // The initial HTML is written in once, by ref, and never again: re-rendering a `contentEditable`
  // from state puts the caret back at the start of the document on every keystroke.
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      bodyRef.current = node;
      if (node && !node.dataset.loaded) {
        node.innerHTML = email.html;
        node.dataset.loaded = "1";
      }
    },
    [email.html],
  );

  const command = useCallback(
    (name: string) => {
      const node = bodyRef.current;
      if (!node || locked || declined) return;
      node.focus();
      if (name === "createLink") {
        const url = window.prompt("Link address (https://…)");
        // Only an https link ever reaches a client. A `javascript:` href pasted in here would be
        // inert in a mail client and would get the message filed as spam.
        if (!url || !/^https?:\/\//i.test(url)) return;
        document.execCommand("createLink", false, url);
      } else {
        document.execCommand(name);
      }
      onHtml(node.innerHTML);
    },
    [declined, locked, onHtml],
  );

  const editable = !locked && !declined;

  return (
    <div className="card" style={declined ? { borderColor: "var(--risk)" } : undefined}>
      <div className="card-head">
        <div className="card-title flex items-center gap-2">
          <Mail style={{ width: 16, height: 16 }} />
          The agenda email the client gets
        </div>
        <div className="flex items-center gap-2">
          <span className={`chip ${declined ? "risk" : sent ? "good" : "info"}`}>
            {declined ? "Not being sent" : sent ? "Sent" : "Send it, or let the approval send it"}
          </span>
          {declined && !locked ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onToggleDecline}>
              <Undo2 />
              Send it after all
            </button>
          ) : null}
        </div>
      </div>

      <dl className="grid gap-1 text-[0.82rem] sm:grid-cols-[72px_minmax(0,1fr)] sm:gap-x-3">
        <dt className="eyebrow muted">From</dt>
        <dd style={{ color: "var(--text-2)" }}>
          support@mapranking.com, through your own Intercom — the client&apos;s reply comes back to your Intercom
          inbox.
        </dd>
        <dt className="eyebrow muted">To</dt>
        <dd style={{ color: "var(--text-2)" }}>
          {email.recipient || <span className="muted">— no address on file</span>}
          <div className="muted mt-0.5 text-[0.78rem]">{email.recipientSource}</div>
        </dd>
        <dt className="eyebrow muted">Copy</dt>
        <dd style={{ color: "var(--text-2)" }}>
          {ccEnabled && availableCc.length ? (
            availableCc.join(", ")
          ) : availableCc.length ? (
            <span className="muted">
              {availableCc.join(", ")} — not copied, because &quot;copy the office contact&quot; is off in your
              preferences
            </span>
          ) : (
            <span className="muted">
              — no other client address is on this touch&apos;s calendar event, so there is nobody to copy
            </span>
          )}
        </dd>
      </dl>

      {blocking.length ? (
        <div
          className="mt-3 rounded-[10px] p-3"
          style={{ background: "var(--watch-bg)" }}
        >
          <div className="eyebrow flex items-center gap-1.5" style={{ color: "var(--watch)" }}>
            <AlertTriangle style={{ width: 13, height: 13 }} />
            Fix before this can be sent
          </div>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {blocking.map((gap) => (
              <li key={gap} className="text-[0.82rem] leading-6" style={{ color: "var(--text-2)" }}>
                {gap}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <label className="mt-3 block">
        <span className="eyebrow muted">Subject</span>
        <input
          className="input mt-1"
          value={subject}
          onChange={(event) => onSubject(event.target.value)}
          disabled={!editable}
        />
      </label>

      {editable ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {TOOLBAR.map((button) => (
            <button
              key={button.command}
              type="button"
              className="btn btn-ghost btn-sm"
              title={button.title}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => command(button.command)}
            >
              {button.label}
            </button>
          ))}
        </div>
      ) : null}

      <div
        ref={attach}
        contentEditable={editable}
        suppressContentEditableWarning
        onInput={() => {
          const node = bodyRef.current;
          if (node) onHtml(node.innerHTML);
        }}
        className="mt-3 rounded-[10px] p-4"
        style={{
          background: "#EEF3FA",
          color: "#101828",
          minHeight: 220,
          outline: "none",
          opacity: declined ? 0.45 : 1,
        }}
      />

      <p className="muted mt-2 text-[0.78rem]">
        {declined
          ? "This email will not be sent, and the client will hear nothing from us before the call."
          : sent
            ? `Sent${email.sentAt ? ` ${whenLabel(email.sentAt)}` : ""}${email.sentVia ? ` via ${email.sentVia}` : ""}. This is what the client received.`
            : "Edit it like a document — bold, lists and links come through as formatting."}
      </p>

      {/*
        What the last send attempt did. A blocked or failed send is shown here rather than swallowed
        because the thing to fix -- a missing address, an empty body, an Intercom permission -- is
        in this card, a few lines above the message saying so.
      */}
      {outcome ? (
        <p
          className="mt-3 rounded-[10px] px-3 py-2.5 text-[0.82rem] leading-6"
          style={
            outcome.status === "sent" || outcome.status === "already_sent"
              ? { background: "var(--good-bg)", color: "var(--good)" }
              : outcome.status === "declined"
                ? { background: "var(--watch-bg)", color: "var(--watch)" }
                : { background: "var(--risk-bg)", color: "var(--risk)" }
          }
        >
          {outcome.status === "sent" || outcome.status === "already_sent" ? (
            <CheckCircle2
              style={{ width: 14, height: 14, display: "inline", marginRight: 6, verticalAlign: "-2px" }}
            />
          ) : null}
          {outcome.detail}
        </p>
      ) : null}

      {/*
        Approve and Send sits under the email it sends, not in a toolbar at the top: the AM is the
        last person to read this before a client does, and the button belongs where they finish
        reading. Moving forward without it is a quiet link rather than a second button, because
        sending it is the normal path and the two are not equal choices.
      */}
      {!locked && !declined ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onSend}
            disabled={sending || blocking.length > 0}
          >
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
            Approve and Send
          </button>
          <span className="muted text-[0.8rem]">
            {blocking.length
              ? "Fix the item above first — there is nowhere to send it."
              : `Goes to ${email.recipient || "the client"} now. If you don't, the approval sends it.`}
          </span>
        </div>
      ) : null}

      {!locked && !declined ? (
        <p className="mt-2.5">
          <button type="button" className="link-quiet" onClick={onToggleDecline}>
            Move forward without sending
          </button>
        </p>
      ) : null}
    </div>
  );
}

function FormatOptions({
  format,
  onFormat,
  open,
  onToggle,
  makeDefault,
  onMakeDefault,
  locked,
}: {
  format: LiveCallFormat;
  onFormat: (value: LiveCallFormat) => void;
  open: boolean;
  onToggle: () => void;
  makeDefault: boolean;
  onMakeDefault: (value: boolean) => void;
  locked: boolean;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title flex items-center gap-2">
          <Presentation style={{ width: 16, height: 16 }} />
          How you&apos;ll run the call
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onToggle}>
          {open ? "Hide" : "Change"}
        </button>
      </div>
      <p className="muted text-[0.84rem]">
        {format === "deck"
          ? "Client presentation — slides for them, a presenter script for you."
          : "Call guide — a timed run-sheet for you, nothing on the client's screen."}
      </p>

      {open && !locked ? (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {(
              [
                ["guide", "Call guide", "A timed run-sheet. Fastest to read mid-call."],
                ["deck", "Client presentation", "Branded slides you share, plus your own script."],
              ] as [LiveCallFormat, string, string][]
            ).map(([value, title, hint]) => (
              <button
                key={value}
                type="button"
                onClick={() => onFormat(value)}
                className="rounded-[12px] p-3 text-left"
                style={{
                  border: format === value ? "2px solid var(--accent)" : "1px solid var(--hair)",
                  background: format === value ? "var(--accent-soft)" : "var(--surface)",
                }}
              >
                <span style={{ display: "block", fontWeight: 660, color: "var(--text)", fontSize: "0.9rem" }}>
                  {title}
                </span>
                <span className="muted text-[0.8rem]">{hint}</span>
              </button>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2 text-[0.82rem]" style={{ color: "var(--text-2)" }}>
            <input
              type="checkbox"
              checked={makeDefault}
              onChange={(event) => onMakeDefault(event.target.checked)}
            />
            Make this my default for every touch
          </label>
        </>
      ) : null}
    </div>
  );
}

/**
 * The four steps, as they actually went.
 *
 * While the request is in flight the step shown as working is the first one that has not already
 * settled, which is genuinely the one the server is on -- the four run in order, server-side, in
 * this one request. Nothing is ticked off on a timer.
 */
function ProgressModal({
  approval,
  running,
  format,
  message,
  onClose,
  touchId,
}: {
  approval?: TouchApprovalState;
  running: boolean;
  format: LiveCallFormat;
  message?: string;
  onClose: () => void;
  touchId: string;
}) {
  const state = approval || emptyApprovalState();
  const working = running ? nextApprovalStep(state) : undefined;
  const done = Boolean(approval?.finishedAt);
  const failed = APPROVAL_STEPS.find((id) => state.steps[id].status === "failed");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Approving and preparing your call"
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: "rgba(16,24,40,0.55)" }}
    >
      <div className="card" style={{ maxWidth: 520, width: "100%" }}>
        <div className="card-head">
          <div className="card-title">
            {done ? "Ready for the call" : running ? "Approving and preparing your call…" : "Approval stopped"}
          </div>
          {!running ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
              <X />
              Close
            </button>
          ) : null}
        </div>

        <ol className="flex flex-col gap-3">
          {APPROVAL_STEPS.map((id) => (
            <StepRow key={id} id={id} state={state} working={working === id} />
          ))}
        </ol>

        {message ? (
          <p
            className="mt-4 rounded-[10px] p-3 text-[0.84rem] leading-6"
            style={
              failed
                ? { background: "var(--risk-bg)", color: "var(--risk)" }
                : { background: "var(--surface-2)", color: "var(--text-2)" }
            }
          >
            {message}
          </p>
        ) : null}

        {done ? (
          <a className="btn btn-primary mt-4" href={`/monthly-touch/${touchId}?stage=live`}>
            {format === "deck" ? "Open the presentation" : "Open the call guide"}
          </a>
        ) : null}
      </div>
    </div>
  );
}

function StepRow({
  id,
  state,
  working,
}: {
  id: ApprovalStepId;
  state: TouchApprovalState;
  working: boolean;
}) {
  const step = state.steps[id];
  const settled = stepIsSettled(step);
  const failed = step.status === "failed";

  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden
        className={working ? "animate-spin" : undefined}
        style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          fontSize: "0.72rem",
          fontWeight: 800,
          color: settled || failed ? "#ffffff" : "var(--slate-300)",
          background: failed
            ? "var(--risk)"
            : step.status === "done"
              ? "var(--good)"
              : step.status === "skipped"
                ? "var(--slate-300)"
                : working
                  ? "transparent"
                  : "var(--surface-3)",
          border: working ? "2.5px solid var(--hair)" : undefined,
          borderTopColor: working ? "var(--accent)" : undefined,
        }}
      >
        {step.status === "done" ? <Check style={{ width: 13, height: 13 }} /> : failed ? "!" : ""}
      </span>
      <span className="min-w-0">
        <span
          style={{
            display: "block",
            fontSize: "0.88rem",
            fontWeight: 620,
            color: settled || failed || working ? "var(--text)" : "var(--slate-300)",
          }}
        >
          {step.status === "skipped" ? `${APPROVAL_STEP_LABEL[id]} — skipped` : APPROVAL_STEP_LABEL[id]}
        </span>
        {step.detail ? (
          <span className="muted text-[0.8rem] leading-6" style={{ display: "block" }}>
            {step.detail}
          </span>
        ) : null}
      </span>
    </li>
  );
}
