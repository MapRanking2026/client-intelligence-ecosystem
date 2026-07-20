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
import { getServerEnv } from "@/src/lib/server/env";
import {
  matchCalendarEventsToClients,
  selectLastTouchPerClient,
  selectNextTouchPerClient,
} from "@/src/lib/server/calendar-touch-matching";
import { namesLikelyMatch, normalizeText } from "@/src/lib/server/name-matching";

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
  // ClickUp nests deliverables under a per-client folder ("Icon Beauty") with the department as
  // the list ("SEO"). The client name lives here, not in the task name.
  list?: { id?: string; name?: string };
  folder?: { id?: string; name?: string; hidden?: boolean };
  project?: { id?: string; name?: string; hidden?: boolean };
}

interface GoogleCalendarEvent {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  status?: string;
  attendees?: Array<{ email?: string }>;
}

interface GoogleAdsAccessibleCustomer {
  resourceName?: string;
  id?: string;
  descriptiveName?: string;
  currencyCode?: string;
  manager?: boolean;
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

// 100 tasks/page. Measured ~0.25s per task end-to-end (fetch + per-task Firestore write), so 15
// pages ran 370s and blew the route's 300s ceiling. 10 pages (~1000 tasks, ~250s) leaves headroom
// while still covering far more clients than the previous 3-page cap.
// Follow-up: batch the Firestore writes to make deeper paging affordable.
const CLICKUP_MAX_TASK_PAGES = 10;

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
  // Look back as well as forward: most touches on the calendar have already happened, and the last
  // one is the "when did we last speak" signal a brief needs.
  const timeMin = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 90).toISOString();
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
      attendeeEmails: (event.attendees || []).map((attendee) => attendee.email || "").filter(Boolean),
    }))
    .filter((event) => event.id && event.startIso && event.summary);

  events.sort((a, b) => a.startIso.localeCompare(b.startIso));

  // Read the roster directly rather than through the data source: getClients() narrows to the
  // caller's synced-client visibility, and the cron runs as "system-cron", which has none -- so the
  // sync saw zero clients and matched nothing. A background sync covers the whole tenant.
  const clients = await listFirestoreClients(context.tenantId);
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

  const nowIso = now.toISOString();
  const matches = matchCalendarEventsToClients(events, clients);
  const nextTouchByClient = selectNextTouchPerClient(matches, nowIso);
  const lastTouchByClient = selectLastTouchPerClient(matches, nowIso);

  let batch = db.batch();
  for (const client of clients) {
    const next = nextTouchByClient.get(client.id);
    const last = lastTouchByClient.get(client.id);

    // A previously scheduled touch that has since passed must not linger as "next", or a brief
    // presents a date in the past as the upcoming call.
    const existing = client as unknown as { nextTouchStartAt?: string; calendarSource?: string };
    const staleNextTouch =
      !next &&
      Boolean(existing.nextTouchStartAt) &&
      (existing.nextTouchStartAt as string) < nowIso &&
      existing.calendarSource === "google-calendar";

    if (!next && !last && !staleNextTouch) {
      counts.skipped += 1;
      continue;
    }

    const clientUpdate: Record<string, unknown> = {
      calendarSource: "google-calendar",
      updatedAt: getNowIso(),
    };
    if (next) {
      clientUpdate.touchDate = formatDateLabel(next.startIso);
      clientUpdate.nextTouchEventId = next.eventId;
      clientUpdate.nextTouchStartAt = next.startIso;
    } else if (staleNextTouch) {
      // Only the calendar-owned fields are cleared; touchDate is also written by the ClickUp sync.
      clientUpdate.nextTouchEventId = null;
      clientUpdate.nextTouchStartAt = null;
    }
    if (last) {
      clientUpdate.lastTouchEventId = last.eventId;
      clientUpdate.lastTouchStartAt = last.startIso;
      clientUpdate.lastTouchSummary = last.summary;
    }

    batch.set(db.doc(clientPath(context.tenantId, client.id)), clientUpdate, { merge: true });
    writes += 1;

    if (next) {
      batch.set(
        db.doc(monthlyTouchPath(context.tenantId, client.touchId)),
        {
          scheduledAt: next.startIso,
          calendarEventId: next.eventId,
          updatedAt: getNowIso(),
        },
        { merge: true },
      );
      touchedTouchIds.add(client.touchId);
      writes += 1;
    }

    counts.updated += 1;

    if (writes >= 450) {
      await commitBatch(batch);
      batch = db.batch();
    }
  }

  await commitBatch(batch);

  // Store the resolved matches rather than the raw feed: 180 days of events exceeds Firestore's 1MiB
  // document limit, and the matches are what anything downstream actually reads.
  const snapshotPayload = {
    capturedAt: nowIso,
    windowStart: timeMin,
    windowEnd: timeMax,
    eventsScanned: events.length,
    matchedEvents: matches.length,
    clientsScheduled: nextTouchByClient.size,
    clientsWithRecentTouch: lastTouchByClient.size,
    matches: matches.map((match) => ({
      eventId: match.eventId,
      clientId: match.clientId,
      clientName: match.clientName,
      startIso: match.startIso,
      summary: match.summary,
      reason: match.reason,
    })),
  };

  return {
    summary: `${formatSummaryCount("calendar event", counts.fetched)} scanned · ${formatSummaryCount("client", nextTouchByClient.size)} scheduled · ${formatSummaryCount("client", lastTouchByClient.size)} with a recent touch`,
    counts,
    snapshotPayload,
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
  // Refresh with a 10-minute safety buffer (and for already-expired tokens, since the diff goes
  // negative) so a long-running sync never mid-flights on a token that lapses part way through.
  const shouldRefreshBecauseExpiring =
    record.tokenExpiresAt &&
    new Date(record.tokenExpiresAt).getTime() - Date.now() <= 10 * 60 * 1000;

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

interface CheckinPostActivity {
  lastPostAt: string | null;
  lastPostPlatform: string | null;
  nextScheduledPostAt: string | null;
}

interface CheckinPostRow {
  date?: string;
  status?: string;
  platform?: string;
}

/**
 * Reads a check-in business's recent posts to find when it last actually posted, and what is queued
 * next. Two properties of this API drive the shape of this function:
 *
 * - Pages are ordered by createdAt, NOT by the post's own date, so the newest date is not simply the
 *   first row. Every row read is compared rather than trusting position.
 * - A post can be status "published" with a future date (scheduled runs created in advance), so a
 *   post only counts as done once its date has actually passed.
 *
 * Page size is capped at 20 by the API. One page is normally enough; more are read only while no
 * completed post has been found yet, which keeps a 200-business sync from turning into thousands of
 * requests while still answering correctly for a business whose recent activity is all scheduled.
 */
async function fetchCheckinPostActivity(
  apiBase: string,
  accessToken: string,
  checkinId: string,
  maxPages = 3,
): Promise<CheckinPostActivity> {
  const nowMs = Date.now();
  let lastPostAt: string | null = null;
  let lastPostPlatform: string | null = null;
  let nextScheduledPostAt: string | null = null;

  const toMs = (value?: string | null) => {
    if (!value) return null;
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  };

  for (let page = 1; page <= maxPages; page += 1) {
    const payload = await fetchJson(`${apiBase}/api/checkin-business/get-posts`, {
      method: "POST",
      headers: { "content-type": "application/json", ...getBearerHeaders(accessToken) },
      body: JSON.stringify({ checkin_id: checkinId, page, limit: 20 }),
    });

    const rows = Array.isArray(payload.data) ? (payload.data as CheckinPostRow[]) : [];
    for (const row of rows) {
      const at = toMs(row.date);
      if (at === null) continue;

      if (row.status === "published" && at <= nowMs) {
        if (!lastPostAt || at > (toMs(lastPostAt) ?? 0)) {
          lastPostAt = row.date as string;
          lastPostPlatform = row.platform || null;
        }
      } else if (at > nowMs && (row.status === "scheduled" || row.status === "published")) {
        const current = toMs(nextScheduledPostAt);
        if (current === null || at < current) {
          nextScheduledPostAt = row.date as string;
        }
      }
    }

    const pagination = (payload.pagination || {}) as { totalPages?: number };
    const totalPages = typeof pagination.totalPages === "number" ? pagination.totalPages : 1;
    // Stop as soon as a completed post is known, or the list runs out.
    if (lastPostAt || page >= totalPages || rows.length < 20) {
      break;
    }
  }

  return { lastPostAt, lastPostPlatform, nextScheduledPostAt };
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

  // ClickUp marks the name of a hidden folder/project as the literal string "hidden" -- that is not
  // a client name, so drop it rather than letting it match noise.
  const containerNames = [task.folder?.name, task.project?.name, task.list?.name].filter(
    (name): name is string => typeof name === "string" && name.length > 0 && name.toLowerCase() !== "hidden",
  );

  return [
    // Folder/project first: for deliverables the client name lives on the container, not the task.
    ...containerNames,
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
  // ClickUp returns 100 tasks/page ordered by last update, workspace-wide. Three pages only covered
  // the 300 most recent tasks, so most of the ~220 clients got no deliverables at all. Page deeper so
  // every client's brief has its ClickUp work; the loop still stops early on a short page.
  for (let page = 0; page < CLICKUP_MAX_TASK_PAGES; page += 1) {
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

function matchLocationsToClients(clients: ClientRecord[], locations: Array<Record<string, unknown>>) {
  const byClient: Record<string, Array<Record<string, unknown>>> = {};

  for (const client of clients) {
    const manualIds = new Set(client.integrationMappings?.googleBusinessProfile || []);
    // Manual pins are additive: auto name matches always stay in.
    const matches = locations.filter((location) => {
      const locationId = String(location.name || "").split("/").filter(Boolean).pop() || "";
      return (
        namesLikelyMatch(client.name, String(location.title || "")) ||
        manualIds.has(locationId) ||
        manualIds.has(String(location.name || ""))
      );
    });
    if (matches.length) {
      byClient[client.id] = matches;
    }
  }

  return byClient;
}

function matchBusinessesToClients(clients: ClientRecord[], businesses: Array<Record<string, unknown>>) {
  const byClient: Record<string, Array<Record<string, unknown>>> = {};

  for (const client of clients) {
    const manualIds = new Set([
      ...(client.integrationMappings?.rankTracker || []),
      ...(client.integrationMappings?.mapCheckins || []),
    ]);
    // Manual pins are additive: auto name matches always stay in.
    const matches = businesses.filter(
      (business) =>
        namesLikelyMatch(client.name, String(business.business_name || "")) ||
        manualIds.has(String(business._id || "")),
    );
    if (matches.length) {
      byClient[client.id] = matches;
    }
  }

  return byClient;
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
  for (const account of accounts) {
    if (!account.name) {
      continue;
    }

    let pageToken: string | undefined;
    do {
      const url = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations`);
      url.searchParams.set("pageSize", "100");
      url.searchParams.set("readMask", "name,title,storeCode,websiteUri,metadata");
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const locationsPayload = await fetchJson(url.toString(), {
        headers: getBearerHeaders(accessToken),
      });
      const accountLocations = Array.isArray(locationsPayload.locations)
        ? (locationsPayload.locations as Array<Record<string, unknown>>)
        : [];
      locations.push(
        ...accountLocations.map((location) => ({
          ...location,
          accountName: account.accountName || account.name,
        })),
      );
      pageToken = typeof locationsPayload.nextPageToken === "string" ? locationsPayload.nextPageToken : undefined;
    } while (pageToken);
  }

  counts.fetched = accounts.length + locations.length;
  counts.created = locations.length;

  const clients = await listFirestoreClients(context.tenantId);
  const locationsByClient = matchLocationsToClients(clients, locations);
  const matchedLocations = Object.values(locationsByClient).flat();

  const performance: Array<Awaited<ReturnType<typeof fetchGbpLocationPerformance>>> = [];
  for (const location of matchedLocations) {
    performance.push(await fetchGbpLocationPerformance(accessToken, String(location.name || "")));
  }

  return {
    summary: [
      `${formatSummaryCount("account", accounts.length)} loaded`,
      `${formatSummaryCount("location", locations.length)} discovered`,
      `${formatSummaryCount("location", matchedLocations.length)} matched to MTOS clients`,
    ].join(", "),
    counts,
    snapshotPayload: {
      accounts: accounts.map((account) => ({
        id: account.name || "",
        name: account.accountName || "Unknown account",
        type: account.type || "UNKNOWN",
      })),
      locations,
      locationsByClient,
      performance: performance.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
    },
  } satisfies SyncExecutionResult;
}

const GBP_PERFORMANCE_METRICS = [
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
];

function formatIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function toGoogleDateParts(date: Date) {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function sumGbpDailyMetrics(payload: JsonRecord) {
  const series = Array.isArray(payload.multiDailyMetricTimeSeries)
    ? (payload.multiDailyMetricTimeSeries as JsonRecord[])
    : [];
  const totals: Record<string, number> = {};

  for (const bucket of series) {
    const dailyMetricTimeSeries = Array.isArray(bucket.dailyMetricTimeSeries)
      ? (bucket.dailyMetricTimeSeries as JsonRecord[])
      : [];
    for (const entry of dailyMetricTimeSeries) {
      const metric = String(entry.dailyMetric || "UNKNOWN");
      const timeSeries = entry.timeSeries as JsonRecord | undefined;
      const datedValues = Array.isArray(timeSeries?.datedValues) ? (timeSeries!.datedValues as JsonRecord[]) : [];
      const total = datedValues.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
      totals[metric] = (totals[metric] || 0) + total;
    }
  }

  return totals;
}

async function fetchGbpLocationPerformance(accessToken: string, locationResourceName: string) {
  const locationId = locationResourceName.split("/").filter(Boolean).pop();
  if (!locationId) {
    return null;
  }

  const periodEnd = new Date();
  periodEnd.setUTCDate(periodEnd.getUTCDate() - 1);
  const periodStart = new Date(periodEnd);
  periodStart.setUTCDate(periodStart.getUTCDate() - 29);
  const priorEnd = new Date(periodStart);
  priorEnd.setUTCDate(priorEnd.getUTCDate() - 1);
  const priorStart = new Date(priorEnd);
  priorStart.setUTCDate(priorStart.getUTCDate() - 29);

  const buildUrl = (start: Date, end: Date) => {
    const url = new URL(
      `https://businessprofileperformance.googleapis.com/v1/locations/${locationId}:fetchMultiDailyMetricsTimeSeries`,
    );
    for (const metric of GBP_PERFORMANCE_METRICS) {
      url.searchParams.append("dailyMetrics", metric);
    }
    const startParts = toGoogleDateParts(start);
    const endParts = toGoogleDateParts(end);
    url.searchParams.set("dailyRange.start_date.year", String(startParts.year));
    url.searchParams.set("dailyRange.start_date.month", String(startParts.month));
    url.searchParams.set("dailyRange.start_date.day", String(startParts.day));
    url.searchParams.set("dailyRange.end_date.year", String(endParts.year));
    url.searchParams.set("dailyRange.end_date.month", String(endParts.month));
    url.searchParams.set("dailyRange.end_date.day", String(endParts.day));
    return url.toString();
  };

  try {
    const [currentPayload, priorPayload] = await Promise.all([
      fetchJson(buildUrl(periodStart, periodEnd), { headers: getBearerHeaders(accessToken) }),
      fetchJson(buildUrl(priorStart, priorEnd), { headers: getBearerHeaders(accessToken) }).catch(() => ({})),
    ]);

    const current = sumGbpDailyMetrics(currentPayload);
    const prior = sumGbpDailyMetrics(priorPayload);

    return {
      locationId,
      periodStart: formatIsoDate(periodStart),
      periodEnd: formatIsoDate(periodEnd),
      calls: current.CALL_CLICKS || 0,
      websiteClicks: current.WEBSITE_CLICKS || 0,
      directionRequests: current.BUSINESS_DIRECTION_REQUESTS || 0,
      searches: (current.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH || 0) + (current.BUSINESS_IMPRESSIONS_MOBILE_SEARCH || 0),
      mapViews: (current.BUSINESS_IMPRESSIONS_DESKTOP_MAPS || 0) + (current.BUSINESS_IMPRESSIONS_MOBILE_MAPS || 0),
      previous: {
        calls: prior.CALL_CLICKS || 0,
        websiteClicks: prior.WEBSITE_CLICKS || 0,
        directionRequests: prior.BUSINESS_DIRECTION_REQUESTS || 0,
        searches: (prior.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH || 0) + (prior.BUSINESS_IMPRESSIONS_MOBILE_SEARCH || 0),
        mapViews: (prior.BUSINESS_IMPRESSIONS_DESKTOP_MAPS || 0) + (prior.BUSINESS_IMPRESSIONS_MOBILE_MAPS || 0),
      },
    };
  } catch (error) {
    return {
      locationId,
      error: error instanceof Error ? error.message : "Performance metrics unavailable for this location",
    };
  }
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

  // Properties we are only an unverified user on cannot be queried -- asking anyway returns 403 and
  // used to abort the whole sync depending on where one landed in the list.
  const queryableSites = sites.filter(
    (site) => site.siteUrl && site.permissionLevel !== "siteUnverifiedUser",
  );
  let failedSites = 0;

  for (const site of queryableSites) {
    const encodedSiteUrl = encodeURIComponent(site.siteUrl as string);
    try {
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
    } catch {
      // One property's failure should not cost us the other 82.
      failedSites += 1;
    }
  }

  counts.created = analytics.length;

  return {
    summary: [
      `${formatSummaryCount("property", sites.length)} listed`,
      `${formatSummaryCount("analytics snapshot", analytics.length)} captured`,
      `${sites.length - queryableSites.length} unverified skipped`,
      ...(failedSites ? [`${failedSites} failed`] : []),
    ].join(", "),
    counts,
    snapshotPayload: {
      dateRange: { startDate, endDate },
      sites,
      analytics,
    },
  } satisfies SyncExecutionResult;
}

function normalizeGoogleAdsCustomerId(value: string) {
  return value.replace(/[^0-9]/g, "");
}

async function fetchGoogleAdsRows(
  customerId: string,
  query: string,
  accessToken: string,
  developerToken: string,
  loginCustomerId?: string,
) {
  const headers: Record<string, string> = {
    ...getBearerHeaders(accessToken),
    "content-type": "application/json",
    "developer-token": developerToken,
  };
  if (loginCustomerId) {
    headers["login-customer-id"] = loginCustomerId;
  }

  // Google retires Ads API versions on a rolling schedule and a retired one 404s, which surfaced as
  // an opaque sync failure. Overridable so the next retirement is a config change, not a deploy.
  const apiVersion = process.env.GOOGLE_ADS_API_VERSION?.trim() || "v22";
  const payload = await fetchJson(
    `https://googleads.googleapis.com/${apiVersion}/customers/${customerId}/googleAds:searchStream`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ query }),
    },
  );

  const batches = Array.isArray(payload)
    ? (payload as JsonRecord[])
    : Array.isArray((payload as JsonRecord).results)
      ? [payload as JsonRecord]
      : [payload as JsonRecord];

  return batches.flatMap((batch) =>
    Array.isArray(batch.results) ? (batch.results as JsonRecord[]) : [],
  );
}

async function syncGoogleAds(context: TenantContext, record: IntegrationConnectionRecord, origin?: string) {
  const refreshedRecord = await maybeRefreshConnection(context, record, origin);
  const credentials = getIntegrationCredentials(refreshedRecord);
  const accessToken = credentials.accessToken;
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() || process.env.GOOGLE_ADS_API_KEY?.trim() || "";
  const loginCustomerId = normalizeGoogleAdsCustomerId(
    credentials.managerCustomerId ||
      refreshedRecord.externalAccountId ||
      process.env.GOOGLE_ADS_MCC_ID ||
      "",
  );

  if (!accessToken) {
    throw new Error("Google Ads access token is missing");
  }
  if (!developerToken) {
    throw new Error("Google Ads developer token is missing");
  }
  if (!loginCustomerId) {
    throw new Error("Google Ads MCC / login customer ID is missing");
  }

  const customerRows = await fetchGoogleAdsRows(
    loginCustomerId,
    `SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.manager, customer_client.status FROM customer_client WHERE customer_client.level <= 1`,
    accessToken,
    developerToken,
    loginCustomerId,
  );

  const customers = customerRows
    .map((row) => (row.customerClient || row.customer_client || {}) as GoogleAdsAccessibleCustomer)
    .filter((customer) => customer.id && !customer.manager)
    .map((customer) => ({
      customerId: normalizeGoogleAdsCustomerId(String(customer.id || "")),
      descriptiveName: String(customer.descriptiveName || "Unnamed account"),
      currencyCode: String(customer.currencyCode || ""),
      manager: Boolean(customer.manager),
    }))
    .filter((customer) => customer.customerId);

  const clients = await listFirestoreClients(context.tenantId);
  const matchedPairs = clients
    .map((client) => {
      const manualIds = new Set(client.integrationMappings?.googleAds || []);
      const match = customers.find(
        (customer) =>
          namesLikelyMatch(client.name, customer.descriptiveName) || manualIds.has(customer.customerId),
      );
      return match ? { client, customer: match } : null;
    })
    .filter((value): value is { client: ClientRecord; customer: (typeof customers)[number] } => Boolean(value));

  const adsByClient: Record<string, JsonRecord> = {};
  for (const { client, customer } of matchedPairs.slice(0, 40)) {
    try {
      const metricsRows = await fetchGoogleAdsRows(
        customer.customerId,
        `SELECT metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.ctr, metrics.conversions, metrics.conversions_value FROM customer WHERE segments.date DURING LAST_30_DAYS`,
        accessToken,
        developerToken,
        loginCustomerId,
      );
      const totals = metricsRows.reduce<{ costMicros: number; clicks: number; impressions: number; conversions: number; conversionsValue: number }>(
        (accumulator, row) => {
          const metrics = (row.metrics || {}) as JsonRecord;
          accumulator.costMicros += Number(metrics.costMicros || metrics.cost_micros) || 0;
          accumulator.clicks += Number(metrics.clicks) || 0;
          accumulator.impressions += Number(metrics.impressions) || 0;
          accumulator.conversions += Number(metrics.conversions) || 0;
          accumulator.conversionsValue += Number(metrics.conversionsValue || metrics.conversions_value) || 0;
          return accumulator;
        },
        { costMicros: 0, clicks: 0, impressions: 0, conversions: 0, conversionsValue: 0 },
      );

      adsByClient[client.id] = {
        customerId: customer.customerId,
        descriptiveName: customer.descriptiveName,
        currencyCode: customer.currencyCode,
        spend: Math.round((totals.costMicros / 1_000_000) * 100) / 100,
        clicks: totals.clicks,
        impressions: totals.impressions,
        ctr: totals.impressions ? Math.round((totals.clicks / totals.impressions) * 10000) / 100 : null,
        conversions: totals.conversions,
        conversionValue: Math.round(totals.conversionsValue * 100) / 100,
        costPerLead: totals.conversions ? Math.round((totals.costMicros / 1_000_000 / totals.conversions) * 100) / 100 : null,
        conversionRate: totals.clicks ? Math.round((totals.conversions / totals.clicks) * 10000) / 100 : null,
      };
    } catch (error) {
      adsByClient[client.id] = {
        customerId: customer.customerId,
        descriptiveName: customer.descriptiveName,
        currencyCode: customer.currencyCode,
        error: error instanceof Error ? error.message : "Google Ads metrics unavailable",
      };
    }
  }

  const counts = createEmptyCounts();
  counts.fetched = customers.length;
  counts.created = Object.keys(adsByClient).length;

  return {
    summary: `${formatSummaryCount("Google Ads account", customers.length)} listed, ${formatSummaryCount("account", matchedPairs.length)} matched to MTOS clients, metrics captured for ${Object.keys(adsByClient).length}`,
    counts,
    snapshotPayload: {
      loginCustomerId,
      customerIndex: customers,
      adsByClient,
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

  if (providerId === "map-checkins") {
    const apiBase = (credentials.apiBaseUrl || refreshedRecord.apiBaseUrl || "https://dashboardapi.mapranking.com").replace(/\/$/, "");
    const checkinBusinesses: Array<Record<string, unknown>> = [];
    // API caps page size at 20
    for (let page = 1; page <= 50; page += 1) {
      const pagePayload = await fetchJson(`${apiBase}/api/checkin-business/get-business-paginated`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...getBearerHeaders(accessToken),
        },
        body: JSON.stringify({ page, limit: 20 }),
      });
      const rows = Array.isArray(pagePayload.data) ? (pagePayload.data as Array<Record<string, unknown>>) : [];
      checkinBusinesses.push(...rows);
      if (rows.length < 20) {
        break;
      }
    }

    const clients = await listFirestoreClients(context.tenantId);
    const checkinBusinessesByClient = matchBusinessesToClients(
      clients,
      checkinBusinesses.map((row) => ({
        ...row,
        business_name: row.business_name,
      })),
    );

    // Post counts alone cannot answer "are they still active?" -- that needs the date of the last
    // post. Fetch it only for businesses matched to a client, so the extra calls stay proportional.
    const matchedCheckinIds = new Set<string>();
    for (const rows of Object.values(checkinBusinessesByClient)) {
      for (const row of rows) {
        const id = String(row._id || "");
        if (id) matchedCheckinIds.add(id);
      }
    }

    const postActivityById = new Map<string, CheckinPostActivity>();
    for (const checkinId of matchedCheckinIds) {
      try {
        postActivityById.set(checkinId, await fetchCheckinPostActivity(apiBase, accessToken, checkinId));
      } catch {
        // A business whose posts cannot be read still reports its counts; the dates stay null.
      }
    }

    const counts = createEmptyCounts();
    counts.fetched = checkinBusinesses.length;
    counts.created = counts.fetched;

    return {
      summary: `${formatSummaryCount("check-in business", checkinBusinesses.length)} synced, ${formatSummaryCount("business", Object.keys(checkinBusinessesByClient).length)} matched to MTOS clients`,
      counts,
      snapshotPayload: {
        checkinBusinessesByClient: Object.fromEntries(
          Object.entries(checkinBusinessesByClient).map(([clientId, rows]) => [
            clientId,
            rows.map((row) => {
              const activity = postActivityById.get(String(row._id || ""));
              return {
                _id: row._id,
                business_name: row.business_name,
                totalPosts: row.totalPosts,
                scheduledPosts: row.scheduledPosts,
                integration_status: row.integration_status,
                lastPostAt: activity?.lastPostAt ?? null,
                lastPostPlatform: activity?.lastPostPlatform ?? null,
                nextScheduledPostAt: activity?.nextScheduledPostAt ?? null,
              };
            }),
          ]),
        ),
      },
    } satisfies SyncExecutionResult;
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

  const businesses = Array.isArray(payload.data) ? (payload.data as Array<Record<string, unknown>>) : [];
  const clients = await listFirestoreClients(context.tenantId);
  const businessesByClient = matchBusinessesToClients(clients, businesses);

  // Store only the fields the prep pack reads -- the raw list of every business in the
  // workspace would push the snapshot document toward Firestore's 1MB limit.
  const compactBusinessesByClient = Object.fromEntries(
    Object.entries(businessesByClient).map(([clientId, rows]) => [
      clientId,
      rows.map((row) => ({
        _id: row._id,
        business_name: row.business_name,
        formatted_address: row.formatted_address || row.address,
        rating: row.rating,
        reviews: row.reviews,
        place_id: row.place_id,
        keywords: Array.isArray(row.keywords) ? Array.from(new Set(row.keywords as unknown[])) : [],
      })),
    ]),
  );

  return {
    summary: `${formatSummaryCount("ranking row", counts.fetched)} synced, ${formatSummaryCount("business", Object.keys(businessesByClient).length)} matched to MTOS clients`,
    counts,
    snapshotPayload: {
      totalBusinesses: businesses.length,
      businessesByClient: compactBusinessesByClient,
    },
  } satisfies SyncExecutionResult;
}

interface GhlAgencyLocation {
  id: string;
  name: string;
  companyId?: string;
  apiKey?: string;
}

type GhlAgencyMode = "v2" | "v1";

async function listGhlAgencyLocations(agencyKey: string, mode: GhlAgencyMode): Promise<GhlAgencyLocation[]> {
  if (mode === "v2") {
    // v2 agency credential: private integration token or company-level OAuth token
    const payload = await fetchJson("https://services.leadconnectorhq.com/locations/search?limit=500", {
      headers: { ...getBearerHeaders(agencyKey), Version: "2021-07-28" },
    });
    const locations = Array.isArray(payload.locations) ? (payload.locations as JsonRecord[]) : [];
    return locations.map((location) => ({
      id: String(location.id || location._id || ""),
      name: String(location.name || ""),
      companyId: typeof location.companyId === "string" ? location.companyId : undefined,
    }));
  }

  // v1 agency API key
  const payload = await fetchJson("https://rest.gohighlevel.com/v1/locations/", {
    headers: getBearerHeaders(agencyKey),
  });
  const locations = Array.isArray(payload.locations) ? (payload.locations as JsonRecord[]) : [];
  return locations.map((location) => ({
    id: String(location.id || location._id || ""),
    name: String(location.name || ""),
    apiKey: typeof location.apiKey === "string" ? location.apiKey : undefined,
  }));
}

interface GhlLeadCounts {
  newLeads30d: number | null;
  totalContacts: number | null;
  pipelineOpportunities: number | null;
  bookedJobsWon: number | null;
  sampleContacts: JsonRecord[];
  errorMessage?: string;
}

const emptyGhlLeadCounts = (errorMessage?: string): GhlLeadCounts => ({
  newLeads30d: null,
  totalContacts: null,
  pipelineOpportunities: null,
  bookedJobsWon: null,
  sampleContacts: [],
  errorMessage,
});

function readGhlMetaTotal(payload: JsonRecord) {
  const meta = (payload.meta || {}) as JsonRecord;
  return typeof meta.total === "number" ? meta.total : null;
}

async function mintGhlLocationToken(agencyKey: string, location: GhlAgencyLocation) {
  if (!location.companyId) {
    return null;
  }

  const response = await fetch("https://services.leadconnectorhq.com/oauth/locationToken", {
    method: "POST",
    headers: {
      ...getBearerHeaders(agencyKey),
      Version: "2021-07-28",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ companyId: location.companyId, locationId: location.id }).toString(),
  });
  const payload = (await response.json().catch(() => ({}))) as JsonRecord;
  if (!response.ok) {
    return null;
  }
  return typeof payload.access_token === "string" ? payload.access_token : null;
}

async function fetchGhlLeadCountsWithToken(token: string, locationId: string): Promise<GhlLeadCounts> {
  const headers = { ...getBearerHeaders(token), Version: "2021-07-28" };
  const encodedLocation = encodeURIComponent(locationId);

  // One small page gives both the true all-time total (meta.total) and a contact sample.
  const contactsPayload = await fetchJson(
    `https://services.leadconnectorhq.com/contacts/?locationId=${encodedLocation}&limit=5`,
    { headers },
  );
  const sampleContacts = Array.isArray(contactsPayload.contacts) ? (contactsPayload.contacts as JsonRecord[]) : [];
  const totalContacts = readGhlMetaTotal(contactsPayload);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const searchPayload = await fetchJson("https://services.leadconnectorhq.com/contacts/search", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      locationId,
      pageLimit: 1,
      filters: [{ field: "dateAdded", operator: "range", value: { gte: thirtyDaysAgo } }],
    }),
  }).catch(() => ({}) as JsonRecord);
  const newLeads30d = typeof searchPayload.total === "number" ? searchPayload.total : null;

  const opportunitiesPayload = await fetchJson(
    `https://services.leadconnectorhq.com/opportunities/search?location_id=${encodedLocation}&limit=1`,
    { headers },
  ).catch(() => ({}) as JsonRecord);
  const wonPayload = await fetchJson(
    `https://services.leadconnectorhq.com/opportunities/search?location_id=${encodedLocation}&status=won&limit=1`,
    { headers },
  ).catch(() => ({}) as JsonRecord);

  return {
    newLeads30d,
    totalContacts,
    pipelineOpportunities: readGhlMetaTotal(opportunitiesPayload),
    bookedJobsWon: readGhlMetaTotal(wonPayload),
    sampleContacts,
  };
}

