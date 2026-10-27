import { nanoid } from "nanoid";

import type {
  IntegrationConnectionRecord,
  IntegrationProviderId,
} from "@/src/lib/contracts/integrations";
import type {
  ExternalRecordMappingRecord,
  IntegrationConnectionTestCheck,
  IntegrationConnectionTestResult,
  IntegrationSnapshotRecord,
  IntegrationSyncCounts,
  IntegrationSyncJobRecord,
} from "@/src/lib/contracts/integration-sync";
import type { TenantContext } from "@/src/lib/contracts/mtos";
import type {
  ClientRecord,
  CommitmentRecord,
  GbpProfileInsight,
  GbpReviewHighlight,
  LsaPerformanceDetail,
} from "@/src/lib/mtos-data";
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
import { parseCheckinPostDate } from "@/src/lib/server/services/mapranking-dashboard";

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

/**
 * Firestore rejects `undefined` values (it throws on the whole document write).
 * Drop undefined keys recursively so an optional field left unset by any provider
 * can never fail a snapshot write. `null` and everything else are preserved.
 */
function dropUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => dropUndefinedDeep(item)) as unknown as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nested]) => nested !== undefined)
        .map(([key, nested]) => [key, dropUndefinedDeep(nested)]),
    ) as T;
  }
  return value;
}

/** Firestore's hard per-document ceiling, and the point at which a snapshot is worth a warning. */
const FIRESTORE_DOCUMENT_LIMIT_BYTES = 1_048_576;
const SNAPSHOT_SIZE_WARNING_BYTES = Math.floor(FIRESTORE_DOCUMENT_LIMIT_BYTES * 0.8);

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

  // Strip undefined before the write -- a single unset optional field (e.g. a
  // contact with no email) would otherwise reject the entire snapshot.
  const document = dropUndefinedDeep(snapshot);

  // Firestore caps a document at 1MiB and reports an overflow only as a raw INVALID_ARGUMENT with
  // a byte count, which says nothing about which provider or which part of the payload grew. A
  // snapshot holds whatever an upstream API returned, so this is a live risk on every provider:
  // check it here and name the provider, so the next overflow is diagnosable from the message.
  const approximateBytes = Buffer.byteLength(JSON.stringify(document), "utf8");
  if (approximateBytes > SNAPSHOT_SIZE_WARNING_BYTES) {
    console.warn(
      `${providerId} snapshot is ${approximateBytes} bytes, close to Firestore's ${FIRESTORE_DOCUMENT_LIMIT_BYTES}-byte document limit. Narrow what the sync stores before it overflows.`,
    );
  }
  if (approximateBytes > FIRESTORE_DOCUMENT_LIMIT_BYTES) {
    throw new Error(
      `The ${getIntegrationDefinition(providerId).name} snapshot is ${approximateBytes} bytes, over Firestore's ${FIRESTORE_DOCUMENT_LIMIT_BYTES}-byte document limit, so it was not saved. The sync is storing more per record than it needs to -- narrow the stored payload.`,
    );
  }

  await db.doc(integrationSnapshotPath(context.tenantId, providerId)).set(document);
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

/**
 * Turns an error body into a sentence worth showing an AM.
 *
 * Google reports failures as `{ error: { code, message, status } }` -- an OBJECT. The previous
 * check tested `typeof payload.error === "string"`, which never matches that shape, and there is no
 * top-level `message` either, so every Google failure collapsed to "Request failed with status
 * 403". That is the one case where Google actually tells you what to do: a disabled API names the
 * API and the project, and a missing grant says so. The prep pack showed the status and dropped the
 * reason, which left "Reviews could not be read: Request failed with status 403" on the call sheet
 * and nothing to act on.
 */
