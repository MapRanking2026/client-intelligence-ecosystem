import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { ClickupBookPage, ClickupChatMessage, ClickupClientContext } from "@/src/lib/mtos-data";
import { getIntegrationConnection, getIntegrationCredentials } from "@/src/lib/server/integrations";
import { namesLikelyMatch } from "@/src/lib/server/name-matching";

type JsonRecord = Record<string, unknown>;

// The Map Ranking space holds one folder per client, each with its Client's Book doc and a project
// chat channel. Overridable in case the workspace layout changes.
const MAP_RANKING_SPACE_ID = process.env.CLICKUP_MAP_RANKING_SPACE_ID || "90112581687";
const V2 = "https://api.clickup.com/api/v2";
const V3 = "https://api.clickup.com/api/v3";

// Which Client's Book pages carry the business context an AM needs before a touch. Matched
// case-insensitively against page names; page trees are walked so children (e.g. the latest monthly
// note under "Pre-Monthly Touch Notes") are included.
const BOOK_PAGE_PRIORITIES = [
  "client information",
  "offers/events",
  "offers / events",
  "competitor analysis",
  "client meetings notes",
  "pre-monthly touch notes",
];

const MAX_CHAT_MESSAGES = 15;
const MAX_MESSAGE_CHARS = 400;
const MAX_BOOK_PAGES = 6;
const MAX_PAGE_CHARS = 1800;

interface DashboardPage {
  id: string;
  name: string;
  content: string;
  pages?: DashboardPage[];
}

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

