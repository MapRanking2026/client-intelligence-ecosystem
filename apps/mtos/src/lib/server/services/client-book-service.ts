import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getIntegrationConnection, getIntegrationCredentials } from "@/src/lib/server/integrations";
import {
  CLICKUP_V3,
  clickupFetch,
  findClientFolder,
  resolveWorkspaceId,
} from "@/src/lib/server/services/clickup-client-context";

/**
 * Writing a touch's notes back into the client's ClickUp Client's Book.
 *
 * The AM's record of a touch does not live in MTOS -- it lives in the Client's Book, under
 * `Client Meetings Notes`, as one page per touch named `Monthly Touch (M/D/YYYY)`, with the
 * post-call write-up as a subpage beneath it. That hierarchy is Francisco's, verified against
 * Mammoth Builders' book (doc 8chvq4p-374511), and this service writes into it rather than
 * inventing a parallel home for the same notes.
 *
 * Reading the book is already handled by clickup-client-context, which feeds the prep. This is
 * the other direction, and it reuses that module's workspace and folder resolution so there is
 * one definition of "which ClickUp folder is this client".
 */

type JsonRecord = Record<string, unknown>;

/** Pages MTOS has written for a touch, so a re-run edits them instead of stacking duplicates. */
export interface ClientBookLinks {
  docId: string;
  /** The `Monthly Touch (M/D/YYYY)` page holding the prep notes. */
  prepPageId: string;
  prepPageUrl: string;
  /** The `Post Monthly Touch Notes` subpage beneath it. */
  postPageId?: string;
  postPageUrl?: string;
  writtenAt: string;
}

export const POST_NOTES_PAGE_NAME = "Post Monthly Touch Notes";

/** The page every touch page hangs off. Matched case-insensitively; this is the AM's own name. */
const MEETINGS_PAGE_NAMES = ["client meetings notes", "client meeting notes", "meeting notes"];

interface BookPageNode {
  id: string;
  name: string;
  pages?: BookPageNode[];
}

interface ClickupAccess {
  token: string;
  workspaceId: string;
}

/**
 * `Monthly Touch (10/28/2026)` -- the exact shape already in the book, so new pages sort and read
 * alongside the hand-written ones. Deliberately the touch's own date in the AM's timezone rather
 * than a UTC date, because a 5pm Pacific call is tomorrow in UTC and would file itself a day late.
 */
export function monthlyTouchPageName(dateIso: string, timeZone = "America/Los_Angeles"): string {
  const date = new Date(dateIso);
  const when = Number.isNaN(date.getTime()) ? new Date() : date;
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "numeric",
    day: "numeric",
    year: "numeric",
  }).format(when);
  return `Monthly Touch (${formatted})`;
}

async function resolveAccess(context: TenantContext): Promise<ClickupAccess | null> {
  const connection = await getIntegrationConnection(context, "clickup");
  if (!connection || connection.status !== "connected") {
    return null;
  }
  const token = getIntegrationCredentials(connection).accessToken;
  if (!token) {
    return null;
  }
  const workspaceId = await resolveWorkspaceId(token, connection.externalAccountId);
  return workspaceId ? { token, workspaceId } : null;
}

function flattenPages(pages: BookPageNode[] | undefined): BookPageNode[] {
  return (pages || []).flatMap((page) => [page, ...flattenPages(page.pages)]);
}

function pageUrl(workspaceId: string, docId: string, pageId: string): string {
  return `https://app.clickup.com/${workspaceId}/docs/${docId}/${pageId}`;
}

/**
 * POST a new page into the book.
 *
 * `content_format: "text/md"` is what makes the headings, tables and lists in the notes render as
 * a document rather than as one long paragraph of literal markdown.
 */
async function createPage(
  access: ClickupAccess,
  docId: string,
  name: string,
  content: string,
  parentPageId?: string,
): Promise<{ id: string } | null> {
  try {
    const response = await fetch(`${CLICKUP_V3}/workspaces/${access.workspaceId}/docs/${docId}/pages`, {
      method: "POST",
      headers: {
        authorization: access.token,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...(parentPageId ? { parent_page_id: parentPageId } : {}),
        name,
        content,
        content_format: "text/md",
      }),
    });
    if (!response.ok) {
      console.warn(`[client-book] create page failed ${response.status}: ${(await response.text()).slice(0, 300)}`);
      return null;
    }
    const payload = (await response.json()) as JsonRecord;
    const id = String(payload.id || (payload.page as JsonRecord)?.id || "");
    return id ? { id } : null;
  } catch (error) {
    console.warn("[client-book] create page threw", error);
    return null;
  }
}

/** Replace a page MTOS wrote earlier. Only ever called with a page id MTOS itself recorded. */
async function replacePage(
  access: ClickupAccess,
  docId: string,
  pageId: string,
  name: string,
  content: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${CLICKUP_V3}/workspaces/${access.workspaceId}/docs/${docId}/pages/${pageId}`,
      {
        method: "PUT",
        headers: {
          authorization: access.token,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name,
          content,
          content_format: "text/md",
          content_edit_mode: "replace",
        }),
      },
    );
    if (!response.ok) {
      console.warn(`[client-book] update page failed ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    return response.ok;
  } catch (error) {
    console.warn("[client-book] update page threw", error);
    return false;
  }
}

