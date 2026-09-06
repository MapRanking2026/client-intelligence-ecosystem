/**
 * ClickUp client-roster reader for SEOOS.
 *
 * Mirrors MTOS's model: a ClickUp "Health Tracker" list where each task is one
 * client. We read the same custom fields MTOS uses (Account Manager, Client
 * Status, Location) plus an "SEO Specialist" field so SEOOS can show each
 * specialist only their assigned accounts. Uses a personal API token
 * (Authorization header, no Bearer) exactly like the SEOOS ClickUp adapter.
 *
 * No token or raw payload ever leaves the server; only a normalized roster is
 * returned.
 */
const BASE = "https://api.clickup.com/api/v2";

type ClickUpTask = {
  id: string;
  name?: string;
  description?: string;
  due_date?: string | null;
  date_updated?: string | null;
  status?: { status?: string; type?: string };
  custom_fields?: Array<{
    name?: string;
    value?: unknown;
    type_config?: { options?: Array<{ id?: string; name?: string; orderindex?: number }> };
  }>;
};

const CLOSED_TOKENS = ["closed", "complete", "completed", "done", "cancelled", "archived"];

export interface RosterClient {
  /** Canonical client id = the ClickUp task id (stable, never duplicated). */
  clientId: string;
  name: string;
  website?: string;
  location?: string;
  niche?: string;
  /** Pod name from the SEO Dashboard "⭐ Pod" field. */
  pod?: string;
  /** Services (⭐ Services labels), joined. */
  serviceTier?: string;
  /** Health indicator (Health Score / ⭐ Health). */
  health?: string;
  status?: string;
  /** Raw, normalized value of the SEO Specialist field (for read-time matching). */
  seoSpecialist?: string;
  accountManager?: string;
  /** Curated non-secret SEO metrics for display (label -> value). */
  metrics?: Record<string, string>;
  taskId: string;
  updatedAt?: string;
}

/** Curated SEO Dashboard fields surfaced on the client (label -> field-name candidates). */
const METRIC_FIELDS: Array<[string, string[]]> = [
  ["Avg ranking", ["Ave Ranking", "Average Ranking", "Avg Ranking"]],
  ["R.R.S %", ["R.R.S %", "RRS %", "RRS"]],
  ["Health score", ["Health Score", "Health"]],
  ["Grid size", ["Grid Size"]],
  ["Aug check-ins", ["Aug Check-ins", "August Check-ins"]],
  ["Jul check-ins", ["July Check-ins", "Jul Check-ins"]],
  ["Aug GBP views", ["Aug GBP Views", "August GBP Views"]],
  ["Satisfaction", ["Satisfaction Rating"]],
  ["Main category", ["Main Category"]],
];

function extractMetrics(task: ClickUpTask): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [label, names] of METRIC_FIELDS) {
    const v = firstField(task, names);
    if (v) out[label] = v;
  }
  return out;
}

export interface RosterResult {
  ok: boolean;
  error?: string;
  fetched: number;
  clients: RosterClient[];
}

