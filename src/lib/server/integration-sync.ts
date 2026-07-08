import { nanoid } from "nanoid";

import type {
  IntegrationConnectionRecord,
  IntegrationProviderId,
} from "@/src/lib/contracts/integrations";
import type {
  ExternalRecordMappingRecord,
  IntegrationSnapshotRecord,
  IntegrationSyncCounts,
  IntegrationSyncJobRecord,
} from "@/src/lib/contracts/integration-sync";
import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { ClientRecord, CommitmentRecord } from "@/src/lib/mtos-data";
import {
  getIntegrationConnection,
  getIntegrationCredentials,
  getIntegrationDefinition,
  refreshIntegration,
} from "@/src/lib/server/integrations";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { prepareMonthlyTouch } from "@/src/lib/server/services/monthly-touch-prep-service";
import {
  clientPath,
  clientsCollectionPath,
  commitmentsCollectionPath,
  externalRecordMappingsCollectionPath,
  integrationSnapshotPath,
  integrationSyncJobsCollectionPath,
  monthlyTouchPath,
} from "@/src/lib/server/firebase/collections";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";

type JsonRecord = Record<string, unknown>;

interface SyncExecutionResult {
  summary: string;
  counts: IntegrationSyncCounts;
  snapshotPayload: JsonRecord;
  touchedTouchIds?: string[];
}

interface ClickUpTask {
  id: string;
  name?: string;
  description?: string;
  due_date?: string | null;
  date_updated?: string | null;
  tags?: Array<{ name?: string }>;
  assignees?: Array<{ username?: string; email?: string }>;
  status?: { status?: string; type?: string };
  custom_fields?: Array<{ name?: string; value?: unknown }>;
}

