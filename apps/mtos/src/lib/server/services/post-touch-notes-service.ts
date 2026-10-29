import type { TenantContext } from "@/src/lib/contracts/mtos";
import type {
  ClientBookLinks,
  ClientRecord,
  DraftTicket,
  MonthlyTouchRecord,
  PostTouchNotes,
} from "@/src/lib/mtos-data";
import { getServerEnv } from "@/src/lib/server/env";
import { getPromptText } from "@/src/lib/server/prompt-store";
import { writePostNotesToClientBook } from "@/src/lib/server/services/client-book-service";
import { buildTouchEvidence } from "@/src/lib/server/services/live-call-guide-service";
import { splitTranscriptPayload } from "@/src/lib/server/services/meeting-transcript-service";
import { callLlmForText, getNowIso, hasAnyLlmProvider } from "@/src/lib/server/services/mtos-ai";

/**
 * The Post-Monthly Touch Notes document.
 *
 * Map Ranking's record of a touch is a page in the client's Client's Book, not a field in MTOS: the
 * prep notes are this month's touch page and the post-call write-up is the `Post Monthly Touch Notes`
 * subpage beneath it, which the next prep reads back as client memory.
 *
 * It runs at the end of the post-meeting workflow, after the AM has confirmed the NPS and decided each
 * ticket, because that is the only point at which the document can be true: approved items carry the
 * ClickUp link of the ticket that was actually created, declined items are recorded as discussed but
 * not ticketed, and the score is the AM's own rather than the suggestion they may have overridden.
 */

/** `2026-10-28` -> `Oct 28, 2026`, in the AM's timezone rather than UTC. */
function readableDate(iso: string, timeZone = "America/Los_Angeles"): string {
  const date = new Date(iso);
  const when = Number.isNaN(date.getTime()) ? new Date() : date;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(when);
}

/** `Q4 2026`, from the meeting date -- the label the Quarterly Goal line carries. */
function quarterLabel(iso: string): string {
  const date = new Date(iso);
  const when = Number.isNaN(date.getTime()) ? new Date() : date;
  return `Q${Math.floor(when.getMonth() / 3) + 1} ${when.getFullYear()}`;
}

/**
 * One ticket as the notes need to see it: the AM's edited fields, the decision they made, and the
 * ClickUp link when the ticket exists. Deliberately not the model's original proposal -- the document
 * records what was agreed, not what was suggested.
 */
function describeTicket(ticket: DraftTicket) {
  return {
    decision: ticket.status === "approved" ? "approved" : "declined",
    title: ticket.title,
    description: ticket.description,
    department: ticket.department,
    owner: ticket.assignee,
    dueDate: ticket.dueDate,
    priority: ticket.priority,
    business: ticket.businessName,
    ticketType: ticket.ticketType,
    billingChangeType: ticket.billingChangeType,
    ticketUrl: ticket.clickupTaskUrl,
    /** Approved but never filed (ClickUp refused, or no list configured) -- say so, don't link it. */
    notFiledReason: ticket.status === "approved" && !ticket.clickupTaskUrl ? ticket.executionNote : undefined,
  };
}

/**
 * Write the notes and file them in the Client's Book.
 *
 * Returns what happened rather than throwing: the tickets are already created and the AM's decisions
 * are already saved by the time this runs, so a missing model or a ClickUp refusal must leave the
 * touch intact and surface as a note on the screen, never undo the approval.
 */