export function describeApiError(payload: JsonRecord, status: number): string {
  const error = payload.error;

  if (error && typeof error === "object" && !Array.isArray(error)) {
    const nested = error as JsonRecord;
    const message = typeof nested.message === "string" ? nested.message.trim() : "";
    // `status` is Google's symbolic reason (PERMISSION_DENIED, SERVICE_DISABLED, NOT_FOUND); it
    // survives truncation of the long message and is what a search actually matches on.
    const reason = typeof nested.status === "string" ? nested.status.trim() : "";
    if (message) {
      return reason ? `${message} (${reason})` : message;
    }
    if (reason) {
      return `${reason} (status ${status})`;
    }
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }

  return `Request failed with status ${status}`;
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as JsonRecord;

  if (!response.ok) {
    throw new Error(describeApiError(payload, response.status));
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

  const toMs = (value?: string | null) => parseCheckinPostDate(value);

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

/**
 * The only location fields anything reads back out of the snapshot: the resource name (which
 * carries the id), the title used for name matching, and the three fields the client-mapping
 * picker shows. The full Google location record is 50-100x this -- categories, hours, service
 * items, addresses -- and is needed only while the sync runs, to derive listing completeness.
 * Storing the fat record for every location (twice, since locationsByClient repeats it) pushed
 * this snapshot past Firestore's 1MB per-document ceiling, so only this projection is written.
 */
function toSlimGbpLocation(location: JsonRecord): JsonRecord {
  return {
    name: String(location.name || ""),
    title: String(location.title || ""),
    storeCode: String(location.storeCode || ""),
    websiteUri: String(location.websiteUri || ""),
    accountName: String(location.accountName || ""),
  };
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
      // Wide enough to judge listing completeness on the touch (categories, hours, description,
      // service items, open state), not just identify the location.
      url.searchParams.set(
        "readMask",
        [
          "name",
          "title",
          "storeCode",
          "websiteUri",
          "metadata",
          "phoneNumbers",
          "categories",
          "storefrontAddress",
          "regularHours",
          "specialHours",
          "serviceArea",
          "profile",
          "latlng",
          "openInfo",
          "serviceItems",
        ].join(","),
      );
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
          // The v4 reviews/posts/media endpoints are addressed as
          // accounts/{id}/locations/{id}, so the owning account's RESOURCE name has to travel
          // with the location -- accountName above is a display name and cannot be used here.
          accountResourceName: account.name,
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
  const profileInsights: GbpProfileInsight[] = [];
  // Sequential across locations to stay friendly to Google's per-minute quota, but the two pulls
  // for a given location are independent and run together.
  for (const location of matchedLocations) {
    const [locationPerformance, locationInsights] = await Promise.all([
      fetchGbpLocationPerformance(accessToken, String(location.name || "")),
      fetchGbpProfileInsights(accessToken, location),
    ]);
    performance.push(locationPerformance);
    profileInsights.push(locationInsights);
  }

  const reviewTotal = profileInsights.reduce((sum, entry) => sum + (entry.reviews?.totalCount ?? 0), 0);
  const unansweredTotal = profileInsights.reduce((sum, entry) => sum + (entry.reviews?.unansweredCount ?? 0), 0);

  return {
    summary: [
      `${formatSummaryCount("account", accounts.length)} loaded`,
      `${formatSummaryCount("location", locations.length)} discovered`,
      `${formatSummaryCount("location", matchedLocations.length)} matched to MTOS clients`,
      `${formatSummaryCount("review", reviewTotal)} read (${unansweredTotal} unanswered)`,
    ].join(", "),
    counts,
    snapshotPayload: {
      accounts: accounts.map((account) => ({
        id: account.name || "",
        name: account.accountName || "Unknown account",
        type: account.type || "UNKNOWN",
      })),
      // Slimmed at the write boundary: matching and completeness above ran on the full records.
      locations: locations.map(toSlimGbpLocation),
      locationsByClient: Object.fromEntries(
        Object.entries(locationsByClient).map(([matchedClientId, matched]) => [
          matchedClientId,
          matched.map(toSlimGbpLocation),
        ]),
      ),
      performance: performance.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
      profileInsights,
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
  "BUSINESS_CONVERSATIONS",
  "BUSINESS_BOOKINGS",
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

/**
 * The 30-day window the touch reports on, ending yesterday, plus the 30 days before it for the
 * prior-period comparison. Shared by the performance counters and the listing insights so review,
 * post, and photo counts cover the same window as the calls and clicks shown beside them.
 */
function getGbpReportingWindow() {
  const periodEnd = new Date();
  periodEnd.setUTCDate(periodEnd.getUTCDate() - 1);
  const periodStart = new Date(periodEnd);
  periodStart.setUTCDate(periodStart.getUTCDate() - 29);
  const priorEnd = new Date(periodStart);
  priorEnd.setUTCDate(priorEnd.getUTCDate() - 1);
  const priorStart = new Date(priorEnd);
  priorStart.setUTCDate(priorStart.getUTCDate() - 29);
  return { periodStart, periodEnd, priorStart, priorEnd };
}

async function fetchGbpLocationPerformance(accessToken: string, locationResourceName: string) {
  const locationId = locationResourceName.split("/").filter(Boolean).pop();
  if (!locationId) {
    return null;
  }

  const { periodStart, periodEnd, priorStart, priorEnd } = getGbpReportingWindow();

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
      conversations: current.BUSINESS_CONVERSATIONS || 0,
      bookings: current.BUSINESS_BOOKINGS || 0,
      previous: {
        calls: prior.CALL_CLICKS || 0,
        websiteClicks: prior.WEBSITE_CLICKS || 0,
        directionRequests: prior.BUSINESS_DIRECTION_REQUESTS || 0,
        searches: (prior.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH || 0) + (prior.BUSINESS_IMPRESSIONS_MOBILE_SEARCH || 0),
        mapViews: (prior.BUSINESS_IMPRESSIONS_DESKTOP_MAPS || 0) + (prior.BUSINESS_IMPRESSIONS_MOBILE_MAPS || 0),
        conversations: prior.BUSINESS_CONVERSATIONS || 0,
        bookings: prior.BUSINESS_BOOKINGS || 0,
      },
    };
  } catch (error) {
    return {
      locationId,
      error: error instanceof Error ? error.message : "Performance metrics unavailable for this location",
    };
  }
}

/** Google reports star ratings as an enum, not a number. */
const GBP_STAR_RATINGS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

/**
 * Paging caps. A long-standing client can have thousands of reviews and photos; the touch only
 * needs recent history plus accurate totals (which Google returns on every page), so paging stops
 * early to keep the whole sync inside the route time budget. When a cap is hit the derived counts
 * become floors and the insight records a note saying so.
 */
/**
 * How many Business Profile accounts the connection test will look through to find a location to
 * sample.
 *
 * One is not enough, and on an agency (MCC) connection it is close to guaranteed to be wrong: the
 * manager account itself holds no locations, which sit in the location groups below it. The real
 * connection here lists 15 accounts and syncs 236 locations, yet sampling accounts[0] found none
 * and skipped every later probe. The scan stops at the first account that has a location, so the
 * usual cost is one or two requests; the cap only bounds the pathological case.
 */
const GBP_TEST_MAX_ACCOUNTS_SCANNED = 25;
const GBP_MAX_REVIEW_PAGES = 6;
const GBP_REVIEW_PAGE_SIZE = 50;
const GBP_HIGHLIGHT_LIMIT = 5;

function truncateForSnapshot(value: string, maxLength = 180) {
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 1).trimEnd()}...`;
}

function isWithinWindow(value: string, start: Date, end: Date) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return false;
  }
  // `end` is a date-only boundary, so count anything up to the close of that day.
  return timestamp >= start.getTime() && timestamp <= end.getTime() + 86_400_000 - 1;
}

function toReviewHighlight(review: JsonRecord): GbpReviewHighlight {
  const reviewer = (review.reviewer || {}) as JsonRecord;
  const reply = (review.reviewReply || null) as JsonRecord | null;
  return {
    reviewId: String(review.reviewId || review.name || ""),
    reviewer: String(reviewer.displayName || "Anonymous"),
    starRating: GBP_STAR_RATINGS[String(review.starRating || "")] ?? null,
    comment: truncateForSnapshot(String(review.comment || "")),
    createdAt: String(review.createTime || ""),
    replied: Boolean(reply && String(reply.comment || "").trim()),
  };
}

/**
 * Reviews live only on the legacy v4 API, which is also the part of Business Profile access Google
 * gates behind approval -- so this is the call most likely to fail on a connection that can already
 * read locations and performance. Callers report the failure rather than aborting the sync.
 */
async function fetchGbpReviews(accessToken: string, locationPath: string, periodStart: Date, periodEnd: Date) {
  const collected: JsonRecord[] = [];
  let totalCount: number | null = null;
  let averageRating: number | null = null;
  let pageToken = "";
  let pages = 0;

  do {
    const url = new URL(`https://mybusiness.googleapis.com/v4/${locationPath}/reviews`);
    url.searchParams.set("pageSize", String(GBP_REVIEW_PAGE_SIZE));
    url.searchParams.set("orderBy", "updateTime desc");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const payload = await fetchJson(url.toString(), { headers: getBearerHeaders(accessToken) });
    const reviews = Array.isArray(payload.reviews) ? (payload.reviews as JsonRecord[]) : [];
    collected.push(...reviews);
    if (typeof payload.totalReviewCount === "number") {
      totalCount = payload.totalReviewCount;
    }
    if (typeof payload.averageRating === "number") {
      averageRating = Math.round(payload.averageRating * 10) / 10;
    }
    pageToken = typeof payload.nextPageToken === "string" ? payload.nextPageToken : "";
    pages += 1;
  } while (pageToken && pages < GBP_MAX_REVIEW_PAGES);

  const highlights = collected.map(toReviewHighlight);
  const answered = highlights.filter((review) => review.replied).length;
  // Worst rating first: an unanswered one-star is the first thing to handle on the call.
  const unanswered = highlights
    .filter((review) => !review.replied)
    .sort((left, right) => (left.starRating ?? 5) - (right.starRating ?? 5));
  const recentNegative = highlights
    .filter((review) => review.starRating !== null && review.starRating <= 2)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const lastReviewAt = highlights
    .map((review) => review.createdAt)
    .filter(Boolean)
    .sort((left, right) => right.localeCompare(left))[0];

  return {
    reviews: {
      totalCount: totalCount ?? highlights.length,
      averageRating,
      newInPeriod: highlights.filter((review) => isWithinWindow(review.createdAt, periodStart, periodEnd)).length,
      unansweredCount: unanswered.length,
      responseRatePercent: highlights.length ? Math.round((answered / highlights.length) * 100) : null,
      lastReviewAt: lastReviewAt || null,
      unanswered: unanswered.slice(0, GBP_HIGHLIGHT_LIMIT),
      recentNegative: recentNegative.slice(0, GBP_HIGHLIGHT_LIMIT),
    },
    capped: Boolean(pageToken),
    sampleSize: highlights.length,
  };
}

