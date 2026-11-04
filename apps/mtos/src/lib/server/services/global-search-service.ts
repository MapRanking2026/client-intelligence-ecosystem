import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getIntegrationDefinition } from "@/src/lib/server/integrations";
import { integrationProviderIds } from "@/src/lib/contracts/integrations";
import { BRIEF_SECTIONS } from "@/src/lib/contracts/prep-brief";
import { itemTitle, type FollowThroughItem } from "@/src/lib/contracts/follow-through-tickets";
import {
  MIN_QUERY_LENGTH,
  groupResults,
  matchRanges,
  scoreFields,
  totalHits,
  SEARCH_PAGES,
  type SearchGroupResult,
  type SearchHit,
} from "@/src/lib/contracts/global-search";

/**
 * The search behind ⌘K, over the data MTOS already holds.
 *
 * It searches what this AM can already see, through the same data source every screen reads, so
 * there is no second view of a client and no index to fall out of step with the thing it indexes.
 * That is also the limit worth naming: this reads the touches and clients in one pass and ranks
 * them in memory, which is right for a book of a few hundred clients and would need a real index
 * at ten thousand.
 *
 * Nothing here writes, and nothing here reaches an external API. Tickets are the follow-through
 * items already stored on a touch -- not a live ClickUp query, which would make every keystroke
 * an API call and would show tickets the AM never filed from MTOS.
 */

/** A touch's own label, since a touch has no name of its own. */
function touchTitle(clientName: string, scheduledAt?: string): string {
  if (!scheduledAt) return `Monthly Touch — ${clientName}`;
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime())) return `Monthly Touch — ${clientName}`;
  return `Monthly Touch — ${clientName} · ${date.toISOString().slice(0, 10)}`;
}

function hit(
  partial: Omit<SearchHit, "score" | "titleRanges" | "subtitleRanges">,
  fields: { keywords?: string[] },
  query: string,
): SearchHit | null {
  const score = scoreFields(
    { title: partial.title, ...(partial.subtitle ? { subtitle: partial.subtitle } : {}), ...(fields.keywords ? { keywords: fields.keywords } : {}) },
    query,
  );
  if (!score) return null;
  return {
    ...partial,
    score,
    titleRanges: matchRanges(partial.title, query),
    ...(partial.subtitle ? { subtitleRanges: matchRanges(partial.subtitle, query) } : {}),
  };
}

export interface GlobalSearchResult {
  query: string;
  groups: SearchGroupResult[];
  total: number;
  /** Named when a group could not be read, so a thin result is not mistaken for an empty one. */
  unavailable?: string[];
}

