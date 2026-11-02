"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CircleSlash,
  Pencil,
  RotateCcw,
  Save,
  TriangleAlert,
  X,
} from "lucide-react";

import { SmartMarkdown } from "@/src/components/mtos/annotate";
import { SourceChips } from "@/src/components/mtos/source-chip";
import { useTouchAutosave } from "@/src/components/mtos/use-touch-autosave";
import {
  approvalSummary,
  reviewSections,
  type BriefProposal,
  type BriefSectionId,
  type PrepBrief,
  type ReviewSection,
  type SectionState,
} from "@/src/lib/contracts/prep-brief";
import type { TouchCoachingChoice, TouchReviewState } from "@/src/lib/mtos-data";

/**
 * The review step: the whole Pre-Monthly Touch brief, as the account manager reads it before the
 * call and as it will be posted to the Client's Book.
 *
 * Three decisions in here are the ones that matter.
 *
 * **No per-section approve buttons.** Fifteen approve buttons is fifteen chances to be half done,
 * and the old screens reloaded on each one and threw away everything typed in the others. The AM
 * edits or declines, and one approval at the bottom covers the brief.
 *
 * **Declining is not deleting.** A declined section stays in the record -- it was considered, and
 * next month's preparation can see that -- and is excluded from the Client's Book post and from
 * the live guide or deck. Undo is one click, because declining the wrong section while scanning
 * is the easiest mistake on this screen.
 *
 * **A section the preparation could not write says so.** A brief that quietly omits the goal reads
 * as a client with no goal. `missing` keeps the gap visible and declinable like the rest.
 *
 * Editing uses a `contentEditable` surface with `document.execCommand`, which is formally
 * deprecated and still the only thing every browser implements for this. The alternative is an
 * editor dependency for seven buttons. If it is ever replaced, the stored value is HTML either
 * way, so nothing else has to change.
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

const STATE_CHIP: Record<SectionState, { cls: string; label: string }> = {
  written: { cls: "muted", label: "Ready" },
  edited: { cls: "info", label: "Edited" },
  declined: { cls: "risk", label: "Declined" },
  missing: { cls: "watch", label: "Not written" },
};

export function ReviewBrief({
  touchId,
  clientId,
  brief,
  review,
  /** The header block, built on the server from the client and calendar records. */
  header,
  /** Section 15, the client-facing email, which has its own card and its own approval. */
  agendaEmail,
  /** The pre-call checklist, rendered after the brief as the prompt's section 16. */
  checklist,
}: {
  touchId: string;
  clientId: string;
  brief: PrepBrief;
  review?: TouchReviewState;
  header?: React.ReactNode;
  agendaEmail?: React.ReactNode;
  checklist?: React.ReactNode;
}) {
  const autosave = useTouchAutosave(touchId);
  const [declined, setDeclined] = useState<string[]>(review?.declinedSections || []);
  const [edits, setEdits] = useState<Record<string, string>>(review?.sectionEdits || {});
  const [coaching, setCoaching] = useState<Record<string, TouchCoachingChoice>>(review?.coaching || {});
  const [editing, setEditing] = useState<BriefSectionId | undefined>();

  const sections = useMemo(
    () => reviewSections(brief, { declinedSections: declined, sectionEdits: edits }),
    [brief, declined, edits],
  );
  const summary = approvalSummary({ declinedSections: declined });

  const toggleDecline = useCallback(
    (id: BriefSectionId) => {
      setDeclined((current) => {
        const next = current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id];
        autosave.save({ review: { declinedSections: next } });
        return next;
      });
    },
    [autosave],
  );

  const saveEdit = useCallback(
    (id: BriefSectionId, html: string) => {
      setEdits((current) => {
        const next = { ...current, [id]: html };
        autosave.save({ review: { sectionEdits: next } });
        return next;
      });
      setEditing(undefined);
    },
    [autosave],
  );

  const revertEdit = useCallback(
    (id: BriefSectionId) => {
      setEdits((current) => {
        const next = { ...current };
        delete next[id];
        // The key is sent as an empty string rather than removed: a patch merges, so a deleted key
        // would simply leave the stored edit in place and the revert would not survive a reload.
        autosave.save({ review: { sectionEdits: { ...next, [id]: "" } } });
        return next;
      });
      setEditing(undefined);
    },
    [autosave],
  );

  const answerProposal = useCallback(
    (id: string, choice: TouchCoachingChoice["choice"], reason?: string) => {
      setCoaching((current) => {
        const next = { ...current, [id]: { choice, ...(reason ? { reason } : {}) } };
        autosave.save({ review: { coaching: next } });
        return next;
      });
    },
    [autosave],
  );

  return (
    <div className="mt-4 grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)]">
      <Toc sections={sections} />

      <div className="min-w-0">
        <SaveLine autosave={autosave} />

        {brief.gaps.length ? (
          <div className="card mt-4" style={{ borderColor: "var(--watch)" }}>
            <div className="card-head">
              <div className="card-title flex items-center gap-2">
                <TriangleAlert style={{ width: 16, height: 16, color: "var(--watch)" }} />
                Missing — confirm before or during the call
              </div>
              <span className="chip watch">{brief.gaps.length}</span>
            </div>
            <ul className="mt-1 flex flex-col gap-3">
              {brief.gaps.map((gap) => (
                <li key={gap.item} className="text-[0.86rem] leading-6" style={{ color: "var(--text-2)" }}>
                  <strong style={{ color: "var(--text)" }}>{gap.item}</strong>
                  {gap.whyItMatters ? ` — ${gap.whyItMatters}` : ""}
                  {gap.askOrCheck ? (
                    <div className="muted mt-0.5 text-[0.8rem]">Ask or check: {gap.askOrCheck}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {sections.map((section) => (
          <SectionCard
            key={section.id}
            section={section}
            clientId={clientId}
            editing={editing === section.id}
            onEdit={() => setEditing(section.id)}
            onCancelEdit={() => setEditing(undefined)}
            onSave={(html) => saveEdit(section.id, html)}
            onRevert={() => revertEdit(section.id)}
            onToggleDecline={() => toggleDecline(section.id)}
            extra={
              section.id === "h"
                ? header
                : section.id === "1"
                  ? (
                      <Promises
                        brief={brief}
                        coaching={coaching}
                        onAnswer={answerProposal}
                      />
                    )
                  : section.id === "15"
                    ? agendaEmail
                    : undefined
            }
          />
        ))}

        {checklist ? <div className="mt-5">{checklist}</div> : null}

        <div className="card mt-5">
          <div className="card-head">
            <div className="card-title">What one approval will do</div>
            <span className="chip info">
              {summary.approving} of {summary.approving + summary.declined.length} sections
            </span>
          </div>
          <p className="muted text-[0.84rem] leading-6">
            Approving the brief posts these {summary.approving} sections to the client&apos;s Client&apos;s Book, sends
            the client-facing agenda unless it is declined, and builds the live call from the same sections.
            {summary.declined.length
              ? ` Declined and left out: ${summary.declined.map((id) => `section ${id}`).join(", ")}.`
              : " Nothing is declined."}
          </p>
          <p className="muted mt-2 text-[0.8rem]">
            Nothing is created, written or sent before you press it. The button lives in the agenda card below the
            brief.
          </p>
        </div>
      </div>
    </div>
  );
}

function SaveLine({ autosave }: { autosave: ReturnType<typeof useTouchAutosave> }) {
  if (autosave.state === "error") {
    return (
      <div
        className="flex items-center gap-2 rounded-[10px] p-3 text-[0.82rem]"
        style={{ background: "var(--risk-bg)", color: "var(--risk)" }}
      >
        <AlertTriangle style={{ width: 14, height: 14 }} />
        <span style={{ fontWeight: 600 }}>{autosave.error}</span>
        <span>Your text is still on this screen and will be sent again — don&apos;t retype it.</span>
      </div>
    );
  }
  return (
    <p className="muted text-[0.78rem]">
      {autosave.state === "saving"
        ? "Saving…"
        : autosave.savedAt
          ? `Saved ${new Date(autosave.savedAt).toLocaleTimeString()} — edits save as you type.`
          : "Edits save as you type."}
    </p>
  );
}

function Toc({ sections }: { sections: ReviewSection[] }) {
  return (
    <nav className="hidden xl:block" aria-label="Brief sections">
      <div className="sticky top-4 flex flex-col gap-0.5">
        {sections.map((section) => (
          <a
            key={section.id}
            href={`#brief-${section.id}`}
            className="flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-[0.78rem]"
            style={{ color: "var(--slate-300)" }}
          >
            <span
              className={`sig-dot ${
                section.state === "declined" ? "risk" : section.state === "missing" ? "watch" : "good"
              }`}
              style={{ flexShrink: 0 }}
            />
            <span style={{ fontWeight: 650, width: 16, flexShrink: 0 }}>{section.n}</span>
            <span className="truncate">{section.title}</span>
          </a>
        ))}
      </div>
    </nav>
  );
}

function SectionCard({
  section,
  clientId,
  editing,
  onEdit,
  onCancelEdit,
  onSave,
  onRevert,
  onToggleDecline,
  extra,
}: {
  section: ReviewSection;
  clientId: string;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (html: string) => void;
  onRevert: () => void;
  onToggleDecline: () => void;
  extra?: React.ReactNode;
}) {
  const chip = STATE_CHIP[section.state];
  const declined = section.state === "declined";

  return (
    <section id={`brief-${section.id}`} className="card mt-4" style={declined ? { opacity: 0.6 } : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow muted">Section {section.n}</div>
          <div className="h4 mt-1">{section.title}</div>
          <p className="muted mt-1 text-[0.82rem]">{section.purpose}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`chip ${chip.cls}`}>{chip.label}</span>
          {section.declinable ? (
            declined ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onToggleDecline}>
                <RotateCcw />
                Undo decline
              </button>
            ) : (
              <>
                {section.edited ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={onRevert} title="Back to the generated text">
                    <RotateCcw />
                    Revert
                  </button>
                ) : null}
                {editing ? null : (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
                    <Pencil />
                    Edit
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={onToggleDecline}
                  style={{ border: "1px solid #f3c5c5", color: "var(--risk)", background: "var(--surface)" }}
                >
                  <CircleSlash />
                  Decline
                </button>
              </>
            )
          ) : null}
        </div>
      </div>

      {declined ? (
        <p className="muted mt-3 text-[0.84rem]">
          Declined. It stays on the record and is left out of the Client&apos;s Book post and the live call.
        </p>
      ) : editing ? (
        <RichEditor
          initialHtml={section.edited || blocksToHtml(section)}
          onCancel={onCancelEdit}
          onSave={onSave}
        />
      ) : (
        <div className="mt-3">
          {section.edited ? (
            <div
              className="brief-body text-[0.88rem] leading-7"
              style={{ color: "var(--text-2)" }}
              // Stored HTML from this screen's own editor, written by the signed-in account
              // manager. It is their own text going back to their own screen.
              dangerouslySetInnerHTML={{ __html: section.edited }}
            />
          ) : section.blocks.length ? (
            section.blocks.map((block, index) => (
              <div key={`${block.id}-${index}`} className={index ? "mt-4" : ""}>
                {block.subtitle ? (
                  <div className="eyebrow muted mb-1.5">{block.subtitle}</div>
                ) : null}
                <div className="text-[0.88rem] leading-7" style={{ color: "var(--text-2)" }}>
                  <SmartMarkdown text={block.markdown} clientId={clientId} />
                </div>
                <SourceChips chips={block.chips} />
              </div>
            ))
          ) : section.state === "missing" ? (
            <p className="muted text-[0.84rem]">
              The preparation did not write this section — usually because the data behind it was not available.
              Edit it to write it yourself, or decline it to leave it out.
            </p>
          ) : null}
          {extra ? <div className="mt-4">{extra}</div> : null}
        </div>
      )}
    </section>
  );
}

/** The generated text as the editor's starting point, so editing never begins from a blank box. */
function blocksToHtml(section: ReviewSection): string {
  return section.blocks
    .map((block) => {
      const heading = block.subtitle ? `<p><strong>${escapeHtml(block.subtitle)}</strong></p>` : "";
      const body = block.markdown
        .split(/\n{2,}/)
        .map((paragraph) => `<p>${escapeHtml(paragraph).split("\n").join("<br>")}</p>`)
        .join("");
      return heading + body;
    })
    .join("");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>]/g, (character) =>
    character === "&" ? "&amp;" : character === "<" ? "&lt;" : "&gt;",
  );
}

function RichEditor({
  initialHtml,
  onCancel,
  onSave,
}: {
  initialHtml: string;
  onCancel: () => void;
  onSave: (html: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  const run = (command: string) => {
    const editor = ref.current;
    if (!editor) return;
    editor.focus();
    if (command === "createLink") {
      const url = globalThis.prompt("Link to where?");
      if (!url) return;
      // Only http(s): a `javascript:` link pasted here would be stored and re-rendered later.
      if (!/^https?:\/\//i.test(url)) return;
      document.execCommand("createLink", false, url);
      return;
    }
    document.execCommand(command, false);
  };

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {TOOLBAR.map((button) => (
          <button
            key={button.command}
            type="button"
            className="btn btn-ghost btn-sm"
            title={button.title}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run(button.command)}
          >
            {button.label}
          </button>
        ))}
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Section text"
        className="brief-body mt-2 text-[0.88rem] leading-7"
        style={{
          minHeight: 160,
          border: "1px solid var(--hair-strong)",
          borderRadius: "var(--r-md)",
          padding: 14,
          color: "var(--text-2)",
          background: "var(--surface)",
          outline: "none",
        }}
        dangerouslySetInnerHTML={{ __html: initialHtml }}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => onSave(ref.current?.innerHTML || "")}
        >
          <Save />
          Save section
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          <X />
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Section 1: what we promised, and the coaching the AM answers.
 *
 * The promises are facts and carry no controls. The coaching items and QC proposals are
 * suggestions, so each one ends in a decision the AM makes -- Use, Adapt or Skip, with a reason.
 * QC reads the call and not the sales promise or the client's history, which is exactly why the
 * person who knows the account decides.
 */
function Promises({
  brief,
  coaching,
  onAnswer,
}: {
  brief: PrepBrief;
  coaching: Record<string, TouchCoachingChoice>;
  onAnswer: (id: string, choice: TouchCoachingChoice["choice"], reason?: string) => void;
}) {
  if (!brief.promises.length && !brief.focus.length && !brief.proposals.length) return null;
  return (
    <div className="flex flex-col gap-4">
      {brief.promises.length ? (
        <div>
          <div className="eyebrow muted">Before this call: what we promised</div>
          <ul className="mt-2 flex flex-col gap-2.5">
            {brief.promises.map((promise, index) => (
              <li
                key={`${promise.what}-${index}`}
                className="rounded-[10px] p-3 text-[0.86rem] leading-6"
                style={{ background: "var(--surface-2)", border: "1px solid var(--hair)" }}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span
                    className={`chip ${
                      promise.status === "delivered" ? "good" : promise.status === "not_delivered" ? "risk" : "watch"
                    }`}
                  >
                    {promise.status === "delivered" ? "Delivered" : promise.status === "not_delivered" ? "Not delivered" : "Unverified"}
                  </span>
                  {promise.byWhen ? <span className="muted text-[0.78rem]">by {promise.byWhen}</span> : null}
                </span>
                <div className="mt-1.5" style={{ color: "var(--text)" }}>
                  {promise.what}
                </div>
                {promise.howToOwnIt && promise.status !== "delivered" ? (
                  <div className="muted mt-1 text-[0.8rem]">How to own it: {promise.howToOwnIt}</div>
                ) : null}
                <SourceChips chips={promise.chips} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {brief.focus.length ? (
        <ProposalList
          label="Your focus for this call (from your QCs)"
          items={brief.focus}
          coaching={coaching}
          onAnswer={onAnswer}
        />
      ) : null}
      {brief.proposals.length ? (
        <ProposalList
          label="Proposals from your last QC for this client"
          items={brief.proposals}
          coaching={coaching}
          onAnswer={onAnswer}
        />
      ) : null}
    </div>
  );
}

const CHOICES: { key: TouchCoachingChoice["choice"]; label: string }[] = [
  { key: "use", label: "Use" },
  { key: "adapt", label: "Adapt" },
  { key: "skip", label: "Skip" },
];

function ProposalList({
  label,
  items,
  coaching,
  onAnswer,
}: {
  label: string;
  items: BriefProposal[];
  coaching: Record<string, TouchCoachingChoice>;
  onAnswer: (id: string, choice: TouchCoachingChoice["choice"], reason?: string) => void;
}) {
  return (
    <div>
      <div className="eyebrow muted">{label}</div>
      <div className="mt-2 flex flex-col gap-3">
        {items.map((item) => {
          const answer = coaching[item.id];
          return (
            <div
              key={item.id}
              className="rounded-[10px] p-3.5"
              style={{ background: "var(--surface-2)", border: "1px solid var(--hair)" }}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="text-[0.88rem]" style={{ color: "var(--text)", fontWeight: 600 }}>
                  {item.idea}
                </div>
                {item.agreedWithJavier ? <span className="chip info">Agreed with Javier</span> : null}
              </div>
              {item.why ? (
                <p className="muted mt-1.5 text-[0.82rem] leading-6">
                  <strong style={{ color: "var(--slate-300)" }}>Why:</strong> {item.why}
                </p>
              ) : null}
              {item.howItCouldSound ? (
                <blockquote
                  className="mt-2 text-[0.84rem] leading-6"
                  style={{ borderLeft: "3px solid var(--accent)", paddingLeft: 12, color: "var(--text-2)" }}
                >
                  {item.howItCouldSound}
                </blockquote>
              ) : null}
              {item.whenToSkip ? (
                <p className="muted mt-2 text-[0.8rem]">When to skip it: {item.whenToSkip}</p>
              ) : null}
              <SourceChips chips={item.chips} />

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="muted text-[0.78rem]">Your call:</span>
                {CHOICES.map((choice) => (
                  <button
                    key={choice.key}
                    type="button"
                    className={`btn btn-sm ${answer?.choice === choice.key ? "btn-primary" : "btn-ghost"}`}
                    onClick={() => onAnswer(item.id, choice.key, answer?.reason)}
                  >
                    {answer?.choice === choice.key ? <Check /> : null}
                    {choice.label}
                  </button>
                ))}
              </div>
              {answer ? (
                <input
                  className="input mt-2 w-full text-[0.82rem]"
                  placeholder={answer.choice === "skip" ? "Why you're skipping it (optional)" : "How you'll adapt it (optional)"}
                  defaultValue={answer.reason || ""}
                  onBlur={(event) => onAnswer(item.id, answer.choice, event.target.value.trim())}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