/** Posts (v4). Tells the AM whether anyone has actually been posting to the profile. */
async function fetchGbpPosts(accessToken: string, locationPath: string, periodStart: Date, periodEnd: Date) {
  const url = new URL(`https://mybusiness.googleapis.com/v4/${locationPath}/localPosts`);
  url.searchParams.set("pageSize", "100");
  const payload = await fetchJson(url.toString(), { headers: getBearerHeaders(accessToken) });
  const posts = Array.isArray(payload.localPosts) ? (payload.localPosts as JsonRecord[]) : [];
  const published = posts
    .filter((post) => String(post.state || "") !== "REJECTED")
    .map((post) => ({ createdAt: String(post.createTime || ""), summary: String(post.summary || "") }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return {
    countInPeriod: published.filter((post) => isWithinWindow(post.createdAt, periodStart, periodEnd)).length,
    lastPostAt: published[0]?.createdAt || null,
    lastPostSummary: published[0]?.summary ? truncateForSnapshot(published[0].summary) : "",
  };
}

/** Photos (v4). Fresh photos are a standing client ask, so recency matters more than the total. */
async function fetchGbpPhotos(accessToken: string, locationPath: string, periodStart: Date, periodEnd: Date) {
  const url = new URL(`https://mybusiness.googleapis.com/v4/${locationPath}/media`);
  url.searchParams.set("pageSize", "100");
  const payload = await fetchJson(url.toString(), { headers: getBearerHeaders(accessToken) });
  const items = Array.isArray(payload.mediaItems) ? (payload.mediaItems as JsonRecord[]) : [];
  const dates = items
    .map((item) => String(item.createTime || ""))
    .filter(Boolean)
    .sort((left, right) => right.localeCompare(left));

  return {
    totalCount: typeof payload.totalMediaItemCount === "number" ? payload.totalMediaItemCount : items.length,
    newInPeriod: dates.filter((date) => isWithinWindow(date, periodStart, periodEnd)).length,
    lastPhotoAt: dates[0] || null,
  };
}

// Listing Q&A used to be read here, from mybusinessqanda.googleapis.com. Google discontinued that
// API on 3 November 2025 with no replacement, so there is no way to read a listing's questions any
// more and nothing to re-enable in the console: the service is gone, not switched off. Please do
// not add it back -- it answers every request with an error, which cost this sync a failed call per
// location and put "Questions and answers could not be read" on every listing for a year.
// https://developers.google.com/my-business/content/sunset-dates

/**
 * The search terms people actually typed before this profile showed up. Google publishes these
 * monthly and never for the current month, so this reads the last complete calendar month.
 */
async function fetchGbpSearchKeywords(accessToken: string, locationId: string) {
  const month = new Date();
  month.setUTCDate(1);
  month.setUTCMonth(month.getUTCMonth() - 1);
  const year = month.getUTCFullYear();
  const monthNumber = month.getUTCMonth() + 1;

  const url = new URL(
    `https://businessprofileperformance.googleapis.com/v1/locations/${locationId}/searchkeywords/impressions/monthly`,
  );
  url.searchParams.set("monthlyRange.start_month.year", String(year));
  url.searchParams.set("monthlyRange.start_month.month", String(monthNumber));
  url.searchParams.set("monthlyRange.end_month.year", String(year));
  url.searchParams.set("monthlyRange.end_month.month", String(monthNumber));

  const payload = await fetchJson(url.toString(), { headers: getBearerHeaders(accessToken) });
  const rows = Array.isArray(payload.searchKeywordsCounts) ? (payload.searchKeywordsCounts as JsonRecord[]) : [];

  return rows
    .map((row) => {
      const insights = (row.insightsValue || {}) as JsonRecord;
      // Low-volume terms come back as a threshold ("fewer than N") instead of an exact count.
      const exact = insights.value;
      const threshold = insights.threshold;
      return {
        term: String(row.searchKeyword || ""),
        impressions: Number(exact ?? threshold) || null,
        isThreshold: exact === undefined || exact === null,
      };
    })
    .filter((row) => row.term)
    .sort((left, right) => (right.impressions ?? 0) - (left.impressions ?? 0))
    .slice(0, 10);
}

/**
 * Listing completeness, derived from the location record itself -- no extra API call. These are the
 * fields Map Ranking asks clients to fill in, so `missing` doubles as the client ask list.
 */
function buildGbpCompleteness(location: JsonRecord) {
  const categories = (location.categories || {}) as JsonRecord;
  const phoneNumbers = (location.phoneNumbers || {}) as JsonRecord;
  const regularHours = (location.regularHours || {}) as JsonRecord;
  const profile = (location.profile || {}) as JsonRecord;
  const openInfo = (location.openInfo || {}) as JsonRecord;
  const serviceArea = (location.serviceArea || {}) as JsonRecord;
  const primaryCategory = (categories.primaryCategory || {}) as JsonRecord;
  const additionalCategories = Array.isArray(categories.additionalCategories)
    ? (categories.additionalCategories as JsonRecord[])
    : [];
  const serviceItems = Array.isArray(location.serviceItems) ? (location.serviceItems as JsonRecord[]) : [];
  const primaryCategoryName = String(primaryCategory.displayName || primaryCategory.name || "").trim();

  const checks: Array<{ label: string; filled: boolean }> = [
    { label: "Website link", filled: Boolean(String(location.websiteUri || "").trim()) },
    { label: "Primary phone number", filled: Boolean(String(phoneNumbers.primaryPhone || "").trim()) },
    { label: "Primary category", filled: Boolean(primaryCategoryName) },
    { label: "Additional categories", filled: additionalCategories.length > 0 },
    { label: "Business hours", filled: Array.isArray(regularHours.periods) && regularHours.periods.length > 0 },
    { label: "Business description", filled: Boolean(String(profile.description || "").trim()) },
    {
      label: "Address or service area",
      filled: Boolean(location.storefrontAddress) || Boolean(serviceArea.businessType || serviceArea.places),
    },
    { label: "Services list", filled: serviceItems.length > 0 },
  ];

  const filled = checks.filter((check) => check.filled).length;

  return {
    percent: Math.round((filled / checks.length) * 100),
    missing: checks.filter((check) => !check.filled).map((check) => check.label),
    primaryCategory: primaryCategoryName,
    additionalCategoryCount: additionalCategories.length,
    serviceItemCount: serviceItems.length,
    openState: String(openInfo.status || ""),
  };
}

/**
 * Pulls everything about one listing that is not a raw performance counter. Each API is fetched
 * independently and a failure becomes a note rather than an exception: the Business Profile APIs are
 * approved and quota'd separately, so losing reviews must not also cost us posts or photos.
 */
async function fetchGbpProfileInsights(accessToken: string, location: JsonRecord): Promise<GbpProfileInsight> {
  const locationId = String(location.name || "").split("/").filter(Boolean).pop() || "";
  const accountResourceName = String(location.accountResourceName || "");
  const locationPath = accountResourceName && locationId ? `${accountResourceName}/locations/${locationId}` : "";
  const { periodStart, periodEnd } = getGbpReportingWindow();

  const insight: GbpProfileInsight = {
    locationId,
    locationName: String(location.title || ""),
    periodStart: formatIsoDate(periodStart),
    periodEnd: formatIsoDate(periodEnd),
    reviews: null,
    posts: null,
    photos: null,
    searchKeywords: [],
    completeness: buildGbpCompleteness(location),
    notes: [],
  };

  const describe = (error: unknown) => (error instanceof Error ? error.message : "unknown error");

  if (!locationId) {
    insight.notes.push("This location has no resource id, so no listing data could be read for it.");
    return insight;
  }

  if (!locationPath) {
    insight.notes.push(
      "Reviews, posts, and photos need the owning Business Profile account id, which this location is missing -- re-run the sync to repopulate it.",
    );
  }

  // These hit four independent Google APIs, so they run together: a location would otherwise cost
  // four round trips, and a tenant with dozens of locations would blow the sync route's budget.
  // allSettled keeps the per-API isolation -- one rejected API only costs us that one block.
  const [reviewResult, postResult, photoResult, keywordResult] = await Promise.allSettled([
    locationPath ? fetchGbpReviews(accessToken, locationPath, periodStart, periodEnd) : Promise.resolve(null),
    locationPath ? fetchGbpPosts(accessToken, locationPath, periodStart, periodEnd) : Promise.resolve(null),
    locationPath ? fetchGbpPhotos(accessToken, locationPath, periodStart, periodEnd) : Promise.resolve(null),
    fetchGbpSearchKeywords(accessToken, locationId),
  ]);

  if (reviewResult.status === "fulfilled") {
    if (reviewResult.value) {
      insight.reviews = reviewResult.value.reviews;
      if (reviewResult.value.capped) {
        insight.notes.push(
          `Only the ${reviewResult.value.sampleSize} most recent reviews were read, so the reply rate and unanswered count cover that sample rather than the full history.`,
        );
      }
    }
  } else {
    insight.notes.push(`Reviews could not be read: ${describe(reviewResult.reason)}`);
  }

  if (postResult.status === "fulfilled") {
    insight.posts = postResult.value;
  } else {
    insight.notes.push(`Profile posts could not be read: ${describe(postResult.reason)}`);
  }

  if (photoResult.status === "fulfilled") {
    insight.photos = photoResult.value;
  } else {
    insight.notes.push(`Photos could not be read: ${describe(photoResult.reason)}`);
  }

  if (keywordResult.status === "fulfilled") {
    insight.searchKeywords = keywordResult.value;
  } else {
    insight.notes.push(`Search keywords could not be read: ${describe(keywordResult.reason)}`);
  }

  return insight;
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

/**
 * Local Services Ads reporting lives on its own API, not in the Google Ads API, and is queried at
 * the manager (MCC) level: one call returns every LSA account linked under the manager. That is why
 * this works for clients who run LSA without a Google Ads campaign account of their own -- the LSA
 * account only has to be linked to the agency manager account. Unlike the Google Ads API it needs
 * no developer token, and it uses the same `adwords` OAuth scope the Google Ads provider requests.
 */
const LSA_API_BASE = "https://localservices.googleapis.com/v1";
const LSA_LEAD_PAGE_SIZE = 200;
/** Detailed lead reports are per-lead, so a busy manager account can page for a long time. */
const LSA_MAX_LEAD_PAGES = 10;
const LSA_MAX_LEAD_CATEGORIES = 5;

function buildLsaSearchUrl(
  path: string,
  managerCustomerId: string,
  periodStart: Date,
  periodEnd: Date,
  pageSize: number,
  pageToken?: string,
) {
  const url = new URL(`${LSA_API_BASE}/${path}:search`);
  url.searchParams.set("query", `manager_customer_id:${managerCustomerId}`);
  const startParts = toGoogleDateParts(periodStart);
  const endParts = toGoogleDateParts(periodEnd);
  url.searchParams.set("startDate.year", String(startParts.year));
  url.searchParams.set("startDate.month", String(startParts.month));
  url.searchParams.set("startDate.day", String(startParts.day));
  url.searchParams.set("endDate.year", String(endParts.year));
  url.searchParams.set("endDate.month", String(endParts.month));
  url.searchParams.set("endDate.day", String(endParts.day));
  url.searchParams.set("pageSize", String(pageSize));
  if (pageToken) {
    url.searchParams.set("pageToken", pageToken);
  }
  return url.toString();
}

async function fetchLsaAccountReports(
  accessToken: string,
  managerCustomerId: string,
  periodStart: Date,
  periodEnd: Date,
) {
  const reports: JsonRecord[] = [];
  let pageToken: string | undefined;

  do {
    const payload = (await fetchJson(
      buildLsaSearchUrl("accountReports", managerCustomerId, periodStart, periodEnd, 100, pageToken),
      { headers: getBearerHeaders(accessToken) },
    )) as JsonRecord;
    const page = Array.isArray(payload.accountReports) ? (payload.accountReports as JsonRecord[]) : [];
    reports.push(...page);
    pageToken = payload.nextPageToken ? String(payload.nextPageToken) : undefined;
  } while (pageToken && reports.length < 500);

  return reports;
}

/**
 * Detailed lead reports carry consumer PII (phone numbers, names, emails on the phone/message/booking
 * sub-records). Nothing downstream needs an individual consumer, so leads are aggregated per account
 * here and the PII is dropped before anything is written to the snapshot.
 */
async function fetchLsaLeadMixByAccount(
  accessToken: string,
  managerCustomerId: string,
  periodStart: Date,
  periodEnd: Date,
) {
  const byAccount = new Map<
    string,
    {
      total: number;
      charged: number;
      notCharged: number;
      phoneCalls: number;
      messages: number;
      bookings: number;
      disputed: number;
      categories: Map<string, number>;
    }
  >();

  let pageToken: string | undefined;
  let pages = 0;
  let capped = false;

  do {
    const payload = (await fetchJson(
      buildLsaSearchUrl(
        "detailedLeadReports",
        managerCustomerId,
        periodStart,
        periodEnd,
        LSA_LEAD_PAGE_SIZE,
        pageToken,
      ),
      { headers: getBearerHeaders(accessToken) },
    )) as JsonRecord;

    const page = Array.isArray(payload.detailedLeadReports)
      ? (payload.detailedLeadReports as JsonRecord[])
      : [];

    for (const lead of page) {
      const accountId = String(lead.accountId || "");
      if (!accountId) {
        continue;
      }
      const bucket =
        byAccount.get(accountId) ||
        {
          total: 0,
          charged: 0,
          notCharged: 0,
          phoneCalls: 0,
          messages: 0,
          bookings: 0,
          disputed: 0,
          categories: new Map<string, number>(),
        };

      bucket.total += 1;
      if (String(lead.chargeStatus || "") === "CHARGED") {
        bucket.charged += 1;
      } else if (String(lead.chargeStatus || "") === "NOT_CHARGED") {
        bucket.notCharged += 1;
      }

      switch (String(lead.leadType || "")) {
        case "PHONE_CALL":
          bucket.phoneCalls += 1;
          break;
        case "MESSAGE":
          bucket.messages += 1;
          break;
        case "BOOKING":
          bucket.bookings += 1;
          break;
        default:
          break;
      }

      // Google documents disputeStatus as a free-text string rather than an enum, so treat anything
      // other than an explicit "no dispute" value as a dispute having been raised.
      const disputeStatus = String(lead.disputeStatus || "").toUpperCase();
      if (disputeStatus && !disputeStatus.includes("NO_DISPUTE") && disputeStatus !== "DISPUTE_STATUS_UNSPECIFIED") {
        bucket.disputed += 1;
      }

      const category = String(lead.leadCategory || "").trim();
      if (category) {
        bucket.categories.set(category, (bucket.categories.get(category) || 0) + 1);
      }

      byAccount.set(accountId, bucket);
    }

    pageToken = payload.nextPageToken ? String(payload.nextPageToken) : undefined;
    pages += 1;
    if (pageToken && pages >= LSA_MAX_LEAD_PAGES) {
      capped = true;
      break;
    }
  } while (pageToken);

  const result = new Map<string, LsaPerformanceDetail["leadMix"]>();
  for (const [accountId, bucket] of byAccount) {
    result.set(accountId, {
      total: bucket.total,
      charged: bucket.charged,
      notCharged: bucket.notCharged,
      phoneCalls: bucket.phoneCalls,
      messages: bucket.messages,
      bookings: bucket.bookings,
      disputed: bucket.disputed,
      capped,
      topCategories: [...bucket.categories.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, LSA_MAX_LEAD_CATEGORIES)
        .map(([category, count]) => ({ category, count })),
    });
  }

  return { leadMixByAccount: result, capped };
}

function toLsaNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundLsaMoney(value: number | null) {
  return value === null ? null : Math.round(value * 100) / 100;
}

async function syncGoogleLsa(context: TenantContext, record: IntegrationConnectionRecord, origin?: string) {
  const refreshedRecord = await maybeRefreshConnection(context, record, origin);
  const credentials = getIntegrationCredentials(refreshedRecord);
  const accessToken = credentials.accessToken;
  const managerCustomerId = normalizeGoogleAdsCustomerId(
    credentials.managerCustomerId ||
      refreshedRecord.externalAccountId ||
      process.env.GOOGLE_ADS_MCC_ID ||
      "",
  );

  if (!accessToken) {
    throw new Error("Google LSA access token is missing");
  }
  if (!managerCustomerId) {
    throw new Error(
      "Google LSA manager (MCC) customer ID is missing -- Local Services reporting is only queryable at the manager level",
    );
  }

  const { periodStart, periodEnd } = getGbpReportingWindow();
  const accountReports = await fetchLsaAccountReports(
    accessToken,
    managerCustomerId,
    periodStart,
    periodEnd,
  );

  const accounts = accountReports
    .map((report) => ({
      accountId: String(report.accountId || ""),
      businessName: String(report.businessName || "Unnamed LSA account"),
      currencyCode: String(report.currencyCode || ""),
      report,
    }))
    .filter((account) => account.accountId);

  // One manager-level call covers every linked account, so the lead mix is fetched once and bucketed
  // rather than re-queried per client. A failure here still leaves the account-level totals usable.
  let leadMixByAccount = new Map<string, LsaPerformanceDetail["leadMix"]>();
  let leadMixNote = "";
  if (accounts.length) {
    try {
      const leadMix = await fetchLsaLeadMixByAccount(
        accessToken,
        managerCustomerId,
        periodStart,
        periodEnd,
      );
      leadMixByAccount = leadMix.leadMixByAccount;
    } catch (error) {
      leadMixNote =
        error instanceof Error
          ? `Lead-level detail unavailable: ${error.message}`
          : "Lead-level detail unavailable";
    }
  }

  const clients = await listFirestoreClients(context.tenantId);
  const lsaByClient: Record<string, JsonRecord> = {};
  let matchedCount = 0;

  for (const client of clients) {
    const manualIds = new Set(client.integrationMappings?.googleLsa || []);
    const match = accounts.find(
      (account) => namesLikelyMatch(client.name, account.businessName) || manualIds.has(account.accountId),
    );
    if (!match) {
      continue;
    }

    matchedCount += 1;
    const report = match.report;
    const spend = roundLsaMoney(toLsaNumber(report.currentPeriodTotalCost));
    const chargedLeads = toLsaNumber(report.currentPeriodChargedLeads);
    const leadMix = leadMixByAccount.get(match.accountId) ?? null;
    const notes: string[] = [];
    if (leadMixNote) {
      notes.push(leadMixNote);
    }
    if (leadMix?.capped) {
      notes.push(
        `Lead-level mix is a sample of the most recent ${LSA_MAX_LEAD_PAGES * LSA_LEAD_PAGE_SIZE} leads across the manager account, not the full period.`,
      );
    }

    lsaByClient[client.id] = {
      accountId: match.accountId,
      businessName: match.businessName,
      currencyCode: match.currencyCode,
      spend,
      previousSpend: roundLsaMoney(toLsaNumber(report.previousPeriodTotalCost)),
      chargedLeads,
      previousChargedLeads: toLsaNumber(report.previousPeriodChargedLeads),
      phoneCalls: toLsaNumber(report.currentPeriodPhoneCalls),
      previousPhoneCalls: toLsaNumber(report.previousPeriodPhoneCalls),
      connectedPhoneCalls: toLsaNumber(report.currentPeriodConnectedPhoneCalls),
      previousConnectedPhoneCalls: toLsaNumber(report.previousPeriodConnectedPhoneCalls),
      phoneLeadResponsiveness: toLsaNumber(report.phoneLeadResponsiveness),
      averageWeeklyBudget: roundLsaMoney(toLsaNumber(report.averageWeeklyBudget)),
      averageFiveStarRating: toLsaNumber(report.averageFiveStarRating),
      totalReviews: toLsaNumber(report.totalReview),
      costPerChargedLead:
        spend !== null && chargedLeads ? Math.round((spend / chargedLeads) * 100) / 100 : null,
      leadMix,
      notes,
    };
  }

  const counts = createEmptyCounts();
  counts.fetched = accounts.length;
  counts.created = Object.keys(lsaByClient).length;

  const summary = accounts.length
    ? `${formatSummaryCount("LSA account", accounts.length)} listed under manager ${managerCustomerId}, ${formatSummaryCount("account", matchedCount)} matched to MTOS clients${leadMixNote ? " (account totals only -- lead detail unavailable)" : ""}`
    : `No Local Services accounts are linked under manager ${managerCustomerId}`;

  return {
    summary,
    counts,
    snapshotPayload: {
      managerCustomerId,
      window: {
        start: periodStart.toISOString().slice(0, 10),
        end: periodEnd.toISOString().slice(0, 10),
      },
      // Slim index for the client-mapping picker; the full report stays out of the snapshot.
      accountIndex: accounts.map((account) => ({
        accountId: account.accountId,
        businessName: account.businessName,
        currencyCode: account.currencyCode,
      })),
      lsaByClient,
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
  /** Full normalized lead records for the recent window, for lead verification. */
  leads: JsonRecord[];
  /** Human-readable note on how the lead pull went, surfaced for diagnostics. */
  leadsDiagnostic?: string;
  errorMessage?: string;
}

const emptyGhlLeadCounts = (errorMessage?: string): GhlLeadCounts => ({
  newLeads30d: null,
  totalContacts: null,
  pipelineOpportunities: null,
  bookedJobsWon: null,
  sampleContacts: [],
  leads: [],
  errorMessage,
});

/**
 * The lead/call pull window start: the 1st of the PREVIOUS calendar month (UTC).
 * So on Aug 2 it starts Jul 1 and on Jul 30 it starts Jun 1 -- always covering the
 * whole previous month plus the current month-to-date (the owner reviews a full
 * month even when a few days over 30). Overridable to a rolling window via env.
 */
export function getGhlPullWindowStartIso(): string {
  const days = Number(process.env.GHL_LEAD_WINDOW_DAYS || "");
  if (Number.isFinite(days) && days > 0) {
    return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  }
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0)).toISOString();
}
/** Default (shared-snapshot) cap -- kept small so the shared snapshot doc stays under Firestore's 1MB limit. */
const GHL_LEAD_PULL_CAP = 100;
const GHL_CALL_CAP = 100;
const GHL_CALL_CONVO_SCAN = 60;
/** Full per-client caps used by the direct verify-time fetch (stored per client, so larger is safe). */
const GHL_LEAD_FULL_CAP = 500;
const GHL_CALL_FULL_CAP = 200;
const GHL_CALL_CONVO_FULL_SCAN = 80;
/** How many conversation-message requests run in parallel (keeps the pull fast, under GHL rate limits). */
const GHL_MESSAGE_FETCH_CONCURRENCY = 8;
/** Hard page-loop guard for paginated pulls. */
const GHL_MAX_PAGES = 20;

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * Normalize a raw GoHighLevel contact into the compact lead shape the
 * verification engine consumes. Captures identity, the raw source, and the
 * attribution block (utm/session) so the engine can resolve a channel without
 * re-fetching. Channel/type resolution is intentionally left to the engine.
 */
function mapGhlContact(contact: JsonRecord): JsonRecord {
  const attribution = (contact.attributionSource || {}) as JsonRecord;
  const lastAttribution = (contact.lastAttributionSource || {}) as JsonRecord;
  const name =
    firstString(contact.contactName, contact.name) ||
    [contact.firstName, contact.lastName].filter((part) => typeof part === "string" && part).join(" ").trim() ||
    undefined;
  const tags = Array.isArray(contact.tags)
    ? (contact.tags as unknown[]).filter((tag): tag is string => typeof tag === "string")
    : undefined;

  return {
    id: firstString(contact.id, contact._id) || "",
    name,
    email: firstString(contact.email),
    phone: firstString(contact.phone),
    source: firstString(contact.source, attribution.sessionSource, attribution.utmSource, lastAttribution.utmSource),
    dateAdded: firstString(contact.dateAdded, contact.createdAt),
    tags,
    attribution: {
      source: firstString(attribution.utmSource, attribution.sessionSource, lastAttribution.utmSource),
      medium: firstString(attribution.medium, attribution.utmMedium, lastAttribution.medium),
      campaign: firstString(attribution.campaign, attribution.utmCampaign, lastAttribution.utmCampaign),
      referrer: firstString(attribution.referrer, attribution.url, lastAttribution.referrer),
    },
  };
}

/**
 * Pull the recent lead list (up to the cap) for a location, newest first, so the
 * verification engine has individual records rather than just counts. Best-effort:
 * a failure here returns an empty list and never blocks the count pull.
 */
async function fetchGhlRecentLeads(
  headers: Record<string, string>,
  locationId: string,
  sinceIso: string,
  maxResults: number = GHL_LEAD_PULL_CAP,
): Promise<{ leads: JsonRecord[]; diagnostic: string }> {
  const notes: string[] = [];

  // Preferred: the advanced search, filtered to the recent window, PAGINATED so a
  // busy client's older leads aren't dropped by a single 100-row page. No `sort` --
  // some locations reject the sort body and 400 the whole request. The seen-id
  // guard makes this safe even if `page` is ignored (we stop when no new rows).
  try {
    const collected: JsonRecord[] = [];
    const seen = new Set<string>();
    let total: number | undefined;
    for (let page = 1; page <= GHL_MAX_PAGES && collected.length < maxResults; page += 1) {
      const payload = await fetchJson("https://services.leadconnectorhq.com/contacts/search", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          locationId,
          page,
          pageLimit: 100,
          filters: [{ field: "dateAdded", operator: "range", value: { gte: sinceIso } }],
        }),
      });
      if (typeof payload.total === "number") {
        total = payload.total;
      }
      const contacts = Array.isArray(payload.contacts) ? (payload.contacts as JsonRecord[]) : [];
      const fresh = contacts.filter((contact) => {
        const id = firstString(contact.id, contact._id) || "";
        if (!id || seen.has(id)) {
          return false;
        }
        seen.add(id);
        return true;
      });
      collected.push(...fresh);
      // Last page, or pagination isn't advancing.
      if (contacts.length < 100 || fresh.length === 0) {
        break;
      }
      if (total !== undefined && collected.length >= total) {
        break;
      }
    }
    if (collected.length) {
      notes.push(`search returned ${collected.length}${total !== undefined ? ` of ${total}` : ""}`);
      return { leads: collected.slice(0, maxResults).map(mapGhlContact), diagnostic: notes.join("; ") };
    }
    notes.push("search returned 0");
  } catch (error) {
    notes.push(`search error: ${error instanceof Error ? error.message : "unknown"}`);
  }

  // Fallback: the plain contacts list -- the same call that already powers the
  // sample/count pull, so it's known to work where search may not.
  try {
    const encodedLocation = encodeURIComponent(locationId);
    const payload = await fetchJson(
      `https://services.leadconnectorhq.com/contacts/?locationId=${encodedLocation}&limit=100`,
      { headers },
    );
    const contacts = Array.isArray(payload.contacts) ? (payload.contacts as JsonRecord[]) : [];
    notes.push(`list returned ${contacts.length}`);
    return { leads: contacts.slice(0, maxResults).map(mapGhlContact), diagnostic: notes.join("; ") };
  } catch (error) {
    notes.push(`list error: ${error instanceof Error ? error.message : "unknown"}`);
    return { leads: [], diagnostic: notes.join("; ") };
  }
}

