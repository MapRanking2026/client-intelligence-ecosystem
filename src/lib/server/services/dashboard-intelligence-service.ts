import { nanoid } from "nanoid";
import { z } from "zod";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import type {
  ClientRecord,
  DashboardKind,
  DashboardUpdateProposal,
  DashboardUpdateReview,
  MonthlyTouchRecord,
} from "@/src/lib/mtos-data";
import { getServerEnv } from "@/src/lib/server/env";
import { getIntegrationConnection, getIntegrationCredentials } from "@/src/lib/server/integrations";
import { callClaudeForJson, getNowIso } from "@/src/lib/server/services/mtos-ai";
import { getPromptText } from "@/src/lib/server/prompt-store";

/**
 * Client Intelligence Dashboard Updater.
 *
 * A non-destructive post-processing step that runs after transcript analysis. It
 * proposes updates to exactly two ClickUp dashboards -- the Risk Register and the
 * Stakeholder Map -- and NEVER writes on its own: proposals are drafted for the
 * AM, and the write happens only when the AM approves, mirroring how draft
 * tickets already work. It touches no other dashboard, list, or workflow.
 */

const proposalSchema = z.object({
  dashboard: z.enum(["risk_register", "stakeholder_map"]),
  action: z.enum(["create", "update", "no_change"]),
  client_name: z.string().optional(),
  summary: z.string().optional(),
  detail: z.string().optional(),
  reason: z.string().optional(),
  evidence: z.array(z.string()).optional(),
});

const dashboardResponseSchema = z.object({
  proposals: z.array(proposalSchema),
});

const DASHBOARD_LABEL: Record<DashboardKind, string> = {
  risk_register: "Risk Register",
  stakeholder_map: "Stakeholder Map",
};

/** Which env var holds each dashboard's backing ClickUp list id. */
const DASHBOARD_LIST_ENV: Record<DashboardKind, string> = {
  risk_register: "CLICKUP_RISK_REGISTER_LIST_ID",
  stakeholder_map: "CLICKUP_STAKEHOLDER_MAP_LIST_ID",
};

/**
 * Draft dashboard updates from the completed transcript analysis. Returns the
 * proposals for AM review; writes nothing. The caller decides where to store the
 * result, and treats any throw as non-fatal so transcript analysis is never
 * blocked by this step.
 */
export async function draftDashboardUpdates(
  env: ReturnType<typeof getServerEnv>,
  touch: MonthlyTouchRecord,
  client: ClientRecord,
  analysis: {
    recapSummary: string;
    extractedCommitments: string[];
    draftTickets: Array<{ title: string; description: string; department: string }>;
  },
): Promise<DashboardUpdateReview> {
  const system = await getPromptText("client_intelligence_dashboard_updater_prompt");

  const userText = [
    "Maintain the Risk Register and the Stakeholder Map for this client, using ONLY the evidence below.",
    "Return one proposal object per dashboard. Use action \"no_change\" when a dashboard needs no update.",
    "",
    JSON.stringify(
      {
        client: {
          name: client.name,
          industry: client.industry,
          contact: client.contact,
          lifecycleStage: client.lifecycleStage,
          healthScore: client.healthScore,
          tone: client.tone,
          topRisks: client.topRisks,
          churnSignals: client.churnSignals,
          riskNote: client.riskNote,
        },
        touch: {
          executiveBrief: touch.executiveBrief,
          wins: touch.wins,
          risks: touch.risks,
        },
        transcriptAnalysis: {
          recapSummary: analysis.recapSummary,
          commitments: analysis.extractedCommitments,
          draftTickets: analysis.draftTickets,
        },
      },
      null,
      2,
    ),
  ].join("\n");

  const parsed = dashboardResponseSchema.parse(
    await callClaudeForJson({ env, system, userText, maxTokens: 1200 }),
  );

  // Keep only actionable proposals; a "no_change" from the model is a valid,
  // expected answer that simply produces nothing to approve.
  const proposals: DashboardUpdateProposal[] = parsed.proposals
    .filter((item) => item.action !== "no_change")
    .map((item) => ({
      id: `dash-${nanoid(8)}`,
      dashboard: item.dashboard,
      action: item.action === "create" ? "create" : "update",
      clientName: item.client_name?.trim() || client.name,
      summary: item.summary?.trim() || `${DASHBOARD_LABEL[item.dashboard]} update`,
      detail: item.detail?.trim() || "",
      reason: item.reason?.trim() || "",
      evidence: (item.evidence || []).filter(Boolean),
      status: "pending",
    }));

  return {
    status: "draft_ready",
    proposals,
    analyzedAt: getNowIso(),
    model: env.anthropicModel,
  };
}