interface GoogleCalendarEvent {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  status?: string;
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

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function toSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function encodeMappingId(providerId: IntegrationProviderId, objectType: string, externalId: string) {
  return `${providerId}__${objectType}__${encodeURIComponent(externalId)}`;
}

function getNowIso() {
  return new Date().toISOString();
}

function formatDateLabel(value?: string | null) {
  if (!value) {
    return "No due date";
  }

  const numericValue = Number(value);
  const date = Number.isFinite(numericValue) ? new Date(numericValue) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "No due date";
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

function formatSummaryCount(label: string, count: number) {
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function ensureFirestore() {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firebase Admin must be configured before provider sync can run");
  }
  return db;
}

function getEventStartIso(event: GoogleCalendarEvent) {
  const value = event.start?.dateTime || event.start?.date || "";
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function matchesMonthlyTouchEvent(summary: string, clientName: string) {
  const normalizedSummary = normalizeText(summary);
  if (!normalizedSummary.includes("monthly touch")) {
    return false;
  }
  const normalizedClient = normalizeText(clientName);
  if (!normalizedClient) {
    return false;
  }
  return normalizedSummary.includes(normalizedClient);
}

async function syncGoogleCalendar(context: TenantContext, record: IntegrationConnectionRecord, origin?: string) {
  const db = ensureFirestore();
  const refreshedRecord = await maybeRefreshConnection(context, record, origin);
  const credentials = getIntegrationCredentials(refreshedRecord);
  const accessToken = credentials.accessToken;
  const apiBaseUrl = credentials.apiBaseUrl || refreshedRecord.apiBaseUrl || "https://www.googleapis.com/calendar/v3";

  if (!accessToken) {
    throw new Error(`${getIntegrationDefinition("google-calendar").name} access token is missing`);
  }

  const now = new Date();
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 90).toISOString();
  const url = new URL(`${apiBaseUrl}/calendars/primary/events`);
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "2500");

  const payload = await fetchJson(url.toString(), {
    method: "GET",
    headers: {
      ...getBearerHeaders(accessToken),
    },
  });

  const items = Array.isArray(payload.items) ? (payload.items as GoogleCalendarEvent[]) : [];
  const events = items
    .filter((event) => event.status !== "cancelled")
    .map((event) => ({
      id: event.id || "",
      summary: event.summary || "",
      startIso: getEventStartIso(event),
    }))
    .filter((event) => event.id && event.startIso && event.summary);

  events.sort((a, b) => a.startIso.localeCompare(b.startIso));

  const dataSource = getMtosDataSource(context);
  const clients = await dataSource.getClients();
  const counts = createEmptyCounts();
  counts.fetched = events.length;
  const touchedTouchIds = new Set<string>();

  let writes = 0;
  const commitBatch = async (batch: FirebaseFirestore.WriteBatch) => {
    if (!writes) {
      return;
    }
    await batch.commit();
    writes = 0;
  };

  let batch = db.batch();
  for (const client of clients) {
    const match = events.find((event) => matchesMonthlyTouchEvent(event.summary, client.name));
    if (!match) {
      counts.skipped += 1;
      continue;
    }

    const touchDate = formatDateLabel(match.startIso);
    batch.set(
      db.doc(clientPath(context.tenantId, client.id)),
      {
        touchDate,
        nextTouchEventId: match.id,
        nextTouchStartAt: match.startIso,
        calendarSource: "google-calendar",
        updatedAt: getNowIso(),
      },
      { merge: true },
    );
    batch.set(
      db.doc(monthlyTouchPath(context.tenantId, client.touchId)),
      {
        scheduledAt: match.startIso,
        calendarEventId: match.id,
        updatedAt: getNowIso(),
      },
      { merge: true },
    );
    counts.updated += 1;
    touchedTouchIds.add(client.touchId);
    writes += 2;

    if (writes >= 450) {
      await commitBatch(batch);
      batch = db.batch();
    }
  }

  await commitBatch(batch);

  return {
    summary: `${formatSummaryCount("calendar event", counts.fetched)} scanned · ${formatSummaryCount("client", counts.updated)} scheduled`,
    counts,
    snapshotPayload: payload,
    touchedTouchIds: Array.from(touchedTouchIds),
  } satisfies SyncExecutionResult;
}

async function getLatestExternalMapping(
  tenantId: string,
  providerId: IntegrationProviderId,
  externalObjectId: string,
) {
  const db = ensureFirestore();
  const mappingId = encodeMappingId(providerId, "record", externalObjectId);
  const snapshot = await db
    .doc(`${externalRecordMappingsCollectionPath(tenantId)}/${mappingId}`)
    .get();

  if (!snapshot.exists) {
    return undefined;
  }

  return snapshot.data() as ExternalRecordMappingRecord;
}

async function saveExternalMapping(record: ExternalRecordMappingRecord) {
  const db = ensureFirestore();
  await db
    .doc(`${externalRecordMappingsCollectionPath(record.tenantId)}/${record.id}`)
    .set(record);
}

async function createSyncJob(context: TenantContext, providerId: IntegrationProviderId) {
  const db = ensureFirestore();
  const jobId = nanoid();
  const job: IntegrationSyncJobRecord = {
    id: jobId,
    tenantId: context.tenantId,
    providerId,
    status: "running",
    startedAt: getNowIso(),
    summary: "Sync started.",
    counts: createEmptyCounts(),
  };

  await db.doc(`${integrationSyncJobsCollectionPath(context.tenantId)}/${jobId}`).set(job);
  return job;
}

async function finishSyncJob(
  context: TenantContext,
  jobId: string,
  providerId: IntegrationProviderId,
  result: SyncExecutionResult,
) {
  const db = ensureFirestore();
  const finishedAt = getNowIso();
  await db
    .doc(`${integrationSyncJobsCollectionPath(context.tenantId)}/${jobId}`)
    .set(
      {
        id: jobId,
        tenantId: context.tenantId,
        providerId,
        status: "completed",
        finishedAt,
        summary: result.summary,
        counts: result.counts,
      } satisfies Partial<IntegrationSyncJobRecord>,
      { merge: true },
    );
}

async function failSyncJob(
  context: TenantContext,
  jobId: string,
  providerId: IntegrationProviderId,
  errorMessage: string,
) {
  const db = ensureFirestore();
  await db
    .doc(`${integrationSyncJobsCollectionPath(context.tenantId)}/${jobId}`)
    .set(
      {
        id: jobId,
        tenantId: context.tenantId,
        providerId,
        status: "failed",
        finishedAt: getNowIso(),
        summary: errorMessage,
        errorMessage,
      } satisfies Partial<IntegrationSyncJobRecord>,
      { merge: true },
    );
}

async function saveIntegrationSnapshot(
  context: TenantContext,
  providerId: IntegrationProviderId,
  result: SyncExecutionResult,
) {
  const db = ensureFirestore();
  const snapshot: IntegrationSnapshotRecord = {
    id: providerId,
    tenantId: context.tenantId,
    providerId,
    syncedAt: getNowIso(),
    summary: result.summary,
    counts: result.counts,
    payload: result.snapshotPayload,
  };

  await db.doc(integrationSnapshotPath(context.tenantId, providerId)).set(snapshot);
}

async function getConnectedRecord(context: TenantContext, providerId: IntegrationProviderId) {
  const record = await getIntegrationConnection(context, providerId);
  if (!record || record.status !== "connected") {
    throw new Error(`${getIntegrationDefinition(providerId).name} is not connected yet`);
  }
  return record;
}

async function maybeRefreshConnection(
  context: TenantContext,
  record: IntegrationConnectionRecord,
  origin?: string,
) {
  const definition = getIntegrationDefinition(record.providerId);
  const shouldRefreshBecauseExpiring =
    record.tokenExpiresAt &&
    new Date(record.tokenExpiresAt).getTime() - Date.now() <= 5 * 60 * 1000;

  if (definition.authMode === "rotating_token" || shouldRefreshBecauseExpiring) {
    await refreshIntegration(context, record.providerId, origin);
    return await getConnectedRecord(context, record.providerId);
  }

  return record;
}

function getBearerHeaders(accessToken: string, extra?: Record<string, string>) {
  return {
    authorization: `Bearer ${accessToken}`,
    accept: "application/json",
    ...extra,
  };
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as JsonRecord;

  if (!response.ok) {
    const message =
      (typeof payload.error === "string" && payload.error) ||
      (typeof payload.message === "string" && payload.message) ||
      `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

async function listFirestoreClients(tenantId: string) {
  const db = ensureFirestore();
  const snapshot = await db.collection(clientsCollectionPath(tenantId)).get();

  return snapshot.docs.map((doc) => doc.data() as ClientRecord);
}

function pickClickUpOwner(task: ClickUpTask) {
  const assignee = task.assignees?.[0];
  return assignee?.username || assignee?.email || "Unassigned";
}

function mapClickUpStatus(task: ClickUpTask): CommitmentRecord["status"] {
  const statusLabel = normalizeText(task.status?.status || task.status?.type || "");
  const isClosed =
    statusLabel.includes("complete") ||
    statusLabel.includes("closed") ||
    statusLabel.includes("done");

  if (isClosed) {
    return "Completed";
  }

  if (task.due_date) {
    const dueDate = new Date(Number(task.due_date));
    if (!Number.isNaN(dueDate.getTime()) && dueDate.getTime() < Date.now()) {
      return "Overdue";
    }
  }

  if (statusLabel.includes("progress") || statusLabel.includes("working")) {
    return "In Progress";
  }

  return "Open";
}

function mapClickUpCategory(task: ClickUpTask): CommitmentRecord["category"] {
  const tags = (task.tags || []).map((tag) => normalizeText(tag.name || ""));
  if (tags.some((tag) => tag.includes("client"))) {
    return "Client";
  }
  if (tags.some((tag) => tag.includes("internal"))) {
    return "Internal";
  }
  return "Map Ranking";
}

function matchClientFromSignals(clients: ClientRecord[], signals: string[]) {
  const normalizedSignals = signals.map(normalizeText).filter(Boolean);

  return (
    clients.find((client) => {
      const clientName = normalizeText(client.name);
      const clientId = normalizeText(client.id);
      const clientSlug = normalizeText(toSlug(client.name));

      return normalizedSignals.some(
        (signal) =>
          signal.includes(clientName) ||
          signal.includes(clientId) ||
          signal.includes(clientSlug),
      );
    }) || null
  );
}

function collectClickUpSignals(task: ClickUpTask) {
  const customFieldValues = (task.custom_fields || []).flatMap((field) => {
    const values = [field.name];
    if (typeof field.value === "string") {
      values.push(field.value);
    } else if (typeof field.value === "number") {
      values.push(String(field.value));
    } else if (Array.isArray(field.value)) {
      values.push(...field.value.map((value) => String(value)));
    }
    return values.filter(Boolean) as string[];
  });

  return [
    task.name || "",
    task.description || "",
    ...(task.tags || []).map((tag) => tag.name || ""),
    ...customFieldValues,
  ];
}

async function updateClientCommitmentCounts(tenantId: string, clientIds: string[]) {
  const db = ensureFirestore();

  await Promise.all(
    [...new Set(clientIds)].map(async (clientId) => {
      const snapshot = await db
        .collection(commitmentsCollectionPath(tenantId))
        .where("clientId", "==", clientId)
        .get();
      const commitments = snapshot.docs.map((doc) => doc.data() as CommitmentRecord);
      const commitmentsOpen = commitments.filter((item) => item.status !== "Completed").length;

      await db.doc(clientPath(tenantId, clientId)).set({ commitmentsOpen }, { merge: true });
    }),
  );
}

async function syncClickUp(context: TenantContext, record: IntegrationConnectionRecord) {
  const definition = getIntegrationDefinition("clickup");
  const credentials = getIntegrationCredentials(record);
  const accessToken = credentials.accessToken;
  if (!accessToken) {
    throw new Error("ClickUp access token is missing");
  }

  const counts = createEmptyCounts();
  const db = ensureFirestore();
  const baseUrl = definition.defaultApiBaseUrl || "https://api.clickup.com/api/v2";
  const teamsPayload = await fetchJson(`${baseUrl}/team`, {
    headers: getBearerHeaders(accessToken),
  });
  const teams = Array.isArray(teamsPayload.teams)
    ? (teamsPayload.teams as Array<{ id?: string; name?: string }>)
    : [];
  const selectedTeam =
    teams.find((team) => team.id === record.externalAccountId) || teams[0];

  if (!selectedTeam?.id) {
    throw new Error("No authorized ClickUp workspace was returned for this connection");
  }

  const tasks: ClickUpTask[] = [];
  for (let page = 0; page < 3; page += 1) {
    const tasksPayload = await fetchJson(
      `${baseUrl}/team/${selectedTeam.id}/task?include_closed=true&subtasks=true&page=${page}&order_by=updated`,
      {
        headers: getBearerHeaders(accessToken),
      },
    );
    const pageTasks = Array.isArray(tasksPayload.tasks)
      ? (tasksPayload.tasks as ClickUpTask[])
      : [];
    tasks.push(...pageTasks);
    if (pageTasks.length < 100) {
      break;
    }
  }

  counts.fetched = tasks.length;
  const clients = await listFirestoreClients(context.tenantId);
  const touchedClientIds: string[] = [];

  for (const task of tasks) {
    if (!task.id || !task.name) {
      counts.skipped += 1;
      continue;
    }

    try {
      const matchedClient = matchClientFromSignals(clients, collectClickUpSignals(task));
      if (!matchedClient) {
        counts.skipped += 1;
        continue;
      }

      const mapping =
        (await getLatestExternalMapping(context.tenantId, "clickup", task.id)) || null;
      const commitmentId = mapping?.mtosObjectId || `clickup-${task.id}`;
      const commitment: CommitmentRecord = {
        id: commitmentId,
        clientId: matchedClient.id,
        title: task.name,
        owner: pickClickUpOwner(task),
        dueDate: formatDateLabel(task.due_date),
        status: mapClickUpStatus(task),
        category: mapClickUpCategory(task),
        sourceMeeting: "ClickUp Sync",
      };

      const existingCommitment = await db
        .doc(`${commitmentsCollectionPath(context.tenantId)}/${commitmentId}`)
        .get();
      await db
        .doc(`${commitmentsCollectionPath(context.tenantId)}/${commitmentId}`)
        .set(commitment);

      await saveExternalMapping({
        id: encodeMappingId("clickup", "record", task.id),
        tenantId: context.tenantId,
        providerId: "clickup",
        externalObjectId: task.id,
        externalObjectType: "task",
        mtosObjectId: commitmentId,
        mtosObjectType: "commitment",
        clientId: matchedClient.id,
        lastSyncedAt: getNowIso(),
      });

      touchedClientIds.push(matchedClient.id);
      if (existingCommitment.exists) {
        counts.updated += 1;
      } else {
        counts.created += 1;
      }
    } catch {
      counts.failed += 1;
    }
  }

  await updateClientCommitmentCounts(context.tenantId, touchedClientIds);

  return {
    summary: [
      `${formatSummaryCount("task", counts.fetched)} pulled from ${selectedTeam.name || "the workspace"}`,
      `${formatSummaryCount("commitment", counts.created + counts.updated)} mapped into MTOS`,
      `${counts.skipped} skipped`,
    ].join(", "),
    counts,
    snapshotPayload: {
      workspace: {
        id: selectedTeam.id,
        name: selectedTeam.name || "Unknown workspace",
      },
      sampleTasks: tasks.slice(0, 10).map((task) => ({
        id: task.id,
        name: task.name,
        dueDate: task.due_date,
        status: task.status?.status || task.status?.type || "unknown",
      })),
    },
  } satisfies SyncExecutionResult;
}

async function syncGoogleBusinessProfile(context: TenantContext, record: IntegrationConnectionRecord) {
  const refreshedRecord = await maybeRefreshConnection(context, record);
  const credentials = getIntegrationCredentials(refreshedRecord);
  const accessToken = credentials.accessToken;
  if (!accessToken) {
    throw new Error("Google Business Profile access token is missing");
  }

  const counts = createEmptyCounts();
  const accountsPayload = await fetchJson("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", {
    headers: getBearerHeaders(accessToken),
  });
  const accounts = Array.isArray(accountsPayload.accounts)
    ? (accountsPayload.accounts as Array<{ name?: string; accountName?: string; type?: string }>)
    : [];

  const locations: Array<Record<string, unknown>> = [];
  for (const account of accounts.slice(0, 5)) {
    if (!account.name) {
      continue;
    }

    const locationsPayload = await fetchJson(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?pageSize=20&readMask=name,title,storeCode,websiteUri,metadata`,
      {
        headers: getBearerHeaders(accessToken),
      },
    );
    const accountLocations = Array.isArray(locationsPayload.locations)
      ? (locationsPayload.locations as Array<Record<string, unknown>>)
      : [];
    locations.push(
      ...accountLocations.map((location) => ({
        ...location,
        accountName: account.accountName || account.name,
      })),
    );
  }

