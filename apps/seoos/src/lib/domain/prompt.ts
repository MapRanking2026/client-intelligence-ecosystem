import { z } from "zod";
import { zIsoTimestamp, zTenantId, zUserId } from "@cie/contracts";

/**
 * A governing prompt for one AI action. The admin-edited template (when present)
 * overrides the built-in default and takes effect immediately — it is the single
 * source of truth for how the AI performs that task. Every AI call also appends
 * the account's specialist style directive (handled by the executor).
 */
export const PromptV1 = z.object({
  schemaVersion: z.literal(1),
  tenantId: zTenantId,
  /** Stable action key, e.g. "gbp.post". Firestore doc id. */
  key: z.string().min(1),
  template: z.string().min(1),
  updatedAt: zIsoTimestamp,
  updatedByUserId: zUserId.optional(),
});
export type PromptV1 = z.infer<typeof PromptV1>;

export interface PromptDef {
  key: string;
  category: string;
  name: string;
  description: string;
  /** Built-in default; used until an admin saves an override. */
  template: string;
}

/**
 * Default prompt catalog — the instructions for each AI action, grouped by area.
 * The executor appends the task data and the specialist style directive; these
 * templates carry only the instruction. Admins edit them in the Prompt Engine.
 */
export const DEFAULT_PROMPTS: PromptDef[] = [
  {
    key: "recommendations.generate",
    category: "Recommendations",
    name: "Generate recommendations from grids",
    description: "Turns the grid/ranking snapshot + niche context into proposed tactical actions.",
    template: [
      "You are a senior local-SEO strategist for a Google Business Profile / map-pack agency.",
      "Propose specific, tactical, defensible actions grounded ONLY in the data provided — never invent metrics.",
      "Favor concrete, executable actions tied to the weakest grid keywords: a GBP post to write (title/angle),",
      "an image to add or RENAME to a keyword-rich file name, a per-keyword move, category/service changes,",
      "on-page content, schema, or review operations. Apply any niche playbooks provided.",
      "Return STRICT JSON only, no prose or code fences, matching the requested shape.",
    ].join(" "),
  },
  {
    key: "gbp.post",
    category: "Google Business Profile",
    name: "Draft a GBP post",
    description: "Writes a Google Business Profile post for a target keyword.",
    template: [
      "Write a Google Business Profile post for this local business and target keyword.",
      "Keep it 1500 characters max, natural and specific to the business — no keyword stuffing.",
      "Include a clear call to action. Do not invent offers, prices, or claims not supported by the data.",
      "Return the post text only.",
    ].join(" "),
  },
  {
    key: "gbp.audit",
    category: "Google Business Profile",
    name: "GBP 100% audit write-up",
    description: "Summarizes the GBP optimization checklist into findings + fixes.",
    template: [
      "Audit this Google Business Profile against the local-SEO 'GBP 100%' checklist (NAP, categories,",
      "title, services, products, description, hours, photos, reviews, schema, citations).",
      "For each gap, state the issue plainly and the exact fix. Ground every finding in the data provided.",
      "Return concise findings a specialist can action.",
    ].join(" "),
  },
  {
    key: "content.service_page",
    category: "Content",
    name: "Service / city page copy",
    description: "Drafts on-page copy for a service or city landing page.",
    template: [
      "Draft on-page copy for a local service/city page: an H1, intro, service detail, a local-relevance",
      "paragraph, and an FAQ. Optimize for the target keyword and location without stuffing.",
      "Only use facts present in the data. Return clean sections with headings.",
    ].join(" "),
  },
  {
    key: "content.blog",
    category: "Content",
    name: "Blog post (AI authority)",
    description: "Drafts a topical authority blog post (Map Sense).",
    template: [
      "Write a helpful, original blog post that builds topical authority for this local business's niche.",
      "Lead with the reader's problem; be specific and useful; include a natural CTA. No fabricated stats.",
      "Return a title and the article body with subheadings.",
    ].join(" "),
  },
  {
    key: "reviews.response",
    category: "Reviews",
    name: "Review response",
    description: "Drafts a reply to a customer review.",
    template: [
      "Write a short, warm, professional reply to this customer review. Thank the reviewer, be specific to",
      "what they said, and keep it human. For negative reviews, acknowledge, take it offline, and never be",
      "defensive. No fabricated details. Return the reply only.",
    ].join(" "),
  },
  {
    key: "keywords.selection",
    category: "Keywords",
    name: "Keyword selection",
    description: "Selects grid keywords / clusters per the SOP.",
    template: [
      "Select the highest-value local keywords for this business's grid, per the SOP: prioritize commercial",
      "intent, local + service combinations, and realistic ranking difficulty. Group into clusters.",
      "Use only the business's real services/location. Return the keyword list grouped by cluster.",
    ].join(" "),
  },
  {
    key: "report.monthly",
    category: "Reports",
    name: "Monthly report narrative",
    description: "Writes the client-facing narrative for the monthly report.",
    template: [
      "Write a concise, client-facing narrative for this monthly SEO report. Explain what moved and why in",
      "plain language, celebrate real wins, and set the next month's focus. Never fabricate figures — use only",
      "the metrics provided. Keep it brief and non-technical.",
    ].join(" "),
  },
];

export function getDefaultPrompt(key: string): PromptDef | undefined {
  return DEFAULT_PROMPTS.find((p) => p.key === key);
}