async function fetchGhlLocationLeadCounts(
  agencyKey: string,
  location: GhlAgencyLocation,
  mode: GhlAgencyMode,
): Promise<GhlLeadCounts> {
  if (mode === "v2") {
    try {
      // GHL's intended agency flow: mint a short-lived location token, then read location data.
      const locationToken = await mintGhlLocationToken(agencyKey, location);
      if (locationToken) {
        return await fetchGhlLeadCountsWithToken(locationToken, location.id);
      }
      // Fall back to calling directly with the agency token (works if GHL ever allows it).
      return await fetchGhlLeadCountsWithToken(agencyKey, location.id);
    } catch (error) {
      return emptyGhlLeadCounts(error instanceof Error ? error.message : "GoHighLevel contact fetch failed");
    }
  }

  // v1: each location record carries its own API key for location-scoped endpoints
  if (!location.apiKey) {
    return emptyGhlLeadCounts("No v1 location API key available");
  }
  const headers = getBearerHeaders(location.apiKey);
  try {
    const contactsPayload = await fetchJson("https://rest.gohighlevel.com/v1/contacts/?limit=100", { headers });
    const contacts = Array.isArray(contactsPayload.contacts) ? (contactsPayload.contacts as JsonRecord[]) : [];
    return {
      newLeads30d: null,
      totalContacts: contacts.length,
      pipelineOpportunities: null,
      bookedJobsWon: null,
      sampleContacts: contacts.slice(0, 5),
    };
  } catch (error) {
    return emptyGhlLeadCounts(error instanceof Error ? error.message : "GoHighLevel contact fetch failed");
  }
}