/** Epoch-ms for a GHL date field, which may be a number (ms) or an ISO string. */
function ghlDateMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function isGhlCallMessage(message: JsonRecord): boolean {
  const marker = `${message.type ?? ""} ${message.messageType ?? ""}`.toLowerCase();
  if (marker.includes("call")) {
    return true;
  }
  // Some payloads only carry the call details under meta.call, not a "call" type string.
  const meta = (message.meta || {}) as JsonRecord;
  return Boolean(meta.call);
}

/** Pull the messages array out of the several shapes GHL returns it in. */
function extractGhlMessages(payload: JsonRecord): JsonRecord[] {
  const messages = payload.messages;
  if (Array.isArray(messages)) {
    return messages as JsonRecord[];
  }
  if (messages && typeof messages === "object" && Array.isArray((messages as JsonRecord).messages)) {
    return (messages as JsonRecord).messages as JsonRecord[];
  }
  return [];
}

/** Normalize a GHL call message into a lead-shaped record (type "call"). */
function mapGhlCall(message: JsonRecord, conversation: JsonRecord): JsonRecord {
  const meta = (message.meta || {}) as JsonRecord;
  const call = (meta.call || {}) as JsonRecord;
  const messageId = firstString(message.id, message._id, message.messageId, message.altId, call.messageId) || "";
  const direction = firstString(message.direction, call.direction);
  const status = firstString(call.status, message.status);
  const durationRaw = call.duration ?? call.callDuration ?? message.duration;
  const durationSec = typeof durationRaw === "number" ? durationRaw : Number(durationRaw) || 0;

  return {
    id: `call-${messageId}`,
    name: firstString(conversation.fullName, conversation.contactName, conversation.name),
    phone: firstString(conversation.phone, message.from, call.from, message.to),
    dateAdded: firstString(message.dateAdded, message.dateUpdated) || new Date(ghlDateMs(message.dateAdded)).toISOString(),
    source: "call",
    type: "call",
    attribution: { medium: "call", source: direction },
    call: {
      direction,
      durationSec,
      status,
      messageId,
      conversationId: firstString(conversation.id, message.conversationId),
      contactId: firstString(conversation.contactId, message.contactId),
    },
  };
}

