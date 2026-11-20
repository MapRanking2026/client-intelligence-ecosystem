import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { ClientBookLinks } from "@/src/lib/mtos-data";
import { getIntegrationConnection, getIntegrationCredentials } from "@/src/lib/server/integrations";
import {
  findPostNotesPage,
  findTouchPage,
  postNotesPageName,
  touchPageName,
  type BookPage,
} from "@/src/lib/server/services/client-book-pages";
import {
  flattenMarkdownTables,
  isTableStructureError,
  normalizeMarkdownTables,
} from "@/src/lib/server/services/clickup-markdown";
import { withoutProductName } from "@/src/lib/contracts/client-book-page";
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
 * `Client Meetings Notes`, as ONE page per touch named `Monthly Touch (<date>)`, with the
 * post-call write-up as a subpage of that page named `Post Monthly Touch Notes <date>`. The post
 * notes live inside the touch page from the same call, never as a sibling page beside it.
 *
 * Two rules follow from that and are enforced below. The filing creates the touch page and an
 * EMPTY post-notes subpage inside it, and records that subpage id, which is what the post-meeting
 * step replaces -- so the placeholder is filled in rather than read as a write-up that already
 * exists. And the post-meeting step writes only under a touch page it actually found for that
 * date: when none matches, or more than one could, it refuses and hands the candidates back
 * rather than guessing or falling back to a top-level page.
 *
 * Reading the book is already handled by clickup-client-context, which feeds the prep. This is
 * the other direction, and it reuses that module's workspace and folder resolution so there is
 * one definition of "which ClickUp folder is this client".
 */

type JsonRecord = Record<string, unknown>;

/**
 * The pages MTOS has written for a touch, so a re-run edits them instead of stacking duplicates.
 * Defined with the rest of the touch record in mtos-data, because it is persisted on the touch.
 */
export type { ClientBookLinks };


/** The page every touch page hangs off. Matched case-insensitively; this is the AM's own name. */
const MEETINGS_PAGE_NAMES = ["client meetings notes", "client meeting notes", "meeting notes"];

interface BookPageNode {
  id: string;
  name: string;
  pages?: BookPageNode[];
  content?: string;
}

interface ClickupAccess {
  token: string;
  workspaceId: string;
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
 * What ClickUp said when it refused, in its own words.
 *
 * Carried back to the caller rather than logged and dropped. The screen used to say only
 * "ClickUp refused to create the page", which is true of a disconnected integration, a deleted
 * doc and a stray `|` in one table cell alike -- and the AM could act on exactly one of those.
 */
interface PageWriteFailure {
  status: number;
  detail: string;
}

type PageWriteResult<T> = { ok: true; value: T } | { ok: false } & PageWriteFailure;

/** ClickUp's `message` out of its error body, or the raw text when it isn't JSON. */
function clickupMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as JsonRecord;
    const message = String(parsed.message || parsed.err || "").trim();
    if (message) return message;
  } catch {
    // Not JSON; the raw body is still the most informative thing available.
  }
  return body.trim().slice(0, 300);
}

/**
 * One attempt at a page write, with the body already in its final form.
 *
 * Both the POST and the PUT go through here so the retry below sees the same failure shape from
 * either, and so there is one place that decides what counts as ClickUp's message.
 */