export async function generatePostTouchNotes(
  context: TenantContext,
  touch: MonthlyTouchRecord,
  client: ClientRecord | undefined,
  options: {
    accountManagerName: string;
    tickets: DraftTicket[];
    existingLinks?: ClientBookLinks;
  },
): Promise<PostTouchNotes> {
  const generatedAt = getNowIso();
  const postMeeting = touch.postMeeting;
  const clientName = client?.name || "";

  if (!postMeeting?.transcript) {
    return {
      markdown: "",
      generatedAt,
      errorMessage: "There is no transcript on this touch, so the post-meeting notes can't be written.",
    };
  }
  if (!clientName) {
    return {
      markdown: "",
      generatedAt,
      errorMessage:
        "MTOS can't see this touch's client, so it has no Client's Book to file the post-meeting notes in.",
    };
  }

  const env = getServerEnv();
  if (!hasAnyLlmProvider(env)) {
    return {
      markdown: "",
      generatedAt,
      errorMessage: "No AI provider is configured, so the post-meeting notes can't be written.",
    };
  }

  const health = postMeeting.clientIntelligence?.health;
  const intelligence = postMeeting.clientIntelligence;
  const touchDateIso = touch.scheduledAt || generatedAt;
  const { fullNotes: geminiFullNotes, transcript: verbatimTranscript } = splitTranscriptPayload(
    postMeeting.transcript,
  );

  const system = await getPromptText("internal_notes_prompt");
  const userText = [
    "Write the Post-Monthly Touch Notes for this touch, as the document itself.",
    "",
    health
      ? `The AM confirmed the score: ${health.nps ?? "none"}/10 — "${health.npsReason}". Reproduce that number and justification exactly.`
      : "The AM has not recorded a score for this touch. Write the NPS line as **NPS / Account Health: pending — AM to provide** and say in the summary that the notes are incomplete until it is filled.",
    `Label the Quarterly Goal line ${quarterLabel(touchDateIso)}.`,
    geminiFullNotes
      ? "You are given two views of the call: `transcript` is the verbatim dialogue and the only source of truth, and `geminiFullNotes` is Gemini's automated summary, for orientation only. Where they disagree, the transcript wins."
      : "You are given the verbatim transcript only.",
    "",
    JSON.stringify(
      {
        client: {
          businessName: clientName,
          industry: client?.industry,
          contact: client?.contact,
        },
        accountManager: options.accountManagerName,
        meetingDate: readableDate(touchDateIso),
        confirmedHealth: health
          ? {
              nps: health.nps,
              justification: health.npsReason,
              riskTier: health.riskTier,
              riskReason: health.riskReason,
              overrodeSuggestion: health.overrodeSuggestion,
            }
          : null,
        riskRegister: intelligence?.riskDetected
          ? {
              tier: intelligence.riskTier,
              decision: intelligence.riskRegisterStatus || "pending",
              taskUrl: intelligence.riskRegisterTaskUrl,
              resolved: intelligence.riskResolved,
            }
          : null,
        recapSummary: postMeeting.recapSummary,
        extractedCommitments: postMeeting.extractedCommitments,
        reviewedTickets: options.tickets.map(describeTicket),
        // The prep is what the call was measured against, so the notes can say whether the month's
        // plan actually moved rather than only what was said out loud.
        preparation: buildTouchEvidence(touch),
        ...(geminiFullNotes ? { geminiFullNotes } : {}),
        transcript: verbatimTranscript,
      },
      null,
      2,
    ),
  ].join("\n");

  // A full touch document -- header, summary, a block per department, the health block -- against a
  // transcript and the whole prep bundle. The deck is the only MTOS answer that runs longer.
  const { text, model } = await callLlmForText({ env, system, userText, maxTokens: 16000 });
  const markdown = stripCodeFence(text);
  if (!markdown.trim()) {
    return { markdown: "", generatedAt, model, errorMessage: "The model returned empty post-meeting notes." };
  }

  const written = await writePostNotesToClientBook(context, {
    clientName,
    touchDateIso,
    markdown,
    links: options.existingLinks,
  });

  if ("error" in written) {
    // The notes themselves are the deliverable; they are kept on the touch and shown to the AM so the
    // document is never lost just because the book couldn't be written.
    return { markdown, generatedAt, model, errorMessage: written.error };
  }

  return { markdown, generatedAt, model, clientBook: written.links };
}

/**
 * Drop a fence the model wrapped the whole document in. The prompt forbids it, but a fence that slips
 * through pastes into ClickUp as one grey monospace block, which is exactly the unreadable outcome the
 * paste-safe rules exist to prevent -- cheap to undo here, invisible to the AM if we don't.
 */
export function stripCodeFence(input: string): string {
  const trimmed = (input ?? "").trim();
  const fenced = trimmed.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
  return (fenced ? fenced[1] : trimmed).trim();
}
