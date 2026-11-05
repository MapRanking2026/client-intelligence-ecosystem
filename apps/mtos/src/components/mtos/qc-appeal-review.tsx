"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";

import { readJsonResponse } from "@/src/lib/api/read-json-response";
import { criterionByNumber } from "@/src/lib/contracts/qc-rubric";
import { qcDateLabel as dateLabel } from "@/src/lib/contracts/qc-dates";
import type { QcAppealDecision, TouchQc } from "@/src/lib/contracts/qc-record";
import {
  appealDecisionsComplete,
  appealPreview,
  appealPreviewLabel,
} from "@/src/lib/contracts/qc-submit";

/**
 * Deciding an appeal: accept or keep, one criterion at a time, with a reply.
 *
 * ## The preview is a promise
 *
 * The navy bar shows the score the current decisions would produce, computed by the same function
 * the server uses to store it (`appealPreview` over `applyAppealDecisions`). A bar that said
 * "80 → 84" and then saved 83 would be a promise broken in writing, to someone who had already
 * been told a number once.
 *
 * ## Keeping a score is a decision, not a non-answer
 *
 * Every appealed criterion needs an explicit Accept or Keep before the reply can be sent. An AM who
 * took the trouble to explain what QC could not see is owed an answer on each point, and silence on
 * one of them would read as the appeal having been skimmed.
 */