async function findClientFolder(token: string, clientName: string) {
  const payload = (await clickupFetch(`${V2}/space/${MAP_RANKING_SPACE_ID}/folder?archived=false`, token)) as
    | JsonRecord
    | null;
  const folders = Array.isArray(payload?.folders) ? (payload!.folders as JsonRecord[]) : [];
  // Folder names carry status prefixes like "❌" / "⏸️"; strip them before matching.
  const cleaned = (name: string) => name.replace(/[^\p{L}\p{N}\s&'./-]/gu, " ").trim();
  const match = folders.find((folder) => namesLikelyMatch(clientName, cleaned(String(folder.name || ""))));
  return match ? { id: String(match.id), name: String(match.name || "") } : null;
}

function collectPrioritizedPages(pages: DashboardPage[]): ClickupBookPage[] {
  // Flatten the page tree, newest child last, then pick the priority pages with content.
  const flat: DashboardPage[] = [];
  const walk = (nodes: DashboardPage[]) => {
    for (const node of nodes) {
      flat.push(node);
      if (Array.isArray(node.pages)) {
        walk(node.pages);
      }
    }
  };
  walk(pages);

  const picked: ClickupBookPage[] = [];
  for (const priority of BOOK_PAGE_PRIORITIES) {
    // For notes sections, prefer the deepest (most specific/recent) matching leaf pages.
    const matches = flat.filter((page) => page.name.toLowerCase().includes(priority) && page.content.trim());
    for (const page of matches.slice(-2)) {
      if (picked.length >= MAX_BOOK_PAGES) {
        break;
      }
      if (!picked.some((existing) => existing.pageName === page.name)) {
        picked.push({
          pageName: page.name,
          content: page.content.trim().slice(0, MAX_PAGE_CHARS),
        });
      }
    }
  }
  return picked;
}

async function fetchClientsBook(token: string, workspaceId: string, folderId: string): Promise<ClickupBookPage[]> {
  const docsPayload = (await clickupFetch(
    `${V3}/workspaces/${workspaceId}/docs?parent_id=${folderId}&parent_type=5&limit=25`,
    token,
  )) as JsonRecord | null;
  const docs = Array.isArray(docsPayload?.docs) ? (docsPayload!.docs as JsonRecord[]) : [];
  const book =
    docs.find((doc) => String(doc.name || "").toLowerCase().includes("client's book")) || docs[0];
  if (!book?.id) {
    return [];
  }

  const pagesPayload = (await clickupFetch(
    `${V3}/workspaces/${workspaceId}/docs/${book.id}/pages?content_format=text%2Fmd&max_page_depth=-1`,
    token,
  )) as DashboardPage[] | JsonRecord | null;
  const pages = Array.isArray(pagesPayload) ? (pagesPayload as DashboardPage[]) : [];
  return collectPrioritizedPages(pages);
}

async function fetchRecentChat(
  token: string,
  workspaceId: string,
  folderId: string,
  clientName: string,
  userNames: Map<string, string>,
): Promise<ClickupChatMessage[]> {
  // Most channels use the id pattern 5-{folderId}-8; confirm/fallback via the channel list.
  let channelId = `5-${folderId}-8`;
  const channelsPayload = (await clickupFetch(
    `${V3}/workspaces/${workspaceId}/chat/channels?limit=100`,
    token,
  )) as JsonRecord | null;
  const channels = Array.isArray(channelsPayload?.data) ? (channelsPayload!.data as JsonRecord[]) : [];
  const byParent = channels.find((channel) => String((channel.parent as JsonRecord)?.id || "") === folderId);
  const byName = channels.find((channel) => namesLikelyMatch(clientName, String(channel.name || "")));
  channelId = String((byParent || byName)?.id || channelId);

  const messagesPayload = (await clickupFetch(
    `${V3}/workspaces/${workspaceId}/chat/channels/${encodeURIComponent(channelId)}/messages?limit=${MAX_CHAT_MESSAGES}&content_format=text%2Fplain`,
    token,
  )) as JsonRecord | null;
  const messages = Array.isArray(messagesPayload?.data) ? (messagesPayload!.data as JsonRecord[]) : [];

  return messages.map((message) => {
    const userId = String(message.user_id || "");
    const rawText = String(message.content || "")
      // Turn "[@Name](#user_mention#id)" mentions into "@Name".
      .replace(/\[@([^\]]+)\]\(#user_mention#[^)]+\)/g, "@$1")
      // Drop image/attachment markdown so only the human text remains.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return {
      author: userNames.get(userId) || "Unknown participant",
      // These are internal project channels, so any workspace member is team. A non-member author
      // (rare -- a guest) is treated as external.
      authorIsInternal: userNames.has(userId),
      date: message.date ? new Date(Number(message.date)).toISOString() : "",
      text: rawText.slice(0, MAX_MESSAGE_CHARS),
    };
  });
}

async function fetchMemberNames(token: string, workspaceId: string) {
  const userNames = new Map<string, string>();
  const payload = (await clickupFetch(`${V2}/team`, token)) as JsonRecord | null;
  const teams = Array.isArray(payload?.teams) ? (payload!.teams as JsonRecord[]) : [];
  const team = teams.find((t) => String(t.id) === workspaceId) || teams[0];
  const members = Array.isArray(team?.members) ? (team!.members as JsonRecord[]) : [];
  for (const entry of members) {
    const user = (entry.user || {}) as JsonRecord;
    const id = String(user.id || "");
    if (!id) {
      continue;
    }
    userNames.set(id, String(user.username || user.email || "Team member"));
  }
  return userNames;
}

export async function fetchClickupClientContext(
  context: TenantContext,
  clientName: string,
): Promise<ClickupClientContext | null> {
  const connection = await getIntegrationConnection(context, "clickup");
  if (!connection || connection.status !== "connected") {
    return null;
  }
  const token = getIntegrationCredentials(connection).accessToken;
  if (!token) {
    return null;
  }

  try {
    const workspaceId = await resolveWorkspaceId(token, connection.externalAccountId);
    if (!workspaceId) {
      return null;
    }

    const folder = await findClientFolder(token, clientName);
    if (!folder) {
      return {
        matched: false,
        folderName: "",
        clientsBook: [],
        recentChat: [],
        notes: [
          `No business folder in the Map Ranking space matched "${clientName}" -- rename the folder to match or pin it so the Client's Book and chat feed the brief.`,
        ],
      };
    }

    const userNames = await fetchMemberNames(token, workspaceId);
    const [clientsBook, recentChat] = await Promise.all([
      fetchClientsBook(token, workspaceId, folder.id),
      fetchRecentChat(token, workspaceId, folder.id, clientName, userNames),
    ]);

    const notes: string[] = [];
    if (!clientsBook.length) {
      notes.push("The matched folder has no readable Client's Book pages yet.");
    }
    if (!recentChat.length) {
      notes.push("No recent project-channel chat activity was found for this client.");
    }

    return { matched: true, folderName: folder.name, clientsBook, recentChat, notes };
  } catch (error) {
    console.warn(
      `ClickUp client context fetch failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return null;
  }
}
