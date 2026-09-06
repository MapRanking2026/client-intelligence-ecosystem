/**
 * ClickUp ticket reader for SEOOS.
 *
 * Tickets are ad-hoc ClickUp tasks assigned to a specialist. We read them
 * READ-ONLY (personal API token, Authorization header, no Bearer) and never
 * write anything back. Only a normalized ticket list leaves this module; the
 * token and raw payload never do.
 */
const BASE = "https://api.clickup.com/api/v2";

const CLOSED_TOKENS = ["closed", "complete", "completed", "done", "cancelled", "archived"];

type ClickUpTask = {
  id: string;
  name?: string;
  description?: string;
  text_content?: string;
  url?: string;
  due_date?: string | null;
  parent?: string | null;
  status?: { status?: string; type?: string };
  assignees?: Array<{ id?: number; username?: string; email?: string }>;
};

export interface RawTicket {
  externalId: string;
  title: string;
  body: string;
  url?: string;
  parentId?: string;
  clickupStatus?: string;
  isClosed: boolean;
  dueDate?: string;
  assigneeRaw?: string;
  assigneeEmail?: string;
}

export interface FetchTicketsResult {
  ok: boolean;
  error?: string;
  fetched: number;
  tickets: RawTicket[];
}

async function clickupGet(token: string, path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: token, "content-type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`ClickUp ${res.status} on ${path}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

async function fetchTasksFromList(token: string, listId: string): Promise<ClickUpTask[]> {
  const out: ClickUpTask[] = [];
  // ClickUp paginates at 100; walk until a short/last page.
  for (let page = 0; page < 30; page++) {
    const body = await clickupGet(
      token,
      `/list/${listId}/task?include_closed=true&subtasks=true&page=${page}`,
    );
    const tasks = Array.isArray(body.tasks) ? (body.tasks as ClickUpTask[]) : [];
    out.push(...tasks);
    if (body.last_page === true || tasks.length < 100) break;
  }
  return out;
}

function firstAssignee(task: ClickUpTask): { name?: string; email?: string } {
  const a = task.assignees?.find((x) => x.username || x.email);
  return { name: a?.username, email: a?.email };
}

function toRaw(task: ClickUpTask): RawTicket {
  const statusName = task.status?.status;
  const isClosed =
    task.status?.type === "closed" ||
    (statusName ? CLOSED_TOKENS.some((t) => statusName.toLowerCase().includes(t)) : false);
  const { name, email } = firstAssignee(task);
  return {
    externalId: task.id,
    title: (task.name ?? "").trim() || "(untitled ticket)",
    body: (task.text_content ?? task.description ?? "").trim(),
    url: task.url,
    parentId: task.parent ?? undefined,
    clickupStatus: statusName,
    isClosed,
    dueDate: task.due_date ?? undefined,
    assigneeRaw: name,
    assigneeEmail: email,
  };
}

/**
 * Read tickets from one or more ClickUp lists. Accepts a comma-separated list of
 * list ids so several ticket queues can feed the inbox.
 */
export async function fetchClickUpTickets(input: {
  token: string;
  listIds: string;
  includeClosed?: boolean;
}): Promise<FetchTicketsResult> {
  const empty: FetchTicketsResult = { ok: false, fetched: 0, tickets: [] };
  if (!input.token) return { ...empty, error: "Missing ClickUp API token" };
  const listIds = input.listIds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!listIds.length) {
    return {
      ...empty,
      error:
        "No ticket list configured. Set the Tickets list id on the ClickUp connection (or CLICKUP_TICKETS_LIST_ID).",
    };
  }

  try {
    const seen = new Set<string>();
    const tickets: RawTicket[] = [];
    for (const listId of listIds) {
      const tasks = await fetchTasksFromList(input.token, listId);
      for (const task of tasks) {
        if (seen.has(task.id)) continue;
        seen.add(task.id);
        const raw = toRaw(task);
        if (raw.isClosed && !input.includeClosed) continue;
        tickets.push(raw);
      }
    }
    return { ok: true, fetched: tickets.length, tickets };
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : "clickup_tickets_failed" };
  }
}