async function writePage(
  access: ClickupAccess,
  url: string,
  method: "POST" | "PUT",
  body: JsonRecord,
  label: string,
): Promise<PageWriteResult<JsonRecord>> {
  try {
    const response = await fetch(url, {
      method,
      headers: {
        authorization: access.token,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = clickupMessage(await response.text());
      console.warn(`[client-book] ${label} failed ${response.status}: ${detail}`);
      return { ok: false, status: response.status, detail };
    }
    return { ok: true, value: (await response.json().catch(() => ({}))) as JsonRecord };
  } catch (error) {
    console.warn(`[client-book] ${label} threw`, error);
    return { ok: false, status: 0, detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Send the notes, and if ClickUp rejects a table in them, send them again without tables.
 *
 * ClickUp parses `text/md` strictly: one row whose column count does not match its header rejects
 * the WHOLE page, which is how an approved brief for a real client failed to reach the book on
 * 18 November 2026 over a stray `|` inside one cell. Normalizing first fixes the row; the retry
 * exists because the normalizer can only repair the malformed tables it can recognize, and a
 * brief that reads as bullet lines still beats a brief that is not in the book at all.
 */
async function sendWithTableFallback(
  access: ClickupAccess,
  url: string,
  method: "POST" | "PUT",
  body: JsonRecord,
  content: string,
  label: string,
): Promise<PageWriteResult<JsonRecord>> {
  const normalized = normalizeMarkdownTables(content);
  const first = await writePage(access, url, method, { ...body, content: normalized }, label);
  if (first.ok || !isTableStructureError(first.detail)) {
    return first;
  }
  const flattened = flattenMarkdownTables(normalized);
  if (flattened === normalized) {
    return first;
  }
  console.warn(`[client-book] ${label}: retrying with tables flattened after ${first.detail}`);
  return writePage(access, url, method, { ...body, content: flattened }, `${label} (tables flattened)`);
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
): Promise<PageWriteResult<{ id: string }>> {
  const result = await sendWithTableFallback(
    access,
    `${CLICKUP_V3}/workspaces/${access.workspaceId}/docs/${docId}/pages`,
    "POST",
    {
      ...(parentPageId ? { parent_page_id: parentPageId } : {}),
      name,
      content_format: "text/md",
    },
    content,
    "create page",
  );
  if (!result.ok) return result;
  const payload = result.value;
  const id = String(payload.id || (payload.page as JsonRecord)?.id || "");
  return id
    ? { ok: true, value: { id } }
    : { ok: false, status: 200, detail: "ClickUp accepted the page but returned no page id." };
}

/** Replace a page MTOS wrote earlier. Only ever called with a page id MTOS itself recorded. */
async function replacePage(
  access: ClickupAccess,
  docId: string,
  pageId: string,
  name: string,
  content: string,
): Promise<PageWriteResult<JsonRecord>> {
  return sendWithTableFallback(
    access,
    `${CLICKUP_V3}/workspaces/${access.workspaceId}/docs/${docId}/pages/${pageId}`,
    "PUT",
    { name, content_format: "text/md", content_edit_mode: "replace" },
    content,
    "update page",
  );
}


interface BookLocation {
  access: ClickupAccess;
  docId: string;
  meetingsPageId: string;
  /** Every page in the book, flattened, for matching this touch's page by name and date. */
  pages: BookPageNode[];
  /** The page tree, so the children of the touch page can be read without a second request. */
  tree: BookPageNode[];
  /** The ClickUp folder and doc the notes are going into, so the AM can confirm it is the right client. */
  destination: string;
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

  // `max_page_depth=-1` is load-bearing: the touch pages are nested under Client Meetings Notes, so
  // a shallow listing returns the section and none of the pages that matter here.
  const pagesPayload = (await clickupFetch(
    `${CLICKUP_V3}/workspaces/${access.workspaceId}/docs/${docId}/pages?content_format=text%2Fmd&max_page_depth=-1`,
    access.token,
  )) as BookPageNode[] | JsonRecord | null;
  const tree = Array.isArray(pagesPayload) ? (pagesPayload as BookPageNode[]) : [];
  const flat = flattenPages(tree);

  const meetings = flat.find((page) =>
    MEETINGS_PAGE_NAMES.includes(String(page.name || "").trim().toLowerCase()),
  );
  if (!meetings) {
    return {
      error: `${folder.name}'s Client's Book has no "Client Meetings Notes" page, so there's nowhere to file this touch.`,
    };
  }

  return {
    access,
    docId,
    meetingsPageId: meetings.id,
    pages: flat,
    tree,
    destination: `Map Ranking space → ${folder.name} → ${String(book.name || "Client's Book")} → ${String(meetings.name || "Client Meetings Notes")}`,
  };
}

/** The pages directly under one page, for checking whether the post-notes subpage already exists. */
function childrenOf(tree: BookPageNode[], pageId: string): BookPageNode[] {
  for (const node of tree) {
    if (node.id === pageId) return node.pages || [];
    const found = childrenOf(node.pages || [], pageId);
    if (found.length) return found;
  }
  return [];
}

function toBookPages(nodes: BookPageNode[]): BookPage[] {
  return nodes.map((node) => ({ id: node.id, name: String(node.name || "") }));
}

/**
 * What the empty post-notes subpage holds until the call has happened.
 *
 * One line rather than nothing at all: a genuinely blank ClickUp page reads as a write-up
 * somebody abandoned, and this says plainly that it is waiting for the call rather than unfinished.
 */
const POST_NOTES_PLACEHOLDER = "_Nothing filed yet. The post-call write-up lands here after the call._";

export interface FilePrepNotesResult {
  links: ClientBookLinks;
  destination: string;
  /** The page name as written, so the AM can find it and the post notes can match its date format. */
  pageName: string;
}

/**
 * Step 4 of the preparation workflow: file the preparation notes as this touch's page.
 *
 * The destination is the account managers' own hierarchy -- Map Ranking space, the business folder,
 * the Client's Book, `Client Meetings Notes`, then one page per touch named
 * `Monthly Touch (<date>)`, with an empty `Post Monthly Touch Notes <date>` subpage inside it.
 *
 * The subpage is created here, empty, so the place the write-up will go exists from the moment
 * the brief is approved. Its page id is recorded on the touch, and that recorded id is what the
 * post-meeting step replaces -- which is how an empty placeholder gets filled in rather than
 * read as a write-up that already exists.
 *
 * Running this twice edits the pages MTOS wrote before rather than stacking a second set for the
 * same day. A page with the same name that the AM wrote by hand is left alone and a separate page
 * is created: silently overwriting someone's own notes is worse than a duplicate they can merge.
 */
export async function filePrepNotesToClientBook(
  context: TenantContext,
  options: {
    clientName: string;
    touchDateIso: string;
    markdown: string;
    existing?: ClientBookLinks;
  },
): Promise<FilePrepNotesResult | { error: string }> {
  const located = await locateBook(context, options.clientName);
  if ("error" in located) {
    return located;
  }

  const { access, docId, meetingsPageId, destination } = located;
  const name = touchPageName(options.touchDateIso);
  const existing = options.existing?.docId === docId ? options.existing : undefined;

  let prepPageId = "";
  if (existing?.prepPageId) {
    const replaced = await replacePage(access, docId, existing.prepPageId, name, withoutProductName(options.markdown));
    if (replaced.ok) prepPageId = existing.prepPageId;
    // Otherwise fall through and create a fresh page: the old one may have been deleted in ClickUp.
  }
  if (!prepPageId) {
    const created = await createPage(access, docId, name, withoutProductName(options.markdown), meetingsPageId);
    if (!created.ok) {
      return {
        error: `ClickUp refused to create the "${name}" page in the Client's Book: ${created.detail}`,
      };
    }
    prepPageId = created.value.id;
  }

  // The empty post-notes subpage. A subpage already recorded is kept rather than replaced with a
  // second empty one, so a re-filed brief never orphans the write-up hanging off the first.
  let postPageId = existing?.postPageId || "";
  let postPageUrl = existing?.postPageUrl || "";
  if (!postPageId) {
    const subName = postNotesPageName(name, options.touchDateIso);
    const child = await createPage(access, docId, subName, POST_NOTES_PLACEHOLDER, prepPageId);
    if (child.ok) {
      postPageId = child.value.id;
      postPageUrl = pageUrl(access.workspaceId, docId, child.value.id);
    }
    // A subpage ClickUp refused is not worth failing the approval over. The brief itself is
    // filed, and the post-meeting step creates the subpage then if it is still missing.
  }

  return {
    destination,
    pageName: name,
    links: {
      docId,
      prepPageId,
      prepPageUrl: pageUrl(access.workspaceId, docId, prepPageId),
      ...(postPageId ? { postPageId } : {}),
      ...(postPageUrl ? { postPageUrl } : {}),
      writtenAt: new Date().toISOString(),
    },
  };
}

/**
 * File the post-call write-up into this touch's `Post Monthly Touch Notes` subpage.
 *
 * The parent is found by name and date, across every date format the team writes, because these
 * pages are written by hand as often as by MTOS. When nothing matches, or more than one page
 * could, this refuses and names the candidates: nesting a write-up under the wrong month's page,
 * or dropping it at the top of the book, both lose it as surely as not writing it at all.
 *
 * A subpage MTOS recorded earlier is replaced, which is how the empty page the approval created
 * gets filled in, and how a re-run updates rather than duplicates. A subpage MTOS has no record
 * of is reported rather than overwritten -- the AM decides whether it is theirs to keep.
 */
export async function writePostNotesToClientBook(
  context: TenantContext,
  options: {
    clientName: string;
    touchDateIso: string;
    markdown: string;
    links?: ClientBookLinks;
  },
): Promise<{ links: ClientBookLinks; pageName: string } | { error: string }> {
  const located = await locateBook(context, options.clientName);
  if ("error" in located) {
    return located;
  }

  const { access, docId, pages, tree } = located;
  const recorded = options.links?.docId === docId ? options.links : undefined;

  // The parent page. A prep filed by MTOS recorded its id, which is the exact answer; everything
  // else is matched out of the book.
  let parentId = "";
  let parentName = "";
  if (recorded?.prepPageId && pages.some((page) => page.id === recorded.prepPageId)) {
    parentId = recorded.prepPageId;
    parentName = String(pages.find((page) => page.id === recorded.prepPageId)?.name || "");
  } else {
    const match = findTouchPage(toBookPages(pages), options.touchDateIso);
    if (match.kind === "ambiguous") {
      return {
        error: `More than one page in the Client's Book could be this touch's Monthly Touch page: ${match.candidates
          .map((page) => `"${page.name}"`)
          .join(", ")}. Say which one the post-meeting notes belong under — nothing was written.`,
      };
    }
    if (match.kind === "none") {
      const hint = match.otherCandidates.length
        ? ` The closest page for that date is ${match.otherCandidates
            .map((page) => `"${page.name}"`)
            .join(", ")} — rename it to "${touchPageName(options.touchDateIso)}" or create that page, then file again.`
        : ` Create "${touchPageName(options.touchDateIso)}" under Client Meetings Notes first, then file again.`;
      return {
        error: `The Client's Book has no "Monthly Touch" page for this touch's date, and the post-meeting notes go inside it, never beside it.${hint} Nothing was written.`,
      };
    }
    parentId = match.page.id;
    parentName = match.page.name;
  }

  const links: ClientBookLinks = recorded || {
    docId,
    prepPageId: parentId,
    prepPageUrl: pageUrl(access.workspaceId, docId, parentId),
    writtenAt: new Date().toISOString(),
  };
  const name = postNotesPageName(parentName, options.touchDateIso);

  // A subpage MTOS wrote before is this touch's own write-up; replacing it is how a re-run updates
  // rather than duplicates.
  if (links.postPageId) {
    const replaced = await replacePage(access, docId, links.postPageId, name, withoutProductName(options.markdown));
    if (replaced.ok) {
      return {
        pageName: name,
        links: { ...links, prepPageId: parentId, prepPageUrl: pageUrl(access.workspaceId, docId, parentId), postPageUrl: pageUrl(access.workspaceId, docId, links.postPageId), writtenAt: new Date().toISOString() },
      };
    }
    if (replaced.status !== 404) return { error: `ClickUp could not update the saved post-notes page: ${replaced.detail}. No duplicate page was created.` };
  }

  // Somebody else's write-up under the same parent. Reported, never replaced.
  const theirs = findPostNotesPage(toBookPages(childrenOf(tree, parentId)));
  if (theirs && theirs.id !== links.postPageId) {
    // Older approval records lost the child id. Recover only the exact MTOS placeholder,
    // never a blank page or somebody's existing write-up.
    const page = pages.find(candidate => candidate.id === theirs.id);
    const read = typeof page?.content === "string" ? page : await clickupFetch(
      `${CLICKUP_V3}/workspaces/${access.workspaceId}/docs/${docId}/pages/${theirs.id}?content_format=text%2Fmd`, access.token,
    ) as JsonRecord | null;
    if (typeof read?.content === "string" && read.content.trim() === normalizeMarkdownTables(withoutProductName(options.markdown)).trim()) {
      return { pageName: name, links: { ...links, postPageId: theirs.id, postPageUrl: pageUrl(access.workspaceId, docId, theirs.id), writtenAt: new Date().toISOString() } };
    }
    if (typeof read?.content === "string" && read.content.trim() === POST_NOTES_PLACEHOLDER) {
      const replaced = await replacePage(access, docId, theirs.id, name, withoutProductName(options.markdown));
      if (!replaced.ok) return { error: `ClickUp could not fill the post-notes placeholder: ${replaced.detail}` };
      return { pageName: name, links: { ...links, postPageId: theirs.id, postPageUrl: pageUrl(access.workspaceId, docId, theirs.id), writtenAt: new Date().toISOString() } };
    }
    return {
      error: `"${parentName}" already has a "${theirs.name}" subpage whose contents could not be verified as the MTOS placeholder. Review that page before filing; nothing was overwritten.`,
    };
  }

  const created = await createPage(access, docId, name, withoutProductName(options.markdown), parentId);
  if (!created.ok) {
    return {
      error: `ClickUp refused to create the "${name}" subpage under "${parentName}": ${created.detail}`,
    };
  }

  return {
    pageName: name,
    links: {
      ...links,
      prepPageId: parentId,
      prepPageUrl: pageUrl(access.workspaceId, docId, parentId),
      postPageId: created.value.id,
      postPageUrl: pageUrl(access.workspaceId, docId, created.value.id),
      writtenAt: new Date().toISOString(),
    },
  };
}