/**
 * Pull recent phone calls for a location from the Conversations API. Best-effort:
 * conversations are sorted newest-first, so we stop once they fall outside the
 * window; any failure returns an empty list with a diagnostic note. Recordings
 * are fetched on demand elsewhere -- this only captures call metadata.
 */
async function fetchGhlRecentCalls(
  headers: Record<string, string>,
  locationId: string,
  sinceIso: string,
  maxCalls: number = GHL_CALL_CAP,
  maxConversations: number = GHL_CALL_CONVO_SCAN,
): Promise<{ calls: JsonRecord[]; diagnostic: string }> {
  const notes: string[] = [];
  const sinceMs = Date.parse(sinceIso);
  const encodedLocation = encodeURIComponent(locationId);
  const calls: JsonRecord[] = [];

  try {
    // 1. Collect in-window conversations (newest-first, cheap). Stop once they
    //    fall outside the window or the cap is hit. The seen-id guard keeps this
    //    safe even if the API ignores `page`.
    const conversations: JsonRecord[] = [];
    const seenConvos = new Set<string>();
    for (let page = 1; page <= GHL_MAX_PAGES && conversations.length < maxConversations; page += 1) {
      const convoPayload = await fetchJson(
        `https://services.leadconnectorhq.com/conversations/search?locationId=${encodedLocation}&limit=100&page=${page}&sortBy=last_message_date&sort=desc`,
        { headers },
      );
      const list = Array.isArray(convoPayload.conversations) ? (convoPayload.conversations as JsonRecord[]) : [];
      if (!list.length) {
        break;
      }
      let progressed = false;
      let reachedWindowEnd = false;
      for (const conversation of list) {
        const convoId = firstString(conversation.id);
        if (!convoId || seenConvos.has(convoId)) {
          continue;
        }
        seenConvos.add(convoId);
        progressed = true;
        const lastMs = ghlDateMs(conversation.lastMessageDate);
        if (lastMs && lastMs < sinceMs) {
          reachedWindowEnd = true;
          break;
        }
        conversations.push(conversation);
        if (conversations.length >= maxConversations) {
          break;
        }
      }
      if (reachedWindowEnd || list.length < 100 || !progressed) {
        break;
      }
    }

    // 2. Fetch each conversation's messages in PARALLEL batches (the slow part) and
    //    extract call messages. Sequential per-conversation fetches were timing out.
    for (let i = 0; i < conversations.length && calls.length < maxCalls; i += GHL_MESSAGE_FETCH_CONCURRENCY) {
      const batch = conversations.slice(i, i + GHL_MESSAGE_FETCH_CONCURRENCY);
      const fetched = await Promise.all(
        batch.map(async (conversation) => {
          const convoId = firstString(conversation.id) || "";
          const messagesPayload = await fetchJson(
            `https://services.leadconnectorhq.com/conversations/${encodeURIComponent(convoId)}/messages?limit=100`,
            { headers },
          ).catch(() => ({}) as JsonRecord);
          return { conversation, messages: extractGhlMessages(messagesPayload) };
        }),
      );

      for (const { conversation, messages } of fetched) {
        for (const message of messages) {
          if (!isGhlCallMessage(message)) {
            continue;
          }
          const dateMs = ghlDateMs(message.dateAdded);
          if (dateMs && dateMs < sinceMs) {
            continue;
          }
          calls.push(mapGhlCall(message, conversation));
          if (calls.length >= maxCalls) {
            break;
          }
        }
        if (calls.length >= maxCalls) {
          break;
        }
      }
    }

    notes.push(`calls: ${calls.length} found`);
    return { calls, diagnostic: notes.join("; ") };
  } catch (error) {
    notes.push(`calls error: ${error instanceof Error ? error.message : "unknown"}`);
    return { calls, diagnostic: notes.join("; ") };
  }
}

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