interface BookLocation {
  access: ClickupAccess;
  docId: string;
  meetingsPageId: string;
  pages: BookPageNode[];
}

/**
 * The client's book and the page new touch pages belong under.
 *
 * Returns a sentence rather than throwing when something is missing: the AM can fix a folder name
 * or add the meetings page in ClickUp, and the touch itself must not fail because the write-back
 * target isn't there.
 */
async function locateBook(
  context: TenantContext,
  clientName: string,
): Promise<BookLocation | { error: string }> {
  const access = await resolveAccess(context);
  if (!access) {
    return { error: "ClickUp isn't connected, so the notes couldn't be filed in the Client's Book." };
  }

  const folder = await findClientFolder(access.token, clientName);
  if (!folder) {
    return {
      error: `No ClickUp folder in the Map Ranking space matched "${clientName}", so there's no Client's Book to file the notes in.`,
    };
  }

  const docsPayload = (await clickupFetch(
    `${CLICKUP_V3}/workspaces/${access.workspaceId}/docs?parent_id=${folder.id}&parent_type=5&limit=25`,
    access.token,
  )) as JsonRecord | null;
  const docs = Array.isArray(docsPayload?.docs) ? (docsPayload!.docs as JsonRecord[]) : [];
  const book = docs.find((doc) => String(doc.name || "").toLowerCase().includes("client's book")) || docs[0];
  if (!book?.id) {
    return { error: `${folder.name} has no Client's Book doc in ClickUp.` };
  }
  const docId = String(book.id);

  const pagesPayload = (await clickupFetch(
    `${CLICKUP_V3}/workspaces/${access.workspaceId}/docs/${docId}/pages?content_format=text%2Fmd&max_page_depth=-1`,
    access.token,
  )) as BookPageNode[] | JsonRecord | null;
  const pages = Array.isArray(pagesPayload) ? (pagesPayload as BookPageNode[]) : [];
  const flat = flattenPages(pages);

  const meetings = flat.find((page) =>
    MEETINGS_PAGE_NAMES.includes(String(page.name || "").trim().toLowerCase()),
  );
  if (!meetings) {
    return {
      error: `${folder.name}'s Client's Book has no "Client Meetings Notes" page, so there's nowhere to file this touch.`,
    };
  }

  return { access, docId, meetingsPageId: meetings.id, pages: flat };
}

/**
 * File the prep notes as this touch's page in the Client's Book.
 *
 * Re-running a prep edits the page MTOS wrote before rather than adding a second one for the same
 * day -- but only when MTOS recorded that page id itself. A page with the same name that the AM
 * wrote by hand is left alone and a separate page is created, because silently overwriting
 * someone's own notes is worse than a duplicate they can merge.
 */
export async function writePrepNotesToClientBook(
  context: TenantContext,
  options: {
    clientName: string;
    touchDateIso: string;
    markdown: string;
    existing?: ClientBookLinks;
  },
): Promise<{ links: ClientBookLinks } | { error: string }> {
  const located = await locateBook(context, options.clientName);
  if ("error" in located) {
    return located;
  }

  const { access, docId, meetingsPageId } = located;
  const name = monthlyTouchPageName(options.touchDateIso);

  if (options.existing?.prepPageId && options.existing.docId === docId) {
    const replaced = await replacePage(access, docId, options.existing.prepPageId, name, options.markdown);
    if (replaced) {
      return {
        links: { ...options.existing, prepPageUrl: pageUrl(access.workspaceId, docId, options.existing.prepPageId), writtenAt: new Date().toISOString() },
      };
    }
    // Fall through and create a fresh page: the old one may have been deleted in ClickUp.
  }

  const created = await createPage(access, docId, name, options.markdown, meetingsPageId);
  if (!created) {
    return { error: "ClickUp refused to create the touch page in the Client's Book." };
  }

  return {
    links: {
      docId,
      prepPageId: created.id,
      prepPageUrl: pageUrl(access.workspaceId, docId, created.id),
      writtenAt: new Date().toISOString(),
    },
  };
}

/**
 * File the post-call write-up as a subpage of this touch's page.
 *
 * Requires the prep page to exist, because the subpage hangs off it. That ordering is the AM's:
 * the touch page is the record of the meeting, and the post notes are part of it, not a sibling
 * floating next to every other month's.
 */
export async function writePostNotesToClientBook(
  context: TenantContext,
  options: {
    clientName: string;
    markdown: string;
    links: ClientBookLinks;
  },
): Promise<{ links: ClientBookLinks } | { error: string }> {
  const located = await locateBook(context, options.clientName);
  if ("error" in located) {
    return located;
  }

  const { access, docId } = located;
  const { links } = options;

  if (links.postPageId) {
    const replaced = await replacePage(access, docId, links.postPageId, POST_NOTES_PAGE_NAME, options.markdown);
    if (replaced) {
      return { links: { ...links, writtenAt: new Date().toISOString() } };
    }
  }

  const created = await createPage(access, docId, POST_NOTES_PAGE_NAME, options.markdown, links.prepPageId);
  if (!created) {
    return { error: "ClickUp refused to create the post-meeting subpage in the Client's Book." };
  }

  return {
    links: {
      ...links,
      postPageId: created.id,
      postPageUrl: pageUrl(access.workspaceId, docId, created.id),
      writtenAt: new Date().toISOString(),
    },
  };
}