export function QcAppealReview({
  touchId,
  qc,
  client,
  amName,
  amFirstName,
  scheduledAt,
  canScore,
}: {
  touchId: string;
  qc: TouchQc;
  client: string;
  amName: string;
  amFirstName: string;
  scheduledAt?: string;
  /** False for an admin or manager: only a reviewer decides an appeal. */
  canScore: boolean;
}) {
  const router = useRouter();
  const appeal = qc.appeal;
  const [decisions, setDecisions] = useState<QcAppealDecision[]>(appeal?.decisions || []);
  const [reply, setReply] = useState(appeal?.reply || "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // "Resolved" here means read-only, which an admin viewing the appeal also is.
  const resolved = appeal?.status === "resolved" || !canScore;
  const preview = useMemo(() => appealPreview(qc.crit, decisions), [qc.crit, decisions]);
  const complete = appeal ? appealDecisionsComplete(appeal.items, decisions) : false;

  const decide = useCallback((n: number, to: number, accept: boolean) => {
    setDecisions((current) => [
      ...current.filter((decision) => decision.n !== n),
      { n, to, accept },
    ]);
  }, []);

  const send = useCallback(async () => {
    setSending(true);
    setError("");
    try {
      const response = await fetch(`/api/qc/${touchId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resolve_qc_appeal", decisions, reply }),
      });
      const payload = await readJsonResponse<{ error?: string }>(response);
      if (!response.ok) throw new Error(payload?.error || "The decision could not be sent.");
      router.push(`/qa?decided=${touchId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The decision could not be sent.");
      setSending(false);
    }
  }, [touchId, decisions, reply, router]);

  if (!appeal) {
    return (
      <>
        <Link href="/qa" className="ilink text-[0.8rem]">
          <ArrowLeft className="mr-1 inline" style={{ width: 14, height: 14 }} />
          QC queue
        </Link>
        <div className="card mt-4">
          <p className="muted text-[0.86rem]">There is no appeal on this touch.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <Link href="/qa" className="ilink text-[0.8rem]">
        <ArrowLeft className="mr-1 inline" style={{ width: 14, height: 14 }} />
        QC queue
      </Link>

      <div className="section-head" style={{ marginTop: 10 }}>
        <div>
          <div className="eyebrow" style={{ color: "var(--violet)" }}>
            <span>Score appeal</span>
          </div>
          <h2 className="h2 mt-2">{client}</h2>
          <div className="muted mt-1 text-[0.82rem]">
            {amName || "Unnamed account manager"} · {dateLabel(scheduledAt)} · scored{" "}
            {typeof appeal.from === "number" ? appeal.from : "—"}
            {qc.rating ? ` (${qc.rating})` : ""} on {dateLabel(qc.scoredAt)} · appeal sent{" "}
            {dateLabel(appeal.submittedAt)}
          </div>
        </div>
      </div>

      {appeal.note ? (
        <div className="card mb-4" style={{ background: "var(--surface-2)" }}>
          <div className="muted text-[0.72rem]">{amFirstName || "The AM"} wrote</div>
          <p className="mt-1 text-[0.86rem] leading-6" style={{ color: "var(--text)" }}>
            {appeal.note}
          </p>
        </div>
      ) : null}

      {appeal.status === "resolved" ? (
        <div className="card mb-4" style={{ background: "var(--surface-2)" }}>
          <div className="font-semibold text-[0.86rem]">This appeal has already been decided.</div>
          <p className="muted mt-1 text-[0.82rem]">
            Decided {dateLabel(appeal.resolvedAt)}. It is shown as it was sent.
          </p>
        </div>
      ) : canScore ? null : (
        <div className="card mb-4" style={{ background: "var(--surface-2)" }}>
          <div className="font-semibold text-[0.86rem]">You are viewing this appeal.</div>
          <p className="muted mt-1 text-[0.82rem]">
            Appeals are decided by a QC reviewer, the same person who produced the score.
          </p>
        </div>
      )}

      <div className="grid gap-3">
        {appeal.items.map((item) => {
          const criterion = criterionByNumber(item.n);
          const current = qc.crit?.[item.n - 1];
          const decision = decisions.find((entry) => entry.n === item.n);
          return (
            <div key={item.n} className="card">
              <div className="font-semibold text-[0.88rem]" style={{ color: "var(--text)" }}>
                {item.n} · {criterion?.name || `Criterion ${item.n}`}
              </div>
              <div className="muted mt-1 text-[0.8rem]">
                Scored {current === null || current === undefined ? "—" : current} · asks for {item.to}
              </div>

              {qc.notes?.[item.n]?.found ? (
                <div className="mt-2 text-[0.8rem] leading-6">
                  <span className="muted">Your note: </span>
                  <span style={{ color: "var(--text-2)" }}>{qc.notes[item.n].found}</span>
                </div>
              ) : null}

              <div className="mt-2 text-[0.8rem] leading-6">
                <span className="muted">Context from {amFirstName || "the AM"}: </span>
                <span style={{ color: "var(--text)" }}>{item.ctx}</span>
              </div>

              {item.link ? (
                <a className="ilink mt-2 inline-block text-[0.78rem]" href={item.link} target="_blank" rel="noreferrer">
                  Evidence ↗
                </a>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={resolved}
                  onClick={() => decide(item.n, item.to, true)}
                  aria-pressed={decision?.accept === true}
                  className="btn text-[0.8rem]"
                  style={
                    decision?.accept === true
                      ? { background: "var(--good)", color: "#fff", borderColor: "transparent" }
                      : undefined
                  }
                >
                  Accept · change to {item.to}
                </button>
                <button
                  type="button"
                  disabled={resolved}
                  onClick={() => decide(item.n, item.to, false)}
                  aria-pressed={decision?.accept === false}
                  className="btn text-[0.8rem]"
                  style={
                    decision?.accept === false
                      ? { background: "var(--surface-3)", color: "var(--text)" }
                      : undefined
                  }
                >
                  Keep {current === null || current === undefined ? "the score" : current}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card mt-4">
        <div className="eyebrow muted">Reply to {amFirstName || "the AM"}</div>
        <textarea
          className="input mt-2 w-full"
          rows={4}
          disabled={resolved}
          value={reply}
          onChange={(event) => setReply(event.target.value)}
          placeholder="What you changed, what you kept, and why. They read this with the new score."
        />
      </div>

      {resolved ? null : (
        <div
          className="card mt-5 flex flex-wrap items-center justify-between gap-3"
          style={{ background: "#0f2a44", borderColor: "transparent" }}
        >
          <div className="text-[0.84rem]" style={{ color: "#dbe6f0" }}>
            {error ||
              (complete
                ? appealPreviewLabel(preview)
                : "Every appealed criterion needs a decision before the reply can be sent.")}
          </div>
          <button
            type="button"
            className="btn btn-primary text-[0.84rem]"
            disabled={!complete || sending}
            onClick={() => void send()}
          >
            {sending ? (
              <Loader2 className="mr-1 inline animate-spin" style={{ width: 14, height: 14 }} />
            ) : null}
            Send decision to {amFirstName || "the AM"}
          </button>
        </div>
      )}
    </>
  );
}