  counts.fetched = accounts.length + locations.length;
  counts.created = locations.length;

  return {
    summary: [
      `${formatSummaryCount("account", accounts.length)} loaded`,
      `${formatSummaryCount("location", locations.length)} discovered`,
    ].join(", "),
    counts,
    snapshotPayload: {
      accounts: accounts.map((account) => ({
        id: account.name || "",
        name: account.accountName || "Unknown account",
        type: account.type || "UNKNOWN",
      })),
      locations: locations.slice(0, 25),
    },
  } satisfies SyncExecutionResult;
}

function getLast28DaysRange() {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 27);

  const toLabel = (date: Date) => date.toISOString().slice(0, 10);

  return {
    startDate: toLabel(startDate),
    endDate: toLabel(endDate),
  };
}

async function syncSearchConsole(context: TenantContext, record: IntegrationConnectionRecord) {
  const refreshedRecord = await maybeRefreshConnection(context, record);
  const credentials = getIntegrationCredentials(refreshedRecord);
  const accessToken = credentials.accessToken;
  if (!accessToken) {
    throw new Error("Search Console access token is missing");
  }

  const counts = createEmptyCounts();
  const sitesPayload = await fetchJson("https://www.googleapis.com/webmasters/v3/sites", {
    headers: getBearerHeaders(accessToken),
  });
  const sites = Array.isArray(sitesPayload.siteEntry)
    ? (sitesPayload.siteEntry as Array<{ siteUrl?: string; permissionLevel?: string }>)
    : [];
  counts.fetched = sites.length;

  const { startDate, endDate } = getLast28DaysRange();
  const analytics: Array<Record<string, unknown>> = [];

  for (const site of sites.slice(0, 5)) {
    if (!site.siteUrl) {
      continue;
    }

    const encodedSiteUrl = encodeURIComponent(site.siteUrl);
    const analyticsPayload = await fetchJson(
      `https://www.googleapis.com/webmasters/v3/sites/${encodedSiteUrl}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          ...getBearerHeaders(accessToken),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions: ["query"],
          rowLimit: 10,
        }),
      },
    );

    analytics.push({
      siteUrl: site.siteUrl,
      permissionLevel: site.permissionLevel || "unknown",
      rows: Array.isArray(analyticsPayload.rows) ? analyticsPayload.rows : [],
    });
  }

  counts.created = analytics.length;

  return {
    summary: [
      `${formatSummaryCount("property", sites.length)} listed`,
      `${formatSummaryCount("analytics snapshot", analytics.length)} captured`,
    ].join(", "),
    counts,
    snapshotPayload: {
      dateRange: { startDate, endDate },
      sites,
      analytics,
    },
  } satisfies SyncExecutionResult;
}

function getArrayCount(payload: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.length;
    }
  }

  return 0;
}

async function syncRotatingTokenProvider(
  context: TenantContext,
  providerId: "rank-tracker" | "map-checkins",
  record: IntegrationConnectionRecord,
  origin?: string,
) {
  const refreshedRecord = await maybeRefreshConnection(context, record, origin);
  const credentials = getIntegrationCredentials(refreshedRecord);
  const accessToken = credentials.accessToken;
  const syncEndpoint = credentials.syncEndpoint || refreshedRecord.endpointUrl;

  if (!accessToken) {
    throw new Error(`${getIntegrationDefinition(providerId).name} access token is missing`);
  }
  if (!syncEndpoint) {
    throw new Error(`${getIntegrationDefinition(providerId).name} sync endpoint is missing`);
  }

  const payload = await fetchJson(syncEndpoint, {
    method: "GET",
    headers: {
      ...getBearerHeaders(accessToken, {
        "x-api-key": credentials.apiKey || "",
      }),
    },
  });

  const counts = createEmptyCounts();
  counts.fetched =
    getArrayCount(payload, ["results", "data", "items", "rankings", "checkins"]) || 1;
  counts.created = counts.fetched;

  return {
    summary: `${formatSummaryCount(providerId === "rank-tracker" ? "ranking row" : "check-in row", counts.fetched)} synced`,
    counts,
    snapshotPayload: payload,
  } satisfies SyncExecutionResult;
}

async function runProviderSync(
  context: TenantContext,
  providerId: IntegrationProviderId,
  origin?: string,
): Promise<SyncExecutionResult> {
  const record = await getConnectedRecord(context, providerId);

  switch (providerId) {
    case "clickup":
      return syncClickUp(context, record);
    case "google-calendar":
      return syncGoogleCalendar(context, record, origin);
    case "google-business-profile":
      return syncGoogleBusinessProfile(context, record);
    case "google-search-console":
      return syncSearchConsole(context, record);
    case "rank-tracker":
      return syncRotatingTokenProvider(context, "rank-tracker", record, origin);
    case "map-checkins":
      return syncRotatingTokenProvider(context, "map-checkins", record, origin);
    default:
      throw new Error(`${getIntegrationDefinition(providerId).name} sync is not implemented in this slice`);
  }
}

export async function syncIntegrationProvider(
  context: TenantContext,
  providerId: IntegrationProviderId,
  origin?: string,
) {
  const job = await createSyncJob(context, providerId);

  try {
    const result = await runProviderSync(context, providerId, origin);
    await Promise.all([finishSyncJob(context, job.id, providerId, result), saveIntegrationSnapshot(context, providerId, result)]);
    if (result.touchedTouchIds?.length) {
      const touchIds = result.touchedTouchIds.slice(0, 25);
      for (const touchId of touchIds) {
        try {
          await prepareMonthlyTouch(context, touchId, { includeClaude: false });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Monthly touch preparation failed";
          console.warn(`Monthly touch prep-pack refresh failed for ${touchId}: ${message}`);
        }
      }
    }
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider sync failed";
    await failSyncJob(context, job.id, providerId, message);
    throw error;
  }
}
