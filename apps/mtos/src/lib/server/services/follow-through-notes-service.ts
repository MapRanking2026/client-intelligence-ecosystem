import { loomEvidence } from "@/src/lib/contracts/no-show";
import { parseNotesOutput } from "@/src/lib/contracts/follow-through-notes-output";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import { ACTION_LINE_ANONYMITY_RULE } from "@/src/lib/contracts/ticket-description";
import type { ClientRecord, MonthlyTouchRecord } from "@/src/lib/mtos-data";
import {
  GOAL_STATUSES,
  SUMMARY_BULLETS,
  summaryBudget,
  type ActionLine,
  type GoalStatus,
  type NotesDraft,
  isGoalStatus,
  notesTitle,
  quarterLabel,
} from "@/src/lib/contracts/follow-through-notes";
import { redFlagRule, type RedFlagFinding } from "@/src/lib/contracts/follow-through-score";
import { riskRegisterRequired } from "@/src/lib/contracts/post-meeting-review";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getServerEnv } from "@/src/lib/server/env";
import { getPromptText } from "@/src/lib/server/prompt-store";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import { callLlmForJson, getNowIso, hasAnyLlmProvider } from "@/src/lib/server/services/mtos-ai";
import { getModelRouteForPrompt } from "@/src/lib/server/prompt-model-route";
import { getAccountManagerProfile } from "@/src/lib/server/services/user-service";
import { readTouchTranscriptPayload } from "@/src/lib/server/services/transcript-watch-service";

/**
 * Drafting the Post Monthly Touch Notes from the call.
 *
 * The draft is the starting point and never the document. Everything it writes is editable, and
 * once the AM has edited it the stored notes are theirs -- re-drafting is an explicit action with
 * a warning on it, because the AM's own sentences are the part of these notes that no model can
 * reproduce and the part a manager actually reads.
 *
 * What this will not do, in order of how much damage it would cause:
 *
 *  - **Invent anything.** No number, date, quote or commitment that is not in the transcript. An
 *    action with no owner comes back with no owner, and the notes say so, because a plausible
 *    guess at "SEO, Friday" becomes a real ticket with a real deadline nobody agreed to.
 *  - **Mark a carry-over it cannot see.** Carry-over is decided against the client's actual open
 *    commitments, which are passed in. Without them nothing is marked, rather than guessed.
 *  - **Write section 4 on its own.** The account-health section appears when the confirmed score
 *    is 6 or below and not otherwise, because that is the rule the score gate already applied.
 */

/** Stable ids, so an AM's edit to the third action survives a re-render of the list. */
function makeId(prefix: string, index: number) {
  return `${prefix}-${index + 1}`;
}

/** The touch's place in the series, counted from this client's own touches. */
async function monthNumber(
  context: TenantContext,
  touch: MonthlyTouchRecord,
): Promise<number | undefined> {
  const dataSource = getMtosDataSource(context);
  const all = await dataSource.getMonthlyTouches();
  const mine = all
    .filter((candidate) => candidate.clientId === touch.clientId && candidate.scheduledAt)
    .sort((a, b) => (a.scheduledAt || "").localeCompare(b.scheduledAt || ""));
  const index = mine.findIndex((candidate) => candidate.id === touch.id);
  // Counted, never guessed: a touch MTOS cannot place in the series gets no ordinal at all, and
  // the title line leaves "Month n" out rather than printing a number that might be wrong.
  return index >= 0 ? index + 1 : undefined;
}

/** The account-health section, written only when the confirmed score requires it. */
function healthRiskSection(
  score: number | null | undefined,
  findings: RedFlagFinding[],
): NotesDraft["healthRisk"] {
  if (!riskRegisterRequired(score ?? null)) return undefined;
  const worst = findings.filter((finding) => finding.found);
  const playbookFor = worst.length ? redFlagRule(worst[0].id)?.label : undefined;
  return {
    registerNote: `Log ${score}/10 in the Risk Register with this month's flags.`,
    playbook: playbookFor
      ? `Run the ${playbookFor} playbook.`
      : "Run the matching red-flag playbook once the primary category is set.",
    managerTag: "@-tag the Manager in the client channel when this is filed.",
  };
}

function emptyDraft(
  touch: MonthlyTouchRecord,
  client: ClientRecord,
  amName: string,
  month: number | undefined,
  date: string,
): NotesDraft {
  const gate = touch.followThrough?.score;
  return {
    title: notesTitle({
      clientName: client.name,
      date,
      ...(amName ? { accountManager: amName } : {}),
      ...(month ? { monthNumber: month } : {}),
    }),
    nps: gate?.score ?? null,
    npsJustification: gate?.justification || "",
    goalQuarter: quarterLabel(date),
    goalText: client.goals?.[0] || "",
    goalStatus: "Not discussed",
    goalEvidence: "",
    summary: "",
    bullets: {},
    departments: [],
    clientActions: [],
    pending: [],
    ...(healthRiskSection(gate?.score, gate?.findings || [])
      ? { healthRisk: healthRiskSection(gate?.score, gate?.findings || []) }
      : {}),
  };
}