/**
 * Resolve a location-scoped GoHighLevel token for on-demand, location-scoped
 * reads (e.g. streaming a call recording). Mints a fresh location token from the
 * connected agency credential (or the env agency key), falling back to the
 * agency key directly. Returns null when GoHighLevel isn't connected.
 */
export async function getGhlLocationToken(context: TenantContext, locationId: string): Promise<string | null> {
  const record = await getIntegrationConnection(context, "gohighlevel");
  const connectionKey =
    record && record.status === "connected" ? getIntegrationCredentials(record).accessToken : undefined;
  const agencyKey = connectionKey || getServerEnv().gohighlevelAgencyApiKey || undefined;
  if (!agencyKey) {
    return null;
  }

  const jwtCompanyId = decodeJwtPayload(agencyKey).companyId;
  const companyId =
    (record?.externalAccountId ? String(record.externalAccountId) : undefined) ||
    (typeof jwtCompanyId === "string" ? jwtCompanyId : undefined);

  const minted = await mintGhlLocationToken(agencyKey, { id: locationId, name: "", companyId });
  return minted || agencyKey;
}

/**
 * Full, paginated per-client pull of leads + calls for the last 30 days, direct
 * from GoHighLevel (mints a location token). Used by lead verification so a busy
 * client's full window is loaded WITHOUT bloating the shared integration snapshot
 * (which holds every client and is bounded by Firestore's 1MB doc limit). Returns
 * null when GoHighLevel isn't connected / no token can be minted.
 */
export async function fetchGhlClientLeadsAndCalls(
  context: TenantContext,
  locationId: string,
  sinceIso: string,
): Promise<{ leads: JsonRecord[]; diagnostic: string } | null> {
  const token = await getGhlLocationToken(context, locationId);
  if (!token) {
    return null;
  }
  const headers = { ...getBearerHeaders(token), Version: "2021-07-28" };
  const [leadResult, callResult] = await Promise.all([
    fetchGhlRecentLeads(headers, locationId, sinceIso, GHL_LEAD_FULL_CAP),
    fetchGhlRecentCalls(headers, locationId, sinceIso, GHL_CALL_FULL_CAP, GHL_CALL_CONVO_FULL_SCAN),
  ]);
  return {
    leads: [...callResult.calls, ...leadResult.leads].slice(0, GHL_LEAD_FULL_CAP + GHL_CALL_FULL_CAP),
    diagnostic: [leadResult.diagnostic, callResult.diagnostic].filter(Boolean).join(" | "),
  };
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

  // The shared agency sync runs for every matched client, so keep it LIGHT: just a
  // small recent-leads sample for the scorecard. The full leads + calls pull (which
  // is heavy) happens per-client on demand via fetchGhlClientLeadsAndCalls.
  const windowStart = getGhlPullWindowStartIso();
  const { leads, diagnostic } = await fetchGhlRecentLeads(headers, locationId, windowStart, GHL_LEAD_PULL_CAP);

  return {
    newLeads30d,
    totalContacts,
    pipelineOpportunities: readGhlMetaTotal(opportunitiesPayload),
    bookedJobsWon: readGhlMetaTotal(wonPayload),
    sampleContacts,
    leads: leads.slice(0, GHL_LEAD_PULL_CAP),
    leadsDiagnostic: diagnostic,
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
      leads: contacts.slice(0, GHL_LEAD_PULL_CAP).map(mapGhlContact),
      leadsDiagnostic: `v1 list returned ${contacts.length}`,
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
      // Full normalized lead records for the recent window, consumed by the
      // lead & call verification engine. Additive -- counts above are unchanged.
      leads: counts.leads,
      leadsDiagnostic: counts.leadsDiagnostic,
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
    case "google-lsa":
      return syncGoogleLsa(context, record, origin);
    default:
      throw new Error(`${getIntegrationDefinition(providerId).name} sync is not implemented in this slice`);
  }
}

/**
 * GETs a Google API without throwing on a non-2xx, so a test can inspect the exact status and error
 * body rather than losing them to an exception. Returns the response alongside the parsed JSON.
 */
