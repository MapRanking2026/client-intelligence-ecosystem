import { nanoid } from "nanoid";

import type { ClientSyncRunRecord, SyncedClientRecord } from "@/src/lib/contracts/client-sync";
import type { ExternalRecordMappingRecord, IntegrationSyncCounts } from "@/src/lib/contracts/integration-sync";
import type { IntegrationConnectionRecord } from "@/src/lib/contracts/integrations";
import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { ClientRecord, MonthlyTouchRecord } from "@/src/lib/mtos-data";
import {
  clientPath,
  externalRecordMappingsCollectionPath,
  monthlyTouchPath,
  tenantUserClientSyncRunPath,
  tenantUserPath,
  tenantUserSyncedClientPath,
  tenantUserSyncedClientsCollectionPath,
} from "@/src/lib/server/firebase/collections";
import { getFirebaseAdminAuth, getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import {
  getIntegrationConnection,
  getIntegrationCredentials,
  getIntegrationDefinition,
} from "@/src/lib/server/integrations";

type JsonRecord = Record<string, unknown>;

type ClickUpTask = {
  id: string;
  name?: string;
  description?: string;
  due_date?: string | null;
  date_updated?: string | null;
  status?: { status?: string; type?: string };
  assignees?: Array<{ username?: string; email?: string }>;
  custom_fields?: Array<{
    name?: string;
    value?: unknown;
    type_config?: {
      options?: Array<{ id?: string; name?: string; orderindex?: number }>;
    };
  }>;
};

const closedStatusTokens = ["closed", "complete", "completed", "done", "cancelled", "archived"];

function getNowIso() {
  return new Date().toISOString();
}

function createEmptyCounts(): IntegrationSyncCounts {
  return {
    fetched: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };
}

function toSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function mapScoreTone(score: number): ClientRecord["tone"] {
  if (score >= 90) return "excellent";
  if (score >= 75) return "healthy";
  if (score >= 60) return "needs_attention";
  if (score >= 40) return "at_risk";
  return "critical";
}

function formatDateLabel(value?: string | null) {
  if (!value) {
    return "TBD";
  }

  const numericValue = Number(value);
  const date = Number.isFinite(numericValue) ? new Date(numericValue) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "TBD";
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function parseNumericValue(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const numeric = Number(value.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return fallback;
}

function normalizeToken(value: string) {
  return value.trim().toLowerCase();
}

function normalizeFieldName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeComparableValue(value?: string | null) {
  if (!value) {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[@._-]+/g, " ")
    .replace(/\s+/g, " ");
}

function getCustomFieldRaw(task: ClickUpTask, fieldName: string) {
  const target = normalizeFieldName(fieldName);
  return task.custom_fields?.find((field) => normalizeFieldName(field.name || "") === target);
}

function stringifyCustomFieldValue(task: ClickUpTask, fieldName: string) {
  const field = getCustomFieldRaw(task, fieldName);
  if (!field) {
    return "";
  }

  const { value } = field;
  if (typeof value === "string") {
    const option = field.type_config?.options?.find(
      (candidate) =>
        candidate.id === value ||
        String(candidate.orderindex ?? "") === value,
    );
    if (option?.name) {
      return option.name;
    }
    return value;
  }
  if (typeof value === "number") {
    const option = field.type_config?.options?.find(
      (candidate) => Number(candidate.orderindex) === value || candidate.id === String(value),
    );
    return option?.name || String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry)).join(", ");
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return "";
}

function getManagerFieldNames() {
  const configured = process.env.CLICKUP_ACCOUNT_MANAGER_FIELD || "Account Manager";
  return Array.from(
    new Set([
      configured,
      "Account Manager",
      "Manager",
      "AM",
      "⭐️ Account Manager",
      "⭐ Account Manager",
    ]),
  );
}

function getClientStatusFieldNames() {
  const configured = process.env.CLICKUP_CLIENT_STATUS_FIELD || "Client Status";
  return Array.from(
    new Set([
      configured,
      "Client Status",
      "Lifecycle Stage",
      "Stage",
      "Status",
      "⭐ Status",
      "⭐️ Status",
    ]),
  );
}

function getTaskManagerValue(task: ClickUpTask) {
  for (const fieldName of getManagerFieldNames()) {
    const value = stringifyCustomFieldValue(task, fieldName);
    if (value) {
      return value;
    }
  }
  return "";
}

function getTaskClientStatusValue(task: ClickUpTask) {
  for (const fieldName of getClientStatusFieldNames()) {
    const value = stringifyCustomFieldValue(task, fieldName);
    if (value) {
      return value;
    }
  }
  return "";
}

function taskMatchesManager(task: ClickUpTask, managerMatchValues: string[]) {
  const managerValue = normalizeComparableValue(getTaskManagerValue(task));
  if (!managerValue || managerMatchValues.length === 0) {
    return false;
  }

  return managerMatchValues.includes(managerValue);
}

function taskIsActiveClient(task: ClickUpTask) {
  if (!isActiveTrackerTask(task)) {
    return false;
  }

  const clientStatusValue = normalizeComparableValue(getTaskClientStatusValue(task));
  if (!clientStatusValue) {
    return true;
  }

  if (
    clientStatusValue.includes("inactive") ||
    clientStatusValue.includes("cancel") ||
    clientStatusValue.includes("churn") ||
    clientStatusValue.includes("former") ||
    clientStatusValue.includes("lost")
  ) {
    return false;
  }

  return clientStatusValue.includes("active");
}

function isActiveTrackerTask(task: ClickUpTask) {
  const typeToken = normalizeToken(task.status?.type || "");
  if (typeToken === "closed") {
    return false;
  }

  const statusToken = normalizeToken(task.status?.status || "");
  return !closedStatusTokens.some((token) => statusToken.includes(token));
}

function formatSummaryCount(label: string, count: number) {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function getTaskCustomText(task: ClickUpTask, fieldNames: string[], fallback = "") {
  for (const fieldName of fieldNames) {
    const value = stringifyCustomFieldValue(task, fieldName);
    if (value) {
      return value;
    }
  }
  return fallback;
}

function getTaskCustomNumber(task: ClickUpTask, fieldNames: string[], fallback: number) {
  for (const fieldName of fieldNames) {
    const field = getCustomFieldRaw(task, fieldName);
    if (!field) {
      continue;
    }
    return parseNumericValue(field.value, fallback);
  }
  return fallback;
}

function splitList(value: string) {
  return value
    .split(/[,\n|]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function serializeTaskToClient(task: ClickUpTask, managerName: string): ClientRecord {
  const name = task.name?.trim() || "Unnamed Client";
  const taskManagerName = getTaskManagerValue(task) || managerName;
  const healthScore = Math.max(
    0,
    Math.min(
      100,
      getTaskCustomNumber(task, ["Health", "Health Score", "Client Health"], 72),
    ),
  );
  const relationshipScore = Math.max(
    0,
    Math.min(
      100,
      getTaskCustomNumber(task, ["Relationship", "Relationship Score"], healthScore),
    ),
  );
  const growthReadiness = Math.max(
    0,
    Math.min(
      100,
      getTaskCustomNumber(task, ["Growth Readiness", "Growth Score"], Math.round((healthScore + relationshipScore) / 2)),
    ),
  );
  const location = getTaskCustomText(task, ["Location", "Market", "City"]);
  const industry = getTaskCustomText(task, ["Industry", "Vertical"], "Unknown");
  const sentiment = getTaskCustomText(task, ["Sentiment", "Client Sentiment"], "Neutral");
  const riskNote = getTaskCustomText(task, ["Risk Note", "Primary Risk", "Risk"]);
  const contextNotes = getTaskCustomText(task, ["Context", "Account Context"], task.description?.trim() || "");
  const goals = splitList(getTaskCustomText(task, ["Goals", "Growth Goals"]));
  const churnSignals = splitList(getTaskCustomText(task, ["Churn Signals", "Churn Risks"]));
  const touchDateRaw = getTaskCustomText(task, ["Next Touch", "Next Touch Date", "Monthly Touch Date"], task.due_date || "");
  const touchDate = formatDateLabel(touchDateRaw);
  const clientSlug = toSlug(name || task.id);

  return {
    id: task.id,
    name,
    industry,
    contact: getTaskCustomText(task, ["Primary Contact", "Contact", "Decision Maker"], "Unknown"),
    lifecycleStage: getTaskCustomText(task, ["Lifecycle Stage", "Stage"], "Active"),
    touchId: `touch-${clientSlug}`,
    touchDate,
    healthScore,
    relationshipScore,
    growthReadiness,
    tone: mapScoreTone(healthScore),
    summary:
      contextNotes ||
      `${name} synced from ClickUp Health Tracker for ${managerName}.`,
    topRisks: churnSignals.length ? churnSignals : riskNote ? [riskNote] : ["No risk note provided"],
    topOpportunities: goals.length ? goals : ["Review strategic growth opportunities"],
    commitmentsOpen: Math.max(0, getTaskCustomNumber(task, ["Open Actions", "Open Commitments"], 0)),
    nextBestAction: getTaskCustomText(
      task,
      ["Next Best Action", "Next Step", "Recommended Action"],
      "Review the Health Tracker context and confirm the next monthly touch plan.",
    ),
    clickupTaskId: task.id,
    accountManager: taskManagerName,
    location,
    sentiment,
    tenure: getTaskCustomText(task, ["Tenure"]),
    mrr: getTaskCustomText(task, ["MRR", "Monthly Revenue"]),
    riskNote,
    contextNotes,
    churnSignals,
    goals,
    syncSource: "clickup",
    sourceUpdatedAt: task.date_updated || getNowIso(),
    rawPayload: task as unknown as Record<string, unknown>,
  };
}

function buildMonthlyTouchRecord(task: ClickUpTask, client: ClientRecord, existing?: Partial<MonthlyTouchRecord>) {
  return {
    id: client.touchId,
    clientId: client.id,
    status: existing?.status || "Preparing",
    readinessScore: existing?.readinessScore ?? Math.max(client.healthScore, 65),
    confidenceScore: existing?.confidenceScore ?? Math.max(client.relationshipScore, 65),
    executiveBrief:
      existing?.executiveBrief ||
      client.summary ||
      task.description ||
      "Synced from ClickUp Health Tracker. Review the account context before the next monthly touch.",
    agenda: existing?.agenda || [
      "Review wins and current account health",
      "Discuss active risks and blockers",
      "Confirm strategic priorities for the next month",
      "Agree owners and due dates for next actions",
    ],
    wins: existing?.wins || client.topOpportunities.slice(0, 2),
    risks: existing?.risks || client.topRisks.slice(0, 3),
    opportunities: existing?.opportunities || client.topOpportunities.slice(0, 3),
    talkingPoints: existing?.talkingPoints || [
      client.nextBestAction,
      "Confirm the latest client sentiment and escalation risk.",
      "Align on what success should look like before the next touch.",
    ],
    commitments: existing?.commitments || [],
    aiRecommendations: existing?.aiRecommendations || [],
  } satisfies MonthlyTouchRecord;
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as JsonRecord;
  if (!response.ok) {
    const message =
      (typeof payload.err === "string" && payload.err) ||
      (typeof payload.error === "string" && payload.error) ||
      (typeof payload.message === "string" && payload.message) ||
      `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function getBearerHeaders(accessToken: string) {
  return {
    authorization: `Bearer ${accessToken}`,
    accept: "application/json",
  };
}

async function getConnectedClickUpRecord(context: TenantContext) {
  const record = await getIntegrationConnection(context, "clickup");
  if (!record || record.status !== "connected") {
    throw new Error(`${getIntegrationDefinition("clickup").name} is not connected yet`);
  }
  return record;
}

async function resolveManagerIdentity(context: TenantContext) {
  const db = getFirebaseAdminDb();
  const auth = getFirebaseAdminAuth();
  const userDoc = db
    ? await db.doc(tenantUserPath(context.tenantId, context.userId)).get()
    : null;
  const userData = userDoc?.data() as { email?: string; displayName?: string } | undefined;

  let authEmail = "";
  let authDisplayName = "";
  if (auth && context.userId && context.userId !== "unknown") {
    const userRecord = await auth.getUser(context.userId).catch(() => null);
    authEmail = userRecord?.email || "";
    authDisplayName = userRecord?.displayName || "";
  }

  const email = userData?.email || authEmail;
  const emailLocalPart = email.split("@")[0] || "";
  const displayName = userData?.displayName || authDisplayName || emailLocalPart || context.userId;
  const managerMatchValues = Array.from(
    new Set(
      [displayName, email, emailLocalPart]
        .map((value) => normalizeComparableValue(value))
        .filter(Boolean),
    ),
  );

  return {
    email,
    displayName,
    managerMatchValues,
  };
}

async function fetchClickUpTrackerTasks(
  record: IntegrationConnectionRecord,
  listId?: string,
): Promise<ClickUpTask[]> {
  const definition = getIntegrationDefinition("clickup");
  const credentials = getIntegrationCredentials(record);
  const accessToken = credentials.accessToken;
  if (!accessToken) {
    throw new Error("ClickUp access token is missing");
  }

  const baseUrl = definition.defaultApiBaseUrl || "https://api.clickup.com/api/v2";
  const configuredListId = listId || process.env.CLICKUP_HEALTH_TRACKER_LIST_ID || record.metadata?.healthTrackerListId;
  const tasks: ClickUpTask[] = [];

  if (configuredListId) {
    for (let page = 0; page < 5; page += 1) {
      const payload = await fetchJson(
        `${baseUrl}/list/${configuredListId}/task?include_closed=true&subtasks=true&page=${page}`,
        { headers: getBearerHeaders(accessToken) },
      );
      const pageTasks = Array.isArray(payload.tasks) ? (payload.tasks as ClickUpTask[]) : [];
      tasks.push(...pageTasks);
      if (pageTasks.length < 100) {
        break;
      }
    }
    return tasks;
  }

  const teamsPayload = await fetchJson(`${baseUrl}/team`, {
    headers: getBearerHeaders(accessToken),
  });
  const teams = Array.isArray(teamsPayload.teams)
    ? (teamsPayload.teams as Array<{ id?: string; name?: string }>)
    : [];
  const selectedTeam = teams.find((team) => team.id === record.externalAccountId) || teams[0];

  if (!selectedTeam?.id) {
    throw new Error("No authorized ClickUp workspace was returned for this connection");
  }

  for (let page = 0; page < 5; page += 1) {
    const payload = await fetchJson(
      `${baseUrl}/team/${selectedTeam.id}/task?include_closed=true&subtasks=true&page=${page}&order_by=updated`,
      { headers: getBearerHeaders(accessToken) },
    );
    const pageTasks = Array.isArray(payload.tasks) ? (payload.tasks as ClickUpTask[]) : [];
    tasks.push(...pageTasks);
    if (pageTasks.length < 100) {
      break;
    }
  }

  return tasks;
}

async function saveExternalMapping(record: ExternalRecordMappingRecord) {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firebase Admin must be configured before ClickUp client sync can run");
  }
  await db
    .doc(`${externalRecordMappingsCollectionPath(record.tenantId)}/${record.id}`)
    .set(record, { merge: true });
}

export async function syncClickUpClients(
  context: TenantContext,
  options?: { selectedIds?: string[]; listId?: string; managerName?: string },
) {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firebase Admin must be configured before ClickUp client sync can run");
  }

  const managerIdentity = await resolveManagerIdentity(context);
  const managerName = options?.managerName?.trim() || managerIdentity.displayName || managerIdentity.email || "Unknown manager";
  const record = await getConnectedClickUpRecord(context);
  const allTasks = await fetchClickUpTrackerTasks(record, options?.listId);
  const activeTasks = allTasks.filter((task) => taskIsActiveClient(task));
  const allowedTasks = activeTasks.filter((task) => taskMatchesManager(task, managerIdentity.managerMatchValues));
  const selectedIdSet = options?.selectedIds?.length ? new Set(options.selectedIds) : null;
  const tasksToPersist = selectedIdSet
    ? allowedTasks.filter((task) => selectedIdSet.has(task.id))
    : allowedTasks;

  const counts = createEmptyCounts();
  counts.fetched = allTasks.length;

  const runId = nanoid();
  const runPath = tenantUserClientSyncRunPath(context.tenantId, context.userId, runId);
  const startedAt = getNowIso();
  const runRecord: ClientSyncRunRecord = {
    id: runId,
    tenantId: context.tenantId,
    userId: context.userId,
    providerId: "clickup",
    status: "running",
    startedAt,
    managerName,
    summary: "ClickUp client sync started.",
    counts,
    ...(selectedIdSet ? { selectedIds: Array.from(selectedIdSet) } : {}),
  };
  await db.doc(runPath).set(runRecord);

  try {
    const existingSyncedSnapshot = await db
      .collection(tenantUserSyncedClientsCollectionPath(context.tenantId, context.userId))
      .get();
    const targetClientIds = new Set(tasksToPersist.map((task) => task.id));

    const batch = db.batch();
    for (const doc of existingSyncedSnapshot.docs) {
      if (!targetClientIds.has(doc.id)) {
        batch.delete(doc.ref);
      }
    }
    await batch.commit();

    for (const task of tasksToPersist) {
      try {
        const client = serializeTaskToClient(task, managerName);
        const clientRef = db.doc(clientPath(context.tenantId, client.id));
        const existingClientSnapshot = await clientRef.get();
        const existingClient = existingClientSnapshot.exists
          ? (existingClientSnapshot.data() as Partial<ClientRecord>)
          : undefined;
        await clientRef.set(
          {
            ...existingClient,
            ...client,
          },
          { merge: true },
        );

        const touchRef = db.doc(monthlyTouchPath(context.tenantId, client.touchId));
        const existingTouchSnapshot = await touchRef.get();
        const existingTouch = existingTouchSnapshot.exists
          ? (existingTouchSnapshot.data() as Partial<MonthlyTouchRecord>)
          : undefined;
        await touchRef.set(buildMonthlyTouchRecord(task, client, existingTouch), { merge: true });

        const syncedClientRecord: SyncedClientRecord = {
          id: client.id,
          tenantId: context.tenantId,
          userId: context.userId,
          clientId: client.id,
          providerId: "clickup",
          externalObjectId: task.id,
          managerName,
          syncedAt: getNowIso(),
        };
        await db
          .doc(tenantUserSyncedClientPath(context.tenantId, context.userId, client.id))
          .set(syncedClientRecord, { merge: true });

        await saveExternalMapping({
          id: `clickup__record__${encodeURIComponent(task.id)}`,
          tenantId: context.tenantId,
          providerId: "clickup",
          externalObjectId: task.id,
          externalObjectType: "task",
          mtosObjectId: client.id,
          mtosObjectType: "client",
          clientId: client.id,
          lastSyncedAt: getNowIso(),
        });

        if (existingClientSnapshot.exists) {
          counts.updated += 1;
        } else {
          counts.created += 1;
        }
      } catch {
        counts.failed += 1;
      }
    }

    counts.skipped = Math.max(0, allTasks.length - tasksToPersist.length - counts.failed);
    const summary = [
      `${formatSummaryCount("task", allTasks.length)} loaded from ClickUp`,
      `${formatSummaryCount("active Account Manager-matched client", allowedTasks.length)} eligible`,
      `${formatSummaryCount("client", counts.created + counts.updated)} persisted`,
      `${counts.skipped} skipped`,
    ].join(", ");

    await db.doc(runPath).set(
      {
        status: "completed",
        finishedAt: getNowIso(),
        summary,
        counts,
      } satisfies Partial<ClientSyncRunRecord>,
      { merge: true },
    );

    return {
      summary,
      counts,
      eligibleClientIds: allowedTasks.map((task) => task.id),
      syncedClientIds: tasksToPersist.map((task) => task.id),
      managerName,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "ClickUp client sync failed";
    await db.doc(runPath).set(
      {
        status: "failed",
        finishedAt: getNowIso(),
        summary: message,
        errorMessage: message,
      } satisfies Partial<ClientSyncRunRecord>,
      { merge: true },
    );
    throw error;
  }
}