async function syncGoHighLevelAgency(
  context: TenantContext,
  agencyKey: string,
  mode: GhlAgencyMode,
  fallbackCompanyId?: string,
): Promise<SyncExecutionResult> {
  const locations = await listGhlAgencyLocations(agencyKey, mode);
  const clients = await listFirestoreClients(context.tenantId);

  const matchedPairs: Array<{ client: ClientRecord; location: GhlAgencyLocation }> = [];
  for (const client of clients) {
    const manualIds = new Set(client.integrationMappings?.gohighlevel || []);
    // Manual pins are additive: auto name matches always stay in.
    const match = locations.find(
      (location) => namesLikelyMatch(client.name, location.name) || manualIds.has(location.id),
    );
    if (match) {
      matchedPairs.push({
        client,
        location: { ...match, companyId: match.companyId || fallbackCompanyId },
      });
    }
  }

  const leadsByClient: Record<string, JsonRecord> = {};
  const fetchErrors: string[] = [];
  // Cap per-sync work; a nightly sync cycles through the rest.
  const pairsToFetch = matchedPairs.slice(0, 40);
  for (const { client, location } of pairsToFetch) {
    const counts = await fetchGhlLocationLeadCounts(agencyKey, location, mode);
    if (counts.errorMessage) {
      fetchErrors.push(counts.errorMessage);
      continue;
    }
    leadsByClient[client.id] = {
      locationId: location.id,
      locationName: location.name,
      totalLeads: counts.newLeads30d,
      totalLeadsAllTime: counts.totalContacts,
      qualifiedLeads: counts.pipelineOpportunities,
      bookedJobs: counts.bookedJobsWon,
      sampleContacts: counts.sampleContacts.map((contact) => ({
        id: contact.id,
        source: contact.source || "unknown",
        dateAdded: contact.dateAdded,
      })),
    };
  }

  // All lead pulls failing means the token itself is under-scoped -- surface that as a sync
  // failure instead of writing a snapshot full of misleading zeros.
  if (pairsToFetch.length && !Object.keys(leadsByClient).length) {
    const scopeProblem = fetchErrors.some((message) => message.toLowerCase().includes("scope"));
    throw new Error(
      scopeProblem
        ? "GoHighLevel agency credential is missing scopes: it needs 'oauth.write' (Location Tokens) plus 'contacts.readonly' and 'opportunities.readonly'. Update the marketplace app scopes / private integration, reconnect, then re-sync."
        : `GoHighLevel lead pulls failed for every matched location -- first error: ${fetchErrors[0] || "unknown"}`,
    );
  }

  const counts = createEmptyCounts();
  counts.fetched = locations.length;
  counts.created = Object.keys(leadsByClient).length;

  return {
    summary: `${formatSummaryCount("agency location", locations.length)} listed, ${formatSummaryCount(
      "location",
      matchedPairs.length,
    )} matched to MTOS clients, lead data pulled for ${Object.keys(leadsByClient).length}${fetchErrors.length ? ` (${fetchErrors.length} failed)` : ""}`,
    counts,
    snapshotPayload: {
      mode: "agency",
      totalLocations: locations.length,
      // Compact candidate index so the client-mapping UI can offer every location for manual pinning.
      locationIndex: locations.map((location) => ({ id: location.id, name: location.name })),
      leadsByClient,
    },
  } satisfies SyncExecutionResult;
}