async function fetchWithStatus(url: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: { ...getBearerHeaders(accessToken), ...(init?.headers as Record<string, string> | undefined) },
  });
  const raw = await response.text();
  let payload: JsonRecord = {};
  if (raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        payload = parsed as JsonRecord;
      }
    } catch {
      // Deliberately swallowed: the synthesized error below carries the unparsed body instead.
    }
  }
  if (!response.ok && !extractGoogleError(payload, response.status).messageFromGoogle) {
    // An error Google answers with no usable JSON leaves the caller holding a bare status code,
    // which is how "Request failed with status 404" came to be the whole of what the Q&A probe
    // could say. Carry the body, or the absence of one, instead of discarding it.
    payload = { error: { message: describeBodylessGoogleError(response.status, raw) } };
  }
  return { response, payload };
}

/**
 * What to say when Google answers an error without the usual `{ error: { message } }`. The 404 note
 * is deliberately two-sided: a bodyless 404 from a Business Profile API does not on its own
 * distinguish a project that lacks the API from a location that API will not serve.
 */
export function describeBodylessGoogleError(httpStatus: number, raw: string): string {
  const excerpt = raw.trim().replace(/\s+/g, " ").slice(0, 160);
  if (excerpt) {
    return `Google returned ${httpStatus} with a body that is not the usual JSON error: ${excerpt}`;
  }
  if (httpStatus === 404) {
    return "Google returned 404 with no explanation at all. Two causes produce that here: the API is not enabled for this Google Cloud project, or the sampled location is not one this API serves. Enabling the API in the console rules out the first.";
  }
  return `Google returned ${httpStatus} with an empty body, so it gave no reason.`;
}

/**
 * Google returns errors as `{ error: { code, message, status } }`. Pull out the human message and the
 * canonical status string so a caller can both display and classify the failure.
 */
function extractGoogleError(payload: JsonRecord, httpStatus: number) {
  const errorObject =
    payload.error && typeof payload.error === "object" ? (payload.error as JsonRecord) : null;
  const message = errorObject
    ? String(errorObject.message || "")
    : typeof payload.error === "string"
      ? payload.error
      : typeof payload.message === "string"
        ? payload.message
        : "";
  const googleStatus = errorObject ? String(errorObject.status || "") : "";
  return {
    message: message || `Request failed with status ${httpStatus}`,
    googleStatus,
    // Whether Google itself said anything, as opposed to the fallback above standing in for it.
    messageFromGoogle: Boolean(message),
  };
}

/**
 * Recognises the specific error Google returns when an API is not enabled for the project, or the
 * Business Profile API access request has not been granted: a 403 whose message says the API "has
 * not been used"/"is disabled" (or a PERMISSION_DENIED status), or a 429 that reports a zero quota
 * (the state a project sits in until it is allowlisted). This is the signal that answers "did Google
 * approve the request?" as opposed to a token/scope problem.
 */
function looksLikeApprovalBlock(httpStatus: number, message: string, googleStatus: string) {
  const normalized = message.toLowerCase();
  if (
    httpStatus === 403 &&
    (normalized.includes("has not been used") ||
      normalized.includes("is disabled") ||
      normalized.includes("has not been enabled") ||
      normalized.includes("accessnotconfigured") ||
      googleStatus === "PERMISSION_DENIED")
  ) {
    return true;
  }
  if (httpStatus === 429 && normalized.includes("quota")) {
    return true;
  }
  return false;
}

/**
 * Probes the three Google APIs the Business Profile sync depends on -- account management, business
 * information (locations), and performance metrics -- each of which Google enables/allowlists
 * independently. Reports per-API whether real data came back or the "API not enabled / not approved"
 * error, so "is our access request approved?" becomes a one-click check inside MTOS.
 */
async function testGoogleBusinessProfileConnection(
  context: TenantContext,
  record: IntegrationConnectionRecord,
  origin?: string,
): Promise<IntegrationConnectionTestCheck[]> {
  const refreshedRecord = await maybeRefreshConnection(context, record, origin);
  const accessToken = getIntegrationCredentials(refreshedRecord).accessToken;
  if (!accessToken) {
    throw new Error(
      "Google Business Profile access token is missing. Reconnect the integration, then test again.",
    );
  }

  const checks: IntegrationConnectionTestCheck[] = [];

  // 1. Account Management API -- the gate: nothing else works without it.
  const accountsHost = "mybusinessaccountmanagement.googleapis.com";
  let accountNames: string[] = [];
  let firstLocationPath = "";
  {
    const { response, payload } = await fetchWithStatus(`https://${accountsHost}/v1/accounts`, accessToken);
    if (response.ok) {
      const accounts = Array.isArray(payload.accounts) ? (payload.accounts as JsonRecord[]) : [];
      accountNames = accounts.map((account) => String(account.name || "")).filter(Boolean);
      checks.push({
        api: "Account Management API",
        endpoint: accountsHost,
        status: "ok",
        httpStatus: response.status,
        detail: `${formatSummaryCount("Business Profile account", accounts.length)} visible to this connection.`,
      });
    } else {
      const { message, googleStatus } = extractGoogleError(payload, response.status);
      checks.push({
        api: "Account Management API",
        endpoint: accountsHost,
        status: "failed",
        httpStatus: response.status,
        detail: message,
        approvalBlocked: looksLikeApprovalBlock(response.status, message, googleStatus),
      });
    }
  }

  // 2. Business Information API -- lists a client's locations. Needs an account to query under.
  const infoHost = "mybusinessbusinessinformation.googleapis.com";
  let firstLocationId = "";
  if (accountNames.length) {
    // Walk accounts until one yields a location, instead of sampling accounts[0] and giving up.
    // A connection with 15 accounts whose first happens to be empty left every later probe with
    // nothing to sample, so the APIs that actually fail in production -- reviews, posts and
    // photos -- were never exercised and the test reported green. The sync itself reads
    // locations across all accounts, so a probe that reads only the first is not representative
    // of it. Bounded so a large agency connection cannot turn the test into its own slow request.
    let response: Awaited<ReturnType<typeof fetchWithStatus>>["response"] | undefined;
    let payload: JsonRecord = {};
    let sampledTitle = "";
    let scanned = 0;

    for (const accountName of accountNames.slice(0, GBP_TEST_MAX_ACCOUNTS_SCANNED)) {
      scanned += 1;
      const url = new URL(`https://${infoHost}/v1/${accountName}/locations`);
      url.searchParams.set("pageSize", "1");
      url.searchParams.set("readMask", "name,title");
      ({ response, payload } = await fetchWithStatus(url.toString(), accessToken));
      if (!response.ok) {
        break;
      }
      const locations = Array.isArray(payload.locations) ? (payload.locations as JsonRecord[]) : [];
      if (locations.length) {
        firstLocationId = String(locations[0]?.name || "").split("/").filter(Boolean).pop() || "";
        firstLocationPath = firstLocationId ? `${accountName}/locations/${firstLocationId}` : "";
        sampledTitle = String(locations[0]?.title || "untitled");
        break;
      }
    }

    if (response && response.ok) {
      checks.push({
        api: "Business Information API",
        endpoint: infoHost,
        status: "ok",
        httpStatus: response.status,
        detail: firstLocationId
          ? `Locations are readable (sampled "${sampledTitle}").`
          : `Reachable, but no locations were found in the ${formatSummaryCount("account", scanned)} checked.`,
      });
    } else if (response) {
      const { message, googleStatus } = extractGoogleError(payload, response.status);
      checks.push({
        api: "Business Information API",
        endpoint: infoHost,
        status: "failed",
        httpStatus: response.status,
        detail: message,
        approvalBlocked: looksLikeApprovalBlock(response.status, message, googleStatus),
      });
    } else {
      // Unreachable while accountNames is non-empty, but recorded rather than dropped: a silent
      // gap here is what let the summary speak for probes that never ran.
      checks.push({
        api: "Business Information API",
        endpoint: infoHost,
        status: "skipped",
        detail: "No account could be queried for locations.",
      });
    }
  } else {
    checks.push({
      api: "Business Information API",
      endpoint: infoHost,
      status: "skipped",
      detail: "No account was returned, so there was nothing to list locations for.",
    });
  }

  // 3. Performance API -- the calls/clicks/impressions the brief reads. Needs a location to sample.
  const performanceHost = "businessprofileperformance.googleapis.com";
  if (firstLocationId) {
    const sampleDay = new Date();
    sampleDay.setUTCDate(sampleDay.getUTCDate() - 1);
    const parts = toGoogleDateParts(sampleDay);
    const url = new URL(
      `https://${performanceHost}/v1/locations/${firstLocationId}:fetchMultiDailyMetricsTimeSeries`,
    );
    url.searchParams.append("dailyMetrics", "CALL_CLICKS");
    url.searchParams.set("dailyRange.start_date.year", String(parts.year));
    url.searchParams.set("dailyRange.start_date.month", String(parts.month));
    url.searchParams.set("dailyRange.start_date.day", String(parts.day));
    url.searchParams.set("dailyRange.end_date.year", String(parts.year));
    url.searchParams.set("dailyRange.end_date.month", String(parts.month));
    url.searchParams.set("dailyRange.end_date.day", String(parts.day));
    const { response, payload } = await fetchWithStatus(url.toString(), accessToken);
    if (response.ok) {
      checks.push({
        api: "Performance API",
        endpoint: performanceHost,
        status: "ok",
        httpStatus: response.status,
        detail: "Performance metrics are readable for the sampled location.",
      });
    } else {
      const { message, googleStatus } = extractGoogleError(payload, response.status);
      checks.push({
        api: "Performance API",
        endpoint: performanceHost,
        status: "failed",
        httpStatus: response.status,
        detail: message,
        approvalBlocked: looksLikeApprovalBlock(response.status, message, googleStatus),
      });
    }
  } else {
    checks.push({
      api: "Performance API",
      endpoint: performanceHost,
      status: "skipped",
      detail: "No location was available to sample metrics for.",
    });
  }

  // 4. Legacy v4 API -- the ONLY source of reviews, posts, and photos, and approved separately
  // from the v1 APIs above. A connection can pass checks 1-3 and still fail here.
  const legacyHost = "mybusiness.googleapis.com";
  if (firstLocationPath) {
    const url = new URL(`https://${legacyHost}/v4/${firstLocationPath}/reviews`);
    url.searchParams.set("pageSize", "1");
    const { response, payload } = await fetchWithStatus(url.toString(), accessToken);
    if (response.ok) {
      const total = typeof payload.totalReviewCount === "number" ? payload.totalReviewCount : 0;
      checks.push({
        api: "My Business API (reviews, posts, photos)",
        endpoint: legacyHost,
        status: "ok",
        httpStatus: response.status,
        detail: `Reviews are readable (${formatSummaryCount("review", total)} on the sampled location).`,
      });
    } else {
      const { message, googleStatus } = extractGoogleError(payload, response.status);
      checks.push({
        api: "My Business API (reviews, posts, photos)",
        endpoint: legacyHost,
        status: "failed",
        httpStatus: response.status,
        detail: message,
        approvalBlocked: looksLikeApprovalBlock(response.status, message, googleStatus),
      });
    }
  } else {
    checks.push({
      api: "My Business API (reviews, posts, photos)",
      endpoint: legacyHost,
      status: "skipped",
      detail: "No account/location pair was available to sample reviews for.",
    });
  }

  // The Q&A API was probed here as a fifth check until Google discontinued it on 3 November 2025.
  // It answers every request with an error now, so testing it could only ever report a failure the
  // console cannot fix -- an amber line next to four green ones, for a service that no longer
  // exists. MTOS no longer reads listing Q&A at all.

  return checks;
}