/**
 * Draft the notes from the transcript.
 *
 * Returns a draft the AM edits. Writes nothing outward; the only persistence is the touch's own
 * document, through `saveFollowThroughNotes`.
 */
export async function draftFollowThroughNotes(
  context: TenantContext,
  touchId: string,
  manual = false,
): Promise<{ notes: NotesDraft; note?: string }> {
  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }
  const client = await dataSource.getClientById(touch.clientId);
  if (!client) {
    throw new Error("The client for this touch is not visible to you.");
  }

  const gate = touch.followThrough?.score;
  if (!gate?.confirmedAt) {
    throw new Error("Confirm the account health score before drafting the notes.");
  }

  const profile = await getAccountManagerProfile(context);
  const amName = profile.name || client.accountManager || "";
  const month = await monthNumber(context, touch);
  const date = touch.scheduledLocalDate || (touch.scheduledAt || getNowIso()).slice(0, 10);
  const base = emptyDraft(touch, client, amName, month, date);
  if (manual) return { notes: base };
  const legacy = touch.postMeeting;

  const env = getServerEnv();
  const alternative = loomEvidence(touch);
  if (touch.noShow?.resolution === "loom" && !alternative) throw new Error("Send the approved Loom update before drafting Follow-Through notes.");
  const transcript = alternative || await readTouchTranscriptPayload(context, touchId, legacy?.transcript);

  const captured = [
    ...Object.values(touch.live?.notes || {}),
    ...(touch.liveSession?.segments || []).map((segment) => segment.notes),
    touch.liveSession?.closeNotes,
  ].filter((note) => note?.trim()).join("\n");
  if (!transcript && !captured && !legacy?.recapSummary?.trim()) {
    return {
      notes: base,
      note: "There is no transcript on this touch, so the notes start empty. Write them from your own notes, or attach a transcript on the call screen first.",
    };
  }
  if (!hasAnyLlmProvider(env)) {
    return {
      notes: base,
      note: "No AI provider is configured, so the notes start empty. Everything below is yours to write.",
    };
  }

  const openCommitments = await dataSource.getCommitments(client.id);

  // The bullet set and the goal statuses stay in code because the parser that validates the
  // answer is built from them; the engine's prompt receives them as variables rather than
  // restating them, so a rubric change cannot leave the prompt describing the old one.
  const storedSystem = await getPromptText("post_touch_notes_draft_prompt", {
    summary_bullet_keys: SUMMARY_BULLETS.map((bullet) => bullet.key).join(", "),
    goal_statuses: GOAL_STATUSES.join(" / "),
  });

  const system = storedSystem + "\nPopulate every summary bullet: metrics, delivery, posture, requests, nextTouch, sentiment. Put the relevant evidence in each field rather than appending it all to summary. Summary must be one to four sentences. For information the evidence does not establish, explicitly write: Not established in the available call evidence. Do not turn drafting or sending the standard Monthly Touch recap email into a department action or pending ticket; that is handled by the recap step below. Extract every other actionable department follow-up into departments[].actions with a concise what, responsible team, assignee only when explicitly named as responsible in the evidence, and due date only when established. Include actions from the prior analysis, deduplicated against the transcript; distinguish completed work from new actions. Never invent tasks, deadlines, owners, metrics or client sentiment. " + ACTION_LINE_ANONYMITY_RULE + " Return clientActions and pending arrays, empty only when no supported items exist.";

  const userText = [
    legacy ? "Prior call analysis (supporting evidence): " + JSON.stringify({ recapSummary: legacy.recapSummary, draftTickets: legacy.draftTickets }) : "",
    // Evidence only. What to answer -- the keys, the bullet set, the goal statuses and the
    // carry-over rule -- is the engine row's contract, resolved above.
    JSON.stringify(
      {
        client: { name: client.name, industry: client.industry, contact: client.contact, goals: client.goals },
        quarter: base.goalQuarter,
        confirmedScore: gate.score,
        scoreJustification: gate.justification,
        redFlagsFound: (gate.findings || [])
          .filter((finding) => finding.found)
          .map((finding) => ({ flag: redFlagRule(finding.id)?.label, evidence: finding.evidence })),
        openCommitmentsBeforeThisCall: openCommitments.map((commitment) => ({
          title: commitment.title,
          owner: commitment.owner,
        })),
      },
      null,
      2,
    ),
    "",
    alternative ? "No-show / Loom supporting documentation (not a transcript):" : "Transcript:",
    transcript || "(unavailable)",
    "",
    "Account manager notes:",
    captured,
  ].join("\n");

  const route = await getModelRouteForPrompt(env, "post_touch_notes_draft_prompt");
  const { data } = await callLlmForJson({ env, system, userText, maxTokens: 6000, route });
  let parsed = parseNotesOutput(data);
  const completenessIssues = (value: typeof parsed): string[] => value.success ? [
    ...SUMMARY_BULLETS.filter(bullet => !value.data.bullets?.[bullet.key]?.trim()).map(bullet => "bullets." + bullet.key + " is missing"),
    ...(!value.data.summary?.trim() ? ["summary is missing"] : []),
    ...(value.data.summary && summaryBudget(value.data.summary).count > 4 ? ["summary exceeds four sentences; move detail to its appropriate field"] : []),
  ] : [];
  if (!parsed.success || completenessIssues(parsed).length) {
    const issues = parsed.success ? completenessIssues(parsed).join("; ") : parsed.error.issues.map(issue => `${issue.path.join(".") || "notes"}: ${issue.message}`).join("; ");
    const repaired = await callLlmForJson({ env, system, route, userText: [userText, "", "Your previous JSON did not match the notes contract. Correct its structure using the same evidence. Preserve supported notes and actions; invent nothing. Missing optional text must be an empty string or omitted. Return only the specified JSON object, not a wrapper.", "Validation issues: " + issues, "Previous JSON:", JSON.stringify(data)].join("\n"), maxTokens: 6000 });
    parsed = parseNotesOutput(repaired.data);
    if (!parsed.success || completenessIssues(parsed).length) {
      const fields = parsed.success ? completenessIssues(parsed).join("; ") : [...new Set(parsed.error.issues.map(issue => issue.path.join(".") || "notes"))].join(", ");
      throw new Error(`The generated notes still have invalid fields: ${fields}. Your existing notes were kept. You can edit them manually or re-draft from the call.`);
    }
  }
  if (!parsed.data.summary?.trim() && !parsed.data.departments?.length) {
    throw new Error("The transcript analysis returned no usable notes. Try drafting again or attach a fuller transcript.");
  }

  const bullets: NotesDraft["bullets"] = {};
  for (const bullet of SUMMARY_BULLETS) {
    const value = parsed.data.bullets?.[bullet.key];
    if (typeof value === "string" && value.trim()) bullets[bullet.key] = value.trim();
  }

  const departments = (parsed.data.departments || [])
    .filter((entry) => entry.department.trim())
    .map((entry, departmentIndex) => ({
      department: entry.department.trim(),
      clientFeedback: entry.clientFeedback?.trim() || "",
      actions: (entry.actions || [])
        .filter((line) => line.what.trim())
        .map(
          (line, index): ActionLine => ({
            id: makeId(`d${departmentIndex + 1}`, index),
            what: line.what.trim(),
            ...(line.assignee?.trim() ? { assignee: line.assignee.trim() } : {}),
            team: line.team?.trim() || entry.department.trim(),
            due: line.due?.trim() || "",
            ...(line.carryOver ? { carryOver: true } : {}),
            ...(line.crossDepartment?.trim() ? { crossDepartment: line.crossDepartment.trim() } : {}),
            ...(line.dependsOn?.trim() ? { dependsOn: line.dependsOn.trim() } : {}),
          }),
        ),
    }));

  const goalStatus: GoalStatus = isGoalStatus(parsed.data.goalStatus)
    ? parsed.data.goalStatus
    : "Not discussed";

  return {
    notes: {
      ...base,
      summary: parsed.data.summary?.trim() || "",
      bullets,
      goalText: parsed.data.goalText?.trim() || base.goalText,
      goalStatus,
      goalEvidence: parsed.data.goalEvidence?.trim() || "",
      departments,
      clientActions: (parsed.data.clientActions || [])
        .filter((item) => item.what.trim())
        .map((item, index) => ({
          id: makeId("c", index),
          what: item.what.trim(),
          due: item.due?.trim() || "",
          ...(item.tentative ? { tentative: true } : {}),
          ...(item.blocks?.trim() ? { blocks: item.blocks.trim() } : {}),
        })),
      pending: (parsed.data.pending || [])
        .filter((item) => item.missing.trim())
        .map((item, index) => ({
          id: makeId("p", index),
          waitingOn: item.waitingOn === "AM review" ? ("AM review" as const) : ("Client" as const),
          missing: item.missing.trim(),
          from: item.from?.trim() || "",
          team: item.team?.trim() || "",
          owner: item.owner?.trim() || amName,
          reminderDate: item.reminderDate?.trim() || "",
        })),
    },
  };
}

/** Store the notes as the AM left them. */
export async function saveFollowThroughNotes(
  context: TenantContext,
  touchId: string,
  notes: NotesDraft,
  options: { drafted?: boolean } = {},
): Promise<NotesDraft> {
  const db = getFirebaseAdminDb();
  if (db) {
    await db.doc(monthlyTouchPath(context.tenantId, touchId)).set(
      {
        followThrough: {
          notes,
          ...(options.drafted ? { notesDraftedAt: getNowIso() } : {}),
        },
      },
      {
        mergeFields: options.drafted
          ? ["followThrough.notes", "followThrough.notesDraftedAt"]
          : ["followThrough.notes"],
      },
    );
  }
  return notes;
}