function decodeJwtPayload(token: string): JsonRecord {
  try {
    const segments = token.split(".");
    if (segments.length < 2) {
      return {};
    }
    return JSON.parse(Buffer.from(segments[1], "base64").toString("utf8")) as JsonRecord;
  } catch {
    return {};
  }
}

async function syncGoHighLevel(context: TenantContext, record: IntegrationConnectionRecord, origin?: string) {
  const refreshedRecord = await maybeRefreshConnection(context, record, origin);
  const credentials = getIntegrationCredentials(refreshedRecord);
  const accessToken = credentials.accessToken;

  if (!accessToken) {
    throw new Error("GoHighLevel access token is missing");
  }

  // An agency-level OAuth install ("Company" auth class) can enumerate every sub-account and
  // mint location tokens, so it is the preferred agency path -- even over an env agency key.
  const tokenPayload = decodeJwtPayload(accessToken);
  const isCompanyToken =
    String(credentials.userType || "").toLowerCase() === "company" ||
    String(tokenPayload.authClass || "").toLowerCase() === "company";
  if (isCompanyToken) {
    const companyId =
      credentials.companyId ||
      (typeof tokenPayload.authClassId === "string" ? tokenPayload.authClassId : undefined);
    return syncGoHighLevelAgency(context, accessToken, "v2", companyId);
  }

  const agencyKey = getServerEnv().gohighlevelAgencyApiKey;
  if (agencyKey) {
    return syncGoHighLevelAgency(context, agencyKey, agencyKey.startsWith("pit-") ? "v2" : "v1");
  }

  const locationId = credentials.locationId || refreshedRecord.externalAccountId;
  if (!locationId) {
    throw new Error("GoHighLevel sub-account is missing -- reconnect and select a location");
  }

  const baseUrl = getIntegrationDefinition("gohighlevel").defaultApiBaseUrl || "https://services.leadconnectorhq.com";
  const headers = {
    ...getBearerHeaders(accessToken),
    Version: "2021-07-28",
  };

  const contactsPayload = await fetchJson(
    `${baseUrl}/contacts/?locationId=${encodeURIComponent(locationId)}&limit=100`,
    { headers },
  );
  const contacts = Array.isArray(contactsPayload.contacts) ? (contactsPayload.contacts as JsonRecord[]) : [];

  const opportunitiesPayload = await fetchJson(
    `${baseUrl}/opportunities/search?location_id=${encodeURIComponent(locationId)}&limit=100`,
    { headers },
  ).catch(() => ({}) as JsonRecord);
  const dealOpportunities = Array.isArray(opportunitiesPayload.opportunities)
    ? (opportunitiesPayload.opportunities as JsonRecord[])
    : [];
  const wonOpportunities = dealOpportunities.filter(
    (item) => String(item.status || "").toLowerCase() === "won",
  );

  const counts = createEmptyCounts();
  counts.fetched = contacts.length + dealOpportunities.length;
  counts.created = counts.fetched;

  return {
    summary: [
      `${formatSummaryCount("contact", contacts.length)} loaded`,
      `${formatSummaryCount("opportunity", dealOpportunities.length)} loaded`,
    ].join(", "),
    counts,
    snapshotPayload: {
      locationId,
      totalLeads: contacts.length,
      qualifiedLeads: dealOpportunities.length,
      bookedJobs: wonOpportunities.length,
      sampleContacts: contacts.slice(0, 10).map((contact) => ({
        id: contact.id,
        name:
          contact.contactName ||
          contact.name ||
          `${contact.firstName || ""} ${contact.lastName || ""}`.trim() ||
          "Unnamed contact",
        source: contact.source || "unknown",
        dateAdded: contact.dateAdded,
      })),
      opportunities: dealOpportunities.slice(0, 10).map((item) => ({
        id: item.id,
        name: item.name,
        status: item.status,
        monetaryValue: item.monetaryValue,
      })),
    },
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
    case "google-ads":
      return syncGoogleAds(context, record, origin);
    case "google-search-console":
      return syncSearchConsole(context, record);
    case "rank-tracker":
      return syncRotatingTokenProvider(context, "rank-tracker", record, origin);
    case "map-checkins":
      return syncRotatingTokenProvider(context, "map-checkins", record, origin);
    case "gohighlevel":
      return syncGoHighLevel(context, record, origin);
    case "google-ads":
      return syncGoogleAds(context, record, origin);
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
