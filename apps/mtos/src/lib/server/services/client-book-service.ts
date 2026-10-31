import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { ClientBookLinks } from "@/src/lib/mtos-data";
import { getIntegrationConnection, getIntegrationCredentials } from "@/src/lib/server/integrations";
import {
  findPostNotesPage,
  findPreNotesPage,
  postNotesPageName,
  preNotesPageName,
  type BookPage,
} from "@/src/lib/server/services/client-book-pages";
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
 * `Client Meetings Notes`, as ONE page per touch named `Pre-Monthly Touch Notes <date>`, with the
 * post-call write-up as a subpage of that page named `Post-Monthly Touch Notes <date>`. The post
 * notes live inside the pre notes from the same touch, never as a sibling page beside them.
 *
 * Two rules follow from that and are enforced below. The preparation step files the pre page and
 * nothing else -- no empty post-notes placeholder, because a placeholder makes every post-meeting
 * run look like a re-run. And the post-meeting step writes only under a pre page it actually
 * found for that date: when none matches, or more than one could, it refuses and hands the
 * candidates back rather than guessing or falling back to a top-level page.
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
  /** Every page in the book, flattened, for matching this touch's page by name and date. */
  pages: BookPageNode[];
  /** The page tree, so the children of the pre-notes page can be read without a second request. */
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
 * `Pre-Monthly Touch Notes <date>`. That page is the whole of this step's output.
 *
 * The post-meeting subpage is NOT created here. It is created after the call, by the post-meeting
 * step, as a child of this page -- so the book never carries an empty page that reads as a
 * write-up nobody filled in, and the post-meeting step never has to decide whether an existing
 * subpage is a real re-run or a placeholder it left for itself.
 *
 * Running this twice edits the page MTOS wrote before rather than stacking a second one for the
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
  const name = preNotesPageName(options.touchDateIso);
  const existing = options.existing?.docId === docId ? options.existing : undefined;

  let prepPageId = "";
  if (existing?.prepPageId) {
    const replaced = await replacePage(access, docId, existing.prepPageId, name, options.markdown);
    if (replaced) prepPageId = existing.prepPageId;
    // Otherwise fall through and create a fresh page: the old one may have been deleted in ClickUp.
  }
  if (!prepPageId) {
    const created = await createPage(access, docId, name, options.markdown, meetingsPageId);
    if (!created) {
      return { error: `ClickUp refused to create the "${name}" page in the Client's Book.` };
    }
    prepPageId = created.id;
  }

  return {
    destination,
    pageName: name,
    links: {
      docId,
      prepPageId,
      prepPageUrl: pageUrl(access.workspaceId, docId, prepPageId),
      // Any post-notes subpage already recorded is kept, so a re-filed prep doesn't orphan the
      // write-up that hangs off it.
      ...(existing?.postPageId ? { postPageId: existing.postPageId } : {}),
      ...(existing?.postPageUrl ? { postPageUrl: existing.postPageUrl } : {}),
      writtenAt: new Date().toISOString(),
    },
  };
}

/**
 * File the post-call write-up as a subpage of this touch's `Pre-Monthly Touch Notes` page.
 *
 * The parent is found by name and date, across every date format the team writes, because these
 * pages are written by hand as often as by MTOS. When nothing matches, or more than one page
 * could, this refuses and names the candidates: nesting a write-up under the wrong month's page,
 * or dropping it at the top of the book, both lose it as surely as not writing it at all.
 *
 * A subpage MTOS recorded earlier is replaced. A subpage somebody else created under the same
 * parent is reported rather than overwritten -- the AM decides whether their own write-up should
 * be replaced.
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
    const match = findPreNotesPage(toBookPages(pages), options.touchDateIso);
    if (match.kind === "ambiguous") {
      return {
        error: `More than one page in the Client's Book could be this touch's Pre-Monthly Touch Notes: ${match.candidates
          .map((page) => `"${page.name}"`)
          .join(", ")}. Say which one the post-meeting notes belong under — nothing was written.`,
      };
    }
    if (match.kind === "none") {
      const hint = match.legacyCandidates.length
        ? ` The closest page for that date is ${match.legacyCandidates
            .map((page) => `"${page.name}"`)
            .join(", ")} — rename it to "${preNotesPageName(options.touchDateIso)}" or create that page, then file again.`
        : ` Create "${preNotesPageName(options.touchDateIso)}" under Client Meetings Notes first, then file again.`;
      return {
        error: `The Client's Book has no "Pre-Monthly Touch Notes" page for this touch's date, and the post-meeting notes go inside it, never beside it.${hint} Nothing was written.`,
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
    const replaced = await replacePage(access, docId, links.postPageId, name, options.markdown);
    if (replaced) {
      return {
        pageName: name,
        links: { ...links, prepPageId: parentId, prepPageUrl: pageUrl(access.workspaceId, docId, parentId), writtenAt: new Date().toISOString() },
      };
    }
  }

  // Somebody else's write-up under the same parent. Reported, never replaced.
  const theirs = findPostNotesPage(toBookPages(childrenOf(tree, parentId)));
  if (theirs && theirs.id !== links.postPageId) {
    return {
      error: `"${parentName}" already has a "${theirs.name}" subpage that MTOS didn't write. The post-meeting notes are on this screen — paste them in, or delete that subpage and file again. Nothing was overwritten.`,
    };
  }

  const created = await createPage(access, docId, name, options.markdown, parentId);
  if (!created) {
    return { error: `ClickUp refused to create the "${name}" subpage under "${parentName}".` };
  }

  return {
    pageName: name,
    links: {
      ...links,
      prepPageId: parentId,
      prepPageUrl: pageUrl(access.workspaceId, docId, parentId),
      postPageId: created.id,
      postPageUrl: pageUrl(access.workspaceId, docId, created.id),
      writtenAt: new Date().toISOString(),
    },
  };
}