export async function searchEverything(
  context: TenantContext,
  rawQuery: string,
  options: { touchId?: string } = {},
): Promise<GlobalSearchResult> {
  const query = rawQuery.trim();
  if (query.length < MIN_QUERY_LENGTH) {
    return { query, groups: [], total: 0 };
  }

  const hits: SearchHit[] = [];
  const unavailable: string[] = [];

  // --- The app's own screens and the brief's sections: no data, so always available -------------

  for (const page of SEARCH_PAGES) {
    const found = hit(
      { id: `page:${page.href}`, group: "pages", title: page.title, subtitle: page.subtitle, href: page.href },
      { keywords: page.keywords },
      query,
    );
    if (found) hits.push(found);
  }

  /*
    Brief sections are the one group without a row of its own to open.

    With a touch in context -- the palette passes the one the AM has open -- the section links
    straight to it. Without one it points at the list of touches and says so, because the
    alternative is picking a touch on the AM's behalf and opening somebody else's call.
  */
  for (const section of BRIEF_SECTIONS) {
    const inTouch = Boolean(options.touchId);
    const found = hit(
      {
        id: `brief:${section.id}`,
        group: "brief",
        title: `${section.n === "i" ? "Header" : `Section ${section.n}`} · ${section.title}`,
        subtitle: inTouch ? section.purpose : `${section.purpose} Open a touch to read it.`,
        href: inTouch ? `/monthly-touch/${options.touchId}?view=review#brief-${section.id}` : "/monthly-touch",
      },
      { keywords: [section.purpose] },
      query,
    );
    if (found) hits.push(found);
  }

  for (const providerId of integrationProviderIds) {
    const definition = getIntegrationDefinition(providerId);
    const found = hit(
      {
        id: `integration:${providerId}`,
        group: "integrations",
        title: definition.name,
        subtitle: definition.highlight,
        href: "/settings/integrations",
        chips: [definition.category],
      },
      { keywords: [providerId, definition.description, ...definition.capabilities] },
      query,
    );
    if (found) hits.push(found);
  }

  // --- The live data ----------------------------------------------------------------------------

  const dataSource = getMtosDataSource(context);

  const [clients, touches, commitments, opportunities] = await Promise.all([
    dataSource.getClients().catch(() => {
      unavailable.push("clients");
      return [];
    }),
    dataSource.getMonthlyTouches().catch(() => {
      unavailable.push("Monthly Touches");
      return [];
    }),
    dataSource.getCommitments().catch(() => {
      unavailable.push("commitments");
      return [];
    }),
    dataSource.getOpportunities().catch(() => {
      unavailable.push("opportunities");
      return [];
    }),
  ]);

  const clientNames = new Map(clients.map((client) => [client.id, client.name]));

  for (const client of clients) {
    const found = hit(
      {
        id: `client:${client.id}`,
        group: "clients",
        title: client.name,
        subtitle: [client.industry, client.location].filter(Boolean).join(" · "),
        href: `/clients/${client.id}`,
        chips: [client.lifecycleStage].filter(Boolean),
      },
      {
        keywords: [client.contact, client.accountManager, client.summary, ...(client.goals || [])].filter(
          (value): value is string => Boolean(value),
        ),
      },
      query,
    );
    if (found) hits.push(found);
  }

  for (const touch of touches) {
    const clientName = clientNames.get(touch.clientId) || "Unknown client";
    const found = hit(
      {
        id: `touch:${touch.id}`,
        group: "touches",
        title: touchTitle(clientName, touch.scheduledAt),
        subtitle: touch.executiveBrief,
        href: `/monthly-touch/${touch.id}`,
        chips: [touch.status],
      },
      { keywords: [clientName, touch.progress || "", ...touch.agenda] },
      query,
    );
    if (found) hits.push(found);

    // Tickets: the follow-through items already filed against this touch.
    const items: FollowThroughItem[] = touch.followThrough?.items || [];
    for (const item of items) {
      if (item.decision === "deleted") continue;
      const title = itemTitle(item);
      if (!title.trim()) continue;
      const url = touch.followThrough?.ticketUrls?.[item.id];
      const found = hit(
        {
          id: `ticket:${touch.id}:${item.id}`,
          group: "tickets",
          title,
          subtitle: `${clientName}${item.formType === "billing" ? " · Billing change" : item.department ? ` · ${item.department}` : ""}`,
          // The real ClickUp task once it exists; the follow-through screen it was drafted on
          // until then. A drafted ticket has no ClickUp url, and inventing one would be a link
          // to nothing.
          href: url || `/monthly-touch/${touch.id}/follow-through`,
          chips: [item.decision || "undecided", ...(url ? ["in ClickUp"] : ["draft"])],
        },
        {
          keywords: [
            item.assignee || "",
            item.formType === "billing" ? item.details : item.description,
            ...(item.formType === "ticket" ? item.tags || [] : []),
          ],
        },
        query,
      );
      if (found) hits.push(found);
    }
  }

  for (const commitment of commitments) {
    const clientName = clientNames.get(commitment.clientId) || "Unknown client";
    const found = hit(
      {
        id: `commitment:${commitment.id}`,
        group: "commitments",
        title: commitment.title,
        subtitle: `${clientName} · ${commitment.owner} · due ${commitment.dueDate || "—"}`,
        href: `/commitments?client=${encodeURIComponent(commitment.clientId)}`,
        chips: [commitment.status, commitment.category],
      },
      { keywords: [clientName, commitment.sourceMeeting] },
      query,
    );
    if (found) hits.push(found);
  }

  for (const opportunity of opportunities) {
    const clientName = clientNames.get(opportunity.clientId) || "Unknown client";
    const found = hit(
      {
        id: `opportunity:${opportunity.id}`,
        group: "opportunities",
        title: opportunity.title,
        subtitle: `${clientName} · ${opportunity.value || "—"}`,
        href: `/opportunities?client=${encodeURIComponent(opportunity.clientId)}`,
        chips: [opportunity.stage],
      },
      { keywords: [clientName, opportunity.nextStep, opportunity.readiness] },
      query,
    );
    if (found) hits.push(found);
  }

  const groups = groupResults(hits);
  return {
    query,
    groups,
    total: totalHits(groups),
    ...(unavailable.length ? { unavailable } : {}),
  };
}
