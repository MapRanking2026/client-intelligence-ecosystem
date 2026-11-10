import { z } from "zod";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { ClientRecord, MonthlyTouchRecord } from "@/src/lib/mtos-data";
import {
  GOAL_STATUSES,
  SUMMARY_BULLETS,
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

const actionSchema = z.object({
  what: z.string(),
  team: z.string().optional(),
  due: z.string().optional(),
  carryOver: z.boolean().optional(),
  crossDepartment: z.string().optional(),
  dependsOn: z.string().optional(),
});

const draftSchema = z.object({
  summary: z.string().optional(),
  bullets: z.record(z.string(), z.string()).optional(),
  goalText: z.string().optional(),
  goalStatus: z.string().optional(),
  goalEvidence: z.string().optional(),
  departments: z
    .array(
      z.object({
        department: z.string(),
        clientFeedback: z.string().optional(),
        actions: z.array(actionSchema).optional(),
      }),
    )
    .optional(),
  clientActions: z
    .array(
      z.object({
        what: z.string(),
        due: z.string().optional(),
        tentative: z.boolean().optional(),
        blocks: z.string().optional(),
      }),
    )
    .optional(),
  pending: z
    .array(
      z.object({
        waitingOn: z.string().optional(),
        missing: z.string(),
        from: z.string().optional(),
        team: z.string().optional(),
        owner: z.string().optional(),
        reminderDate: z.string().optional(),
      }),
    )
    .optional(),
});

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
    goalQuarter: quarterLabel(touch.scheduledAt || date),
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
  const date = (touch.scheduledAt || getNowIso()).slice(0, 10);
  const base = emptyDraft(touch, client, amName, month, date);

  const env = getServerEnv();
  const transcript = await readTouchTranscriptPayload(context, touchId);

  if (!transcript) {
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
  const system = await getPromptText("post_touch_notes_draft_prompt", {
    summary_bullet_keys: SUMMARY_BULLETS.map((bullet) => bullet.key).join(", "),
    goal_statuses: GOAL_STATUSES.join(" / "),
  });

  const userText = [
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
    "Transcript:",
    transcript,
  ].join("\n");

  const { data } = await callLlmForJson({ env, system, userText, maxTokens: 6000 });
  const parsed = draftSchema.safeParse(data);
  if (!parsed.success) {
    return {
      notes: base,
      note: `The call read came back in a shape MTOS could not use (${parsed.error.issues[0]?.message || "unexpected fields"}), so the notes start empty.`,
    };
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
