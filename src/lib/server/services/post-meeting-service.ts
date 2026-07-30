import { nanoid } from "nanoid";
import { z } from "zod";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { ClientRecord, DraftTicket, MonthlyTouchRecord, PostMeetingReview } from "@/src/lib/mtos-data";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { getServerEnv } from "@/src/lib/server/env";
import { getIntegrationConnection, getIntegrationCredentials } from "@/src/lib/server/integrations";
import { callLlmForJson, getNowIso, hasAnyLlmProvider, stripUndefinedDeep } from "@/src/lib/server/services/mtos-ai";
import { getPromptText } from "@/src/lib/server/prompt-store";
import {
  applyDashboardDecisions,
  draftDashboardUpdates,
} from "@/src/lib/server/services/dashboard-intelligence-service";
import type { DashboardUpdateReview } from "@/src/lib/mtos-data";

const departmentEnum = z.enum(["SEO", "Web Design", "Ads", "Account Manager", "Other"]);

const analysisSchema = z.object({
  recapSummary: z.string().min(1),
  extractedCommitments: z.array(z.string().min(1)).max(10),
  draftTickets: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().min(1),
        department: departmentEnum,
      }),
    )
    .max(8),
  clientEmailSubject: z.string().min(1),
  clientEmailBody: z.string().min(1),
});

async function analyzeWithClaude(
  env: ReturnType<typeof getServerEnv>,
  touch: MonthlyTouchRecord,
  client: ClientRecord,
  transcript: string,
) {
  const system = await getPromptText("meeting_transcript_analysis_prompt");

  const userText = [
    "Return a JSON object with keys: recapSummary, extractedCommitments, draftTickets,",
    "clientEmailSubject, clientEmailBody.",
    "Each draftTickets item needs: title, description, department.",
    "",
    JSON.stringify(
      {
        client: { name: client.name, industry: client.industry, contact: client.contact },
        touchExecutiveBrief: touch.executiveBrief,
        touchWins: touch.wins,
        touchRisks: touch.risks,
        transcript,
      },
      null,
      2,
    ),
  ].join("\n");

  const result = await callLlmForJson({ env, system, userText, maxTokens: 1800 });
  return { analysis: analysisSchema.parse(result.data), provider: result.provider, model: result.model };
}

export async function analyzePostMeetingTranscript(context: TenantContext, touchId: string, transcript: string) {
  const trimmedTranscript = transcript.trim();
  if (trimmedTranscript.length < 40) {
    throw new Error("Paste the full meeting transcript (at least a few sentences) before analyzing.");
  }

  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firebase Admin must be configured before post-meeting analysis can run");
  }

  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }

  const client = await dataSource.getClientById(touch.clientId);
  if (!client) {
    throw new Error("Monthly touch client is not visible for the current user");
  }

  const env = getServerEnv();
  if (!hasAnyLlmProvider(env)) {
    throw new Error("No AI provider is configured (set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY), so transcript analysis can't run.");
  }

  const { analysis, model } = await analyzeWithClaude(env, touch, client, trimmedTranscript);

  const draftTickets: DraftTicket[] = analysis.draftTickets.map((ticket) => ({
    id: `ticket-${nanoid(8)}`,
    title: ticket.title,
    description: ticket.description,
    department: ticket.department,
    status: "pending",
  }));

  // Client Intelligence Dashboard Updater -- one additional post-processing step
  // inserted after transcript analysis. It only drafts proposed Risk Register /
  // Stakeholder Map updates; it writes nothing here. It is deliberately
  // non-fatal: if it fails, transcript analysis still succeeds unchanged.
  let dashboardUpdates: DashboardUpdateReview | undefined;
  try {
    dashboardUpdates = await draftDashboardUpdates(env, touch, client, {
      recapSummary: analysis.recapSummary,
      extractedCommitments: analysis.extractedCommitments,
      draftTickets: analysis.draftTickets,
    });
  } catch (error) {
    dashboardUpdates = {
      status: "draft_ready",
      proposals: [],
      analyzedAt: getNowIso(),
      model,
      errorMessage:
        error instanceof Error ? error.message : "Dashboard intelligence step could not run.",
    };
  }

  const postMeeting: PostMeetingReview = {
    status: "draft_ready",
    transcript: trimmedTranscript,
    recapSummary: analysis.recapSummary,
    extractedCommitments: analysis.extractedCommitments,
    draftTickets,
    clientEmail: {
      subject: analysis.clientEmailSubject,
      body: analysis.clientEmailBody,
      status: "pending",
    },
    dashboardUpdates,
    analyzedAt: getNowIso(),
    model,
  };

  const updatedTouch: MonthlyTouchRecord = stripUndefinedDeep({
    ...touch,
    postMeeting,
    updatedAt: getNowIso(),
  });

  await db.doc(monthlyTouchPath(context.tenantId, touch.id)).set(updatedTouch, { merge: true });

  return { touch: updatedTouch };
}

