import type { SeoProjectV1 } from "@/src/lib/domain/project";

/**
 * ClickUp source adapter. Uses a personal API token (Authorization header) to
 * validate the connection, list authorized workspaces, and — when the project
 * maps a ClickUp list (externalIds.clickupListId) — pull that list's tasks.
 * No token ever leaves the server; only normalized, non-secret data is returned.
 */
const BASE = "https://api.clickup.com/api/v2";

async function clickupGet(token: string, path: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: token, "content-type": "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`clickup_http_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

export interface ClickUpSyncData {
  validated: boolean;
  user?: { id: number | string; username?: string };
  teams: Array<{ id: string; name: string }>;
  listId?: string;
  tasks: Array<{ id: string; name: string; status?: string; url?: string; dateUpdated?: string }>;
}

export async function syncClickUp(input: {
  credentials: Record<string, string>;
  project: SeoProjectV1;
}): Promise<{ ok: boolean; data?: ClickUpSyncData; error?: string; summary?: string }> {
  const token = input.credentials.apiToken;
  if (!token) return { ok: false, error: "Missing ClickUp API token" };

  try {
    const me = (await clickupGet(token, "/user")) as { user?: { id: number; username?: string } };
    const teamsRes = (await clickupGet(token, "/team")) as {
      teams?: Array<{ id: string; name: string }>;
    };
    const teams = (teamsRes.teams ?? []).map((t) => ({ id: String(t.id), name: t.name }));

    const listId = input.project.externalIds?.clickupListId;
    let tasks: ClickUpSyncData["tasks"] = [];
    if (listId) {
      const taskRes = (await clickupGet(token, `/list/${listId}/task?include_closed=true`)) as {
        tasks?: Array<{ id: string; name: string; status?: { status?: string }; url?: string; date_updated?: string }>;
      };
      tasks = (taskRes.tasks ?? []).map((t) => ({
        id: String(t.id),
        name: t.name,
        status: t.status?.status,
        url: t.url,
        dateUpdated: t.date_updated,
      }));
    }

    return {
      ok: true,
      data: {
        validated: true,
        user: me.user ? { id: me.user.id, username: me.user.username } : undefined,
        teams,
        listId,
        tasks,
      },
      summary: listId
        ? `Connected; ${tasks.length} task(s) from list ${listId}.`
        : `Connected to ${teams.length} workspace(s). Map a ClickUp list on the project to pull tasks.`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "clickup_sync_failed" };
  }
}