function normalizeFieldName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Lowercase + strip separators so "Jane Doe", "jane.doe", "jane@x.com" compare. */
export function normalizeComparableValue(value?: string | null): string {
  if (!value) return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[@._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fieldByName(task: ClickUpTask, fieldName: string) {
  const target = normalizeFieldName(fieldName);
  return task.custom_fields?.find((f) => normalizeFieldName(f.name || "") === target);
}

function stringifyField(task: ClickUpTask, fieldName: string): string {
  const field = fieldByName(task, fieldName);
  if (!field) return "";
  const { value } = field;
  if (typeof value === "string") {
    const opt = field.type_config?.options?.find(
      (o) => o.id === value || String(o.orderindex ?? "") === value,
    );
    return opt?.name || value;
  }
  if (typeof value === "number") {
    const opt = field.type_config?.options?.find(
      (o) => Number(o.orderindex) === value || o.id === String(value),
    );
    return opt?.name || String(value);
  }
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  if (value && typeof value === "object") return "";
  return "";
}

function firstField(task: ClickUpTask, names: string[], fallback = ""): string {
  for (const n of names) {
    const v = stringifyField(task, n);
    if (v) return v;
  }
  return fallback;
}

function specialistFieldNames() {
  const configured = process.env.CLICKUP_SEO_SPECIALIST_FIELD || "Responsable";
  return Array.from(
    new Set([configured, "Responsable", "SEO Specialist", "SEO Spec", "Specialist", "SEO Lead"]),
  );
}

function managerFieldNames() {
  const configured = process.env.CLICKUP_ACCOUNT_MANAGER_FIELD || "Account Manager";
  return Array.from(
    new Set([configured, "Account Manager", "Manager", "AM", "⭐️ Account Manager", "⭐ Account Manager"]),
  );
}

function statusFieldNames() {
  const configured = process.env.CLICKUP_CLIENT_STATUS_FIELD || "Client Status";
  return Array.from(
    new Set([configured, "Client Status", "Lifecycle Stage", "Stage", "Status"]),
  );
}

function isActiveTask(task: ClickUpTask): boolean {
  const type = (task.status?.type || "").trim().toLowerCase();
  if (type === "closed") return false;
  const status = (task.status?.status || "").trim().toLowerCase();
  if (CLOSED_TOKENS.some((t) => status.includes(t))) return false;

  const clientStatus = normalizeComparableValue(firstField(task, statusFieldNames()));
  if (!clientStatus) return true;
  if (
    clientStatus.includes("inactive") ||
    clientStatus.includes("cancel") ||
    clientStatus.includes("churn") ||
    clientStatus.includes("former") ||
    clientStatus.includes("lost")
  ) {
    return false;
  }
  return true;
}

async function clickupGet(token: string, path: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: token, "content-type": "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg =
        (typeof body.err === "string" && body.err) ||
        (typeof body.error === "string" && body.error) ||
        `clickup_http_${res.status}`;
      throw new Error(msg);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

/** Explicit roster list id, else the env-configured Health Tracker list. */
function resolveListId(listId?: string): string | undefined {
  return listId?.trim() || process.env.CLICKUP_HEALTH_TRACKER_LIST_ID || undefined;
}

async function fetchTasksFromList(token: string, listId: string): Promise<ClickUpTask[]> {
  const tasks: ClickUpTask[] = [];
  for (let page = 0; page < 10; page += 1) {
    const body = await clickupGet(
      token,
      `/list/${listId}/task?include_closed=true&subtasks=true&page=${page}`,
    );
    const pageTasks = Array.isArray(body.tasks) ? (body.tasks as ClickUpTask[]) : [];
    tasks.push(...pageTasks);
    if (pageTasks.length < 100) break;
  }
  return tasks;
}

async function fetchTasksFromTeam(token: string, teamId: string): Promise<ClickUpTask[]> {
  const tasks: ClickUpTask[] = [];
  for (let page = 0; page < 10; page += 1) {
    const body = await clickupGet(
      token,
      `/team/${teamId}/task?include_closed=true&subtasks=true&order_by=updated&page=${page}`,
    );
    const pageTasks = Array.isArray(body.tasks) ? (body.tasks as ClickUpTask[]) : [];
    tasks.push(...pageTasks);
    if (pageTasks.length < 100) break;
  }
  return tasks;
}

function podFieldNames() {
  const configured = process.env.CLICKUP_POD_FIELD || "Pod";
  return Array.from(new Set([configured, "Pod", "SEO Pod", "Team Pod"]));
}

export interface DashboardInfo {
  pod?: string;
  niche?: string;
  website?: string;
}

export interface PodMapResult {
  ok: boolean;
  error?: string;
  /** normalized client identity (name/business/client) -> pod display name. */
  podByClient: Record<string, string>;
  /** normalized client identity -> extra intake info (niche, website) from the dashboard. */
  infoByClient: Record<string, DashboardInfo>;
  /** distinct pod display names seen. */
  podNames: string[];
}

/**
 * READ-ONLY: read the SEO Dashboard list and build a client -> pod map from the
 * "⭐ Pod" field. Keyed by several normalized identity strings (task name,
 * Business Name, Client Name) so it can be joined to the Health Tracker roster.
 * Makes no changes to ClickUp.
 */
export async function fetchClickUpPodMap(input: {
  token: string;
  dashboardListId?: string;
}): Promise<PodMapResult> {
  const listId = input.dashboardListId?.trim() || process.env.CLICKUP_SEO_DASHBOARD_LIST_ID;
  if (!input.token) {
    return { ok: false, error: "Missing ClickUp API token", podByClient: {}, infoByClient: {}, podNames: [] };
  }
  if (!listId) {
    return {
      ok: false,
      error: "No SEO Dashboard list id configured (set it on the ClickUp connection or CLICKUP_SEO_DASHBOARD_LIST_ID).",
      podByClient: {},
      infoByClient: {},
      podNames: [],
    };
  }
  try {
    const tasks = await fetchTasksFromList(input.token, listId);
    const podByClient: Record<string, string> = {};
    const infoByClient: Record<string, DashboardInfo> = {};
    const podNames = new Set<string>();
    for (const task of tasks) {
      const pod = firstField(task, podFieldNames()) || undefined;
      const niche = firstField(task, ["Niche", "Main Category", "Industry", "Vertical"]) || undefined;
      const website = firstField(task, ["Website", "URL", "Domain", "Site"]) || undefined;
      if (pod) podNames.add(pod);
      const keys = [
        task.name || "",
        firstField(task, ["Business Name", "⭐️ Business Name"]),
        firstField(task, ["Client Name", "⭐️ Client Name", "Client"]),
      ]
        .map(normalizeComparableValue)
        .filter(Boolean);
      for (const k of keys) {
        if (pod && !podByClient[k]) podByClient[k] = pod;
        if (!infoByClient[k]) infoByClient[k] = { pod, niche, website };
      }
    }
    return { ok: true, podByClient, infoByClient, podNames: Array.from(podNames) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "clickup_pod_map_failed",
      podByClient: {},
      infoByClient: {},
      podNames: [],
    };
  }
}

/**
 * Fetch and normalize the active client roster from ClickUp. Prefers an explicit
 * Health Tracker list id; otherwise scans the workspace (team). Returns every
 * active client with its SEO-specialist and account-manager field values.
 */
export async function fetchClickUpClientRoster(input: {
  token: string;
  listId?: string;
  teamId?: string;
}): Promise<RosterResult> {
  const { token } = input;
  if (!token) return { ok: false, error: "Missing ClickUp API token", fetched: 0, clients: [] };

  try {
    const listId = resolveListId(input.listId);

    let raw: ClickUpTask[];
    if (listId) {
      raw = await fetchTasksFromList(token, listId);
    } else {
      // No roster list configured: scan the selected/first workspace.
      let teamId = input.teamId;
      if (!teamId) {
        const teamsBody = await clickupGet(token, "/team");
        const teams = Array.isArray(teamsBody.teams)
          ? (teamsBody.teams as Array<{ id?: string }>)
          : [];
        teamId = teams[0]?.id ? String(teams[0].id) : undefined;
      }
      if (!teamId) {
        return {
          ok: false,
          error:
            "No ClickUp roster list configured and no workspace found. Set the Client roster list ID on the ClickUp connection (or CLICKUP_HEALTH_TRACKER_LIST_ID).",
          fetched: 0,
          clients: [],
        };
      }
      raw = await fetchTasksFromTeam(token, teamId);
    }

    const active = raw.filter(isActiveTask);
    const clients: RosterClient[] = active.map((task) => {
      const name =
        firstField(task, ["Business Name", "⭐️ Business Name", "Client Name", "⭐️ Client Name", "Name"]) ||
        task.name?.trim() ||
        "Unnamed Client";
      const website = firstField(task, ["Website", "URL", "Domain", "Site"]) || undefined;
      const location = firstField(task, ["City, ST", "Location", "Market", "City", "State"]) || undefined;
      const niche = firstField(task, ["Niche", "Main Category", "Industry", "Vertical"]) || undefined;
      const pod = firstField(task, podFieldNames()) || undefined;
      const serviceTier = firstField(task, ["Services", "⭐ Services", "Service", "Package"]) || undefined;
      const health = firstField(task, ["Health Score", "Health", "⭐ Health"]) || undefined;
      const status = firstField(task, statusFieldNames()) || undefined;
      const seoSpecialist = normalizeComparableValue(firstField(task, specialistFieldNames())) || undefined;
      const accountManager = firstField(task, managerFieldNames()) || undefined;
      const metrics = extractMetrics(task);
      return {
        clientId: task.id,
        name,
        website,
        location,
        niche,
        pod,
        serviceTier,
        health,
        status,
        seoSpecialist,
        accountManager,
        metrics: Object.keys(metrics).length ? metrics : undefined,
        taskId: task.id,
        updatedAt: task.date_updated || undefined,
      };
    });

    return { ok: true, fetched: raw.length, clients };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "clickup_roster_failed",
      fetched: 0,
      clients: [],
    };
  }
}
