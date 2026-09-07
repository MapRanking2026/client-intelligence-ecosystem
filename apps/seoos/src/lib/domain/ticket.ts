import { z } from "zod";
import { zIsoTimestamp, zTenantId, zUserId } from "@cie/contracts";

/**
 * A ticket ingested from ClickUp. Tickets are ad-hoc work items created in
 * ClickUp and assigned to a specialist; SEOOS reads them (read-only), routes
 * each to the account's specialist, and drafts the requested work HERE only —
 * nothing is ever written back to ClickUp or pushed live until approval.
 */
export const TicketCategory = z.enum([
  "gbp_post",
  "gbp_audit",
  "review_response",
  "keywords",
  "content",
  "report",
  "general",
]);
export type TicketCategory = z.infer<typeof TicketCategory>;

/** Prompt key that drafts each ticket category (falls back to ticket.fulfill). */
export const CATEGORY_PROMPT: Record<TicketCategory, string> = {
  gbp_post: "gbp.post",
  gbp_audit: "gbp.audit",
  review_response: "reviews.response",
  keywords: "keywords.selection",
  content: "content.blog",
  report: "report.monthly",
  general: "ticket.fulfill",
};

/**
 * Ticket lifecycle — the same preview→approve→publish safety model as tasks.
 * The AI drafts to "awaiting_approval" INSIDE SEOOS; nothing goes live until a
 * specialist approves. "needs_info" means the draft is blocked on missing facts.
 */
export const TicketStatus = z.enum([
  "new", // ingested, not yet drafted
  "drafting", // AI is drafting
  "awaiting_approval", // drafted, waiting on the specialist
  "needs_info", // drafted but blocked on missing facts
  "approved", // specialist approved (ready to act on in ClickUp/live)
  "published", // acted on / delivered
  "rejected", // specialist rejected
]);
export type TicketStatus = z.infer<typeof TicketStatus>;

export const TicketV1 = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  tenantId: zTenantId,
  /** Source system + its native id, so re-ingest updates in place (no dupes). */
  source: z.literal("clickup").default("clickup"),
  externalId: z.string().min(1),
  url: z.string().optional(),
  title: z.string().min(1),
  body: z.string().default(""),
  category: TicketCategory.default("general"),
  /** Linked account, when the ticket could be tied to a known client. */
  projectId: z.string().optional(),
  clientId: z.string().optional(),
  clientName: z.string().optional(),
  /** Routed specialist (roster id) + the raw ClickUp assignee for reference. */
  specialistId: z.string().optional(),
  assigneeRaw: z.string().optional(),
  /** The ticket's Department (SEO / Web Development / Ads / …) — context only. */
  department: z.string().optional(),
  clickupStatus: z.string().optional(),
  dueDate: z.string().optional(),
  status: TicketStatus.default("new"),
  /** The drafted deliverable, staged in SEOOS (never published until approved). */
  draft: z.string().optional(),
  /** One-line "what this ticket asks + what I drafted" for the drill-down. */
  detail: z.string().optional(),
  /** Facts the AI needs but wasn't given — surfaced instead of fabricated. */
  needsInfo: z.array(z.string()).default([]),
  decidedByUserId: zUserId.optional(),
  decidedAt: zIsoTimestamp.optional(),
  decisionNote: z.string().optional(),
  ingestedAt: zIsoTimestamp,
  createdAt: zIsoTimestamp,
  updatedAt: zIsoTimestamp,
});
export type TicketV1 = z.infer<typeof TicketV1>;

export const TICKET_OPEN_STATUSES: TicketStatus[] = [
  "new",
  "drafting",
  "awaiting_approval",
  "needs_info",
];