/**
 * Probes the two Local Services endpoints the LSA sync depends on. Both are queried at the manager
 * (MCC) level, so the common failure is not a bad token but a client's LSA account not being linked
 * under the manager account -- which shows up here as an empty account list rather than an error.
 */
async function testGoogleLsaConnection(
  context: TenantContext,
  record: IntegrationConnectionRecord,
  origin?: string,
): Promise<IntegrationConnectionTestCheck[]> {
  const refreshedRecord = await maybeRefreshConnection(context, record, origin);
  const credentials = getIntegrationCredentials(refreshedRecord);
  const accessToken = credentials.accessToken;
  if (!accessToken) {
    throw new Error("Google LSA access token is missing. Reconnect the integration, then test again.");
  }

  const managerCustomerId = normalizeGoogleAdsCustomerId(
    credentials.managerCustomerId ||
      refreshedRecord.externalAccountId ||
      process.env.GOOGLE_ADS_MCC_ID ||
      "",
  );

  const host = "localservices.googleapis.com";
  if (!managerCustomerId) {
    return [
      {
        api: "Local Services API",
        endpoint: host,
        status: "failed",
        detail:
          "No manager (MCC) customer ID is configured. Local Services reporting can only be queried at the manager level -- set GOOGLE_ADS_MCC_ID.",
      },
    ];
  }

  const { periodStart, periodEnd } = getGbpReportingWindow();
  const checks: IntegrationConnectionTestCheck[] = [];

  // 1. Account reports -- the gate, and the check that proves the manager link is readable.
  {
    const { response, payload } = await fetchWithStatus(
      buildLsaSearchUrl("accountReports", managerCustomerId, periodStart, periodEnd, 10),
      accessToken,
    );
    if (response.ok) {
      const reports = Array.isArray(payload.accountReports) ? (payload.accountReports as JsonRecord[]) : [];
      checks.push({
        api: "Local Services account reports",
        endpoint: host,
        status: "ok",
        httpStatus: response.status,
        detail: reports.length
          ? `${formatSummaryCount("LSA account", reports.length)} linked under manager ${managerCustomerId}.`
          : `The API responded, but no LSA accounts are linked under manager ${managerCustomerId}. Link each client's Local Services account to the manager account so its data can be pulled.`,
      });
    } else {
      const { message, googleStatus } = extractGoogleError(payload, response.status);
      checks.push({
        api: "Local Services account reports",
        endpoint: host,
        status: "failed",
        httpStatus: response.status,
        detail: message,
        approvalBlocked: looksLikeApprovalBlock(response.status, message, googleStatus),
      });
    }
  }

  // 2. Detailed lead reports -- the charged/disputed lead mix. Enabled with the same API, but probed
  // separately because the sync degrades to account totals when only this call fails.
  {
    const { response, payload } = await fetchWithStatus(
      buildLsaSearchUrl("detailedLeadReports", managerCustomerId, periodStart, periodEnd, 10),
      accessToken,
    );
    if (response.ok) {
      const leads = Array.isArray(payload.detailedLeadReports)
        ? (payload.detailedLeadReports as JsonRecord[])
        : [];
      checks.push({
        api: "Local Services detailed lead reports",
        endpoint: host,
        status: "ok",
        httpStatus: response.status,
        detail: `Lead-level detail is readable (${formatSummaryCount("lead", leads.length)} in the sampled page).`,
      });
    } else {
      const { message, googleStatus } = extractGoogleError(payload, response.status);
      checks.push({
        api: "Local Services detailed lead reports",
        endpoint: host,
        status: "failed",
        httpStatus: response.status,
        detail: message,
        approvalBlocked: looksLikeApprovalBlock(response.status, message, googleStatus),
      });
    }
  }

  return checks;
}

/**
 * Runs a live, read-only connection test against a provider and summarises whether its APIs are
 * actually reachable. Implemented for the Google providers whose access depends on something outside
 * MTOS -- a Google approval/allowlisting step, or an account link under the agency manager account --
 * so the test surfaces exactly that state.
 */
export async function testIntegrationConnection(
  context: TenantContext,
  providerId: IntegrationProviderId,
  origin?: string,
): Promise<IntegrationConnectionTestResult> {
  const record = await getConnectedRecord(context, providerId);

  let checks: IntegrationConnectionTestCheck[];
  switch (providerId) {
    case "google-business-profile":
      checks = await testGoogleBusinessProfileConnection(context, record, origin);
      break;
    case "google-lsa":
      checks = await testGoogleLsaConnection(context, record, origin);
      break;
    default:
      throw new Error(
        `Connection testing is not available for ${getIntegrationDefinition(providerId).name} yet.`,
      );
  }

  const runnableChecks = checks.filter((check) => check.status !== "skipped");
  const skipped = checks.filter((check) => check.status === "skipped");
  // A skipped probe proves nothing, so it cannot count toward a pass. Treating "not run" as "fine"
  // is how this test reported "every API responded successfully" while the three APIs that were
  // actually failing in production had never been called.
  const ok = runnableChecks.length > 0 && runnableChecks.every((check) => check.status === "ok") && !skipped.length;
  const blocked = checks.find((check) => check.approvalBlocked);
  const firstFailure = checks.find((check) => check.status === "failed");

  const providerName = getIntegrationDefinition(providerId).name;
  let summary: string;
  if (ok) {
    summary = `Connected and approved — every ${providerName} API MTOS uses responded successfully, so client data can be pulled.`;
  } else if (blocked) {
    summary = `Not approved yet — the ${blocked.api} returned Google's "API not enabled / not allowlisted" response ("${blocked.detail}"). The access request has not been granted for this project.`;
  } else if (firstFailure) {
    summary = `The ${firstFailure.api} did not respond successfully: ${firstFailure.detail}`;
  } else if (runnableChecks.length && skipped.length) {
    summary = `Partly tested — ${formatSummaryCount("API", runnableChecks.length)} responded, but ${skipped
      .map((check) => check.api)
      .join(", ")} could not be tested, so this says nothing about whether those work. ${skipped[0].detail}`;
  } else {
    summary = "No API probes could be run for this connection.";
  }

  return {
    providerId,
    ok,
    checkedAt: getNowIso(),
    summary,
    checks,
  };
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
