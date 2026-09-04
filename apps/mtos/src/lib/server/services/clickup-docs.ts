import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getIntegrationConnection, getIntegrationCredentials } from "@/src/lib/server/integrations";

/**
 * Read-only access to ClickUp Docs (the Map Ranking wiki), reusing the app's
 * stored ClickUp OAuth connection. Mirrors the Docs/workspace patterns already
 * used by clickup-client-context.ts, kept self-contained so the knowledge
 * ingester doesn't couple to that file.
 */

type JsonRecord = Record<string, unknown>;

const V2 = "https://api.clickup.com/api/v2";
const V3 = "https://api.clickup.com/api/v3";

/** Bound how much we pull so a huge workspace can't blow up a single request. */
const MAX_DOCS = 200;
const MAX_DOC_PAGES = 10;

async function clickupFetch(url: string, token: string): Promise<JsonRecord | JsonRecord[] | null> {
  try {
    const response = await fetch(url, { headers: { authorization: token, accept: "application/json" } });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as JsonRecord | JsonRecord[];
  } catch {
    return null;
  }
}

async function resolveWorkspaceId(token: string, preferredId?: string): Promise<string | null> {
  const payload = (await clickupFetch(`${V2}/team`, token)) as JsonRecord | null;
  const teams = Array.isArray(payload?.teams) ? (payload!.teams as JsonRecord[]) : [];
  if (!teams.length) {
    return preferredId || null;
  }
  const match = preferredId ? teams.find((team) => String(team.id) === preferredId) : undefined;
  return String((match || teams[0]).id);
}

export interface ClickupAccess {
  token: string;
  workspaceId: string;
}

/** Resolve a usable ClickUp token + workspace, or null when not connected. */
export async function getClickupAccess(context: TenantContext): Promise<ClickupAccess | null> {
  const connection = await getIntegrationConnection(context, "clickup");
  if (!connection || connection.status !== "connected") {
    return null;
  }
  const token = getIntegrationCredentials(connection).accessToken;
  if (!token) {
    return null;
  }
  const workspaceId = await resolveWorkspaceId(token, connection.externalAccountId);
  if (!workspaceId) {
    return null;
  }
  return { token, workspaceId };
}

export interface ClickupDocSummary {
  id: string;
  name: string;
}

export interface ClickupDocPage {
  id: string;
  name: string;
  content: string;
}

/**
 * List the workspace's Docs for the picker. Follows `next_cursor` up to a cap.
 * Returns `connected: false` (not an error) when ClickUp isn't connected.
 */
export async function listClickupDocs(
  context: TenantContext,
): Promise<{ connected: boolean; docs: ClickupDocSummary[] }> {
  const access = await getClickupAccess(context);
  if (!access) {
    return { connected: false, docs: [] };
  }

  const docs: ClickupDocSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10 && docs.length < MAX_DOCS; page += 1) {
    const url = `${V3}/workspaces/${access.workspaceId}/docs?limit=50${
      cursor ? `&next_cursor=${encodeURIComponent(cursor)}` : ""
    }`;
    const payload = (await clickupFetch(url, access.token)) as JsonRecord | null;
    const batch = Array.isArray(payload?.docs) ? (payload!.docs as JsonRecord[]) : [];
    for (const doc of batch) {
      docs.push({ id: String(doc.id || ""), name: String(doc.name || "Untitled doc") });
    }
    cursor = typeof payload?.next_cursor === "string" ? (payload!.next_cursor as string) : undefined;
    if (!cursor || !batch.length) {
      break;
    }
  }

  return { connected: true, docs: docs.filter((doc) => doc.id) };
}

/** Fetch every page of a Doc (whole tree) as markdown. */
export async function fetchClickupDocPages(
  access: ClickupAccess,
  docId: string,
): Promise<ClickupDocPage[]> {
  const payload = await clickupFetch(
    `${V3}/workspaces/${access.workspaceId}/docs/${encodeURIComponent(
      docId,
    )}/pages?content_format=text%2Fmd&max_page_depth=-1`,
    access.token,
  );
  const roots = Array.isArray(payload) ? (payload as JsonRecord[]) : [];

  const flat: ClickupDocPage[] = [];
  const walk = (nodes: JsonRecord[]) => {
    for (const node of nodes) {
      flat.push({
        id: String(node.id || ""),
        name: String(node.name || ""),
        content: typeof node.content === "string" ? node.content : "",
      });
      if (Array.isArray(node.pages)) {
        walk(node.pages as JsonRecord[]);
      }
    }
  };
  walk(roots);
  return flat;
}

export { MAX_DOC_PAGES };