interface DashboardWriteResult {
  ok: boolean;
  taskId?: string;
  taskUrl?: string;
  reason?: string;
}

interface ClickUpTaskSummary {
  id: string;
  name: string;
  url?: string;
}

/**
 * Create or update the client's task in a dashboard list. The Risk Register and
 * Stakeholder Map hold one task per client, so we match on the client name and
 * update in place when it already exists, otherwise create it. Only ever writes
 * to the configured list for the given dashboard -- never anywhere else.
 */
async function upsertDashboardTask(
  context: TenantContext,
  dashboard: DashboardKind,
  clientName: string,
  detail: string,
): Promise<DashboardWriteResult> {
  const listId = process.env[DASHBOARD_LIST_ENV[dashboard]];
  if (!listId) {
    return {
      ok: false,
      reason: `No ClickUp list is configured for the ${DASHBOARD_LABEL[dashboard]} yet (set ${DASHBOARD_LIST_ENV[dashboard]}). Update it in ClickUp manually for now.`,
    };
  }

  const connection = await getIntegrationConnection(context, "clickup");
  if (!connection || connection.status !== "connected") {
    return {
      ok: false,
      reason: "ClickUp isn't connected for this workspace yet. Connect it from Settings, then re-approve.",
    };
  }

  const credentials = getIntegrationCredentials(connection);
  if (!credentials.accessToken) {
    return {
      ok: false,
      reason: "The stored ClickUp connection is missing an access token. Reconnect ClickUp and try again.",
    };
  }

  const authHeaders = {
    authorization: credentials.accessToken,
    "content-type": "application/json",
  };

  try {
    // Look for an existing task for this client in the dashboard list.
    const existing = await findDashboardTask(listId, clientName, authHeaders);

    if (existing) {
      const response = await fetch(`https://api.clickup.com/api/v2/task/${existing.id}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ description: detail }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { err?: string };
        return { ok: false, reason: payload.err || `ClickUp update failed with status ${response.status}.` };
      }
      return { ok: true, taskId: existing.id, taskUrl: existing.url };
    }

    const response = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: clientName, description: detail }),
    });
    const payload = (await response.json().catch(() => ({}))) as { id?: string; url?: string; err?: string };
    if (!response.ok) {
      return { ok: false, reason: payload.err || `ClickUp task creation failed with status ${response.status}.` };
    }
    return { ok: true, taskId: payload.id, taskUrl: payload.url };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "ClickUp dashboard update failed unexpectedly.",
    };
  }
}

/** Find a client's existing task in a dashboard list by exact name match. */
async function findDashboardTask(
  listId: string,
  clientName: string,
  authHeaders: Record<string, string>,
): Promise<ClickUpTaskSummary | null> {
  const response = await fetch(
    `https://api.clickup.com/api/v2/list/${listId}/task?archived=false&include_closed=true`,
    { headers: authHeaders },
  );
  if (!response.ok) {
    return null;
  }
  const payload = (await response.json().catch(() => ({}))) as {
    tasks?: Array<{ id: string; name: string; url?: string }>;
  };
  const target = clientName.trim().toLowerCase();
  const match = (payload.tasks || []).find((task) => task.name.trim().toLowerCase() === target);
  return match ? { id: match.id, name: match.name, url: match.url } : null;
}

/**
 * Apply the AM's decisions on dashboard proposals. Approved proposals are
 * written to their dashboard's configured ClickUp list; declined ones are just
 * marked. Returns the updated review to store back on the touch.
 */
export async function applyDashboardDecisions(
  context: TenantContext,
  review: DashboardUpdateReview,
  decisions: Record<string, "approved" | "declined">,
): Promise<DashboardUpdateReview> {
  const proposals = await Promise.all(
    review.proposals.map(async (proposal) => {
      const decision = decisions[proposal.id];

      if (decision === "declined") {
        return { ...proposal, status: "declined" as const };
      }
      if (decision !== "approved") {
        return proposal;
      }

      const result = await upsertDashboardTask(context, proposal.dashboard, proposal.clientName, proposal.detail);
      return {
        ...proposal,
        status: "approved" as const,
        clickupTaskId: result.taskId,
        clickupTaskUrl: result.taskUrl,
        executionNote: result.ok ? undefined : result.reason,
      };
    }),
  );

  return { ...review, status: "applied", proposals };
}