interface ClickUpTaskResult {
  created: boolean;
  taskId?: string;
  taskUrl?: string;
  reason?: string;
}

/**
 * Creates a real ClickUp task when a target list is configured and the
 * tenant's ClickUp connection is active. If either prerequisite is missing,
 * this returns created: false with an honest reason instead of pretending
 * the ticket was filed -- the AM still gets the full draft to create it
 * manually.
 */
async function createClickUpTask(context: TenantContext, ticket: DraftTicket): Promise<ClickUpTaskResult> {
  const listId = process.env.CLICKUP_GROWTH_PILOT_LIST_ID;
  if (!listId) {
    return {
      created: false,
      reason:
        "No ClickUp list is configured for Growth Pilot follow-up tickets yet (set CLICKUP_GROWTH_PILOT_LIST_ID). Copy this ticket into ClickUp manually for now.",
    };
  }

  const connection = await getIntegrationConnection(context, "clickup");
  if (!connection || connection.status !== "connected") {
    return {
      created: false,
      reason: "ClickUp isn't connected for this workspace yet. Connect it from Settings, then re-approve this ticket.",
    };
  }

  const credentials = getIntegrationCredentials(connection);
  if (!credentials.accessToken) {
    return {
      created: false,
      reason: "The stored ClickUp connection is missing an access token. Reconnect ClickUp and try again.",
    };
  }

  try {
    const response = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
      method: "POST",
      headers: {
        authorization: credentials.accessToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: `[${ticket.department}] ${ticket.title}`,
        description: ticket.description,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      id?: string;
      url?: string;
      err?: string;
    };

    if (!response.ok) {
      return {
        created: false,
        reason: payload.err || `ClickUp task creation failed with status ${response.status}.`,
      };
    }

    return { created: true, taskId: payload.id, taskUrl: payload.url };
  } catch (error) {
    return {
      created: false,
      reason: error instanceof Error ? error.message : "ClickUp task creation failed unexpectedly.",
    };
  }
}

export interface PostMeetingDecisions {
  ticketDecisions: Record<string, "approved" | "declined">;
  approveEmail: boolean;
  /** Decisions on Client Intelligence dashboard proposals, keyed by proposal id. */
  dashboardDecisions?: Record<string, "approved" | "declined">;
}

export async function applyPostMeetingDecisions(
  context: TenantContext,
  touchId: string,
  decisions: PostMeetingDecisions,
) {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firebase Admin must be configured before decisions can be applied");
  }

  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }

  if (!touch.postMeeting || touch.postMeeting.status !== "draft_ready") {
    throw new Error("Generate the post-meeting analysis before applying decisions");
  }

  const existingTickets = touch.postMeeting.draftTickets || [];
  const updatedTickets: DraftTicket[] = await Promise.all(
    existingTickets.map(async (ticket) => {
      const decision = decisions.ticketDecisions[ticket.id];

      if (decision === "declined") {
        return { ...ticket, status: "declined" as const };
      }

      if (decision !== "approved") {
        return ticket;
      }

      const result = await createClickUpTask(context, ticket);
      return {
        ...ticket,
        status: "approved" as const,
        clickupTaskId: result.taskId,
        clickupTaskUrl: result.taskUrl,
        executionNote: result.created ? undefined : result.reason,
      };
    }),
  );

  const clientEmail = touch.postMeeting.clientEmail
    ? {
        ...touch.postMeeting.clientEmail,
        status: decisions.approveEmail ? ("approved" as const) : ("pending" as const),
      }
    : undefined;

  // Apply approved dashboard proposals (writes to the two configured ClickUp
  // dashboard lists). Left untouched when there are no proposals or decisions.
  let dashboardUpdates = touch.postMeeting.dashboardUpdates;
  if (dashboardUpdates?.proposals.length && decisions.dashboardDecisions) {
    dashboardUpdates = await applyDashboardDecisions(
      context,
      dashboardUpdates,
      decisions.dashboardDecisions,
    );
  }

  const postMeeting: PostMeetingReview = {
    ...touch.postMeeting,
    status: "approved",
    draftTickets: updatedTickets,
    clientEmail,
    dashboardUpdates,
  };

  const updatedTouch: MonthlyTouchRecord = stripUndefinedDeep({
    ...touch,
    postMeeting,
    updatedAt: getNowIso(),
  });

  await db.doc(monthlyTouchPath(context.tenantId, touch.id)).set(updatedTouch, { merge: true });

  return { touch: updatedTouch };
}
