import { z } from "zod";
import { zClientId, zIsoTimestamp, zTenantId, zUserId } from "@cie/contracts";

/** Keyword lifecycle within an SEO project. */
export const KeywordStatus = z.enum([
  "proposed",
  "approved",
  "tracking",
  "optimizing",
  "paused",
  "won",
  "retired",
]);
export type KeywordStatus = z.infer<typeof KeywordStatus>;

export const KeywordIntent = z.enum([
  "informational",
  "navigational",
  "commercial",
  "transactional",
  "local",
]);
export type KeywordIntent = z.infer<typeof KeywordIntent>;

/** Statuses that count as "actively tracked" (synced to Rank Tracker). */
export const TRACKED_KEYWORD_STATUSES: KeywordStatus[] = [
  "approved",
  "tracking",
  "optimizing",
  "won",
];

/** Normalize a phrase for dedup (case/space-insensitive). */
export function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, " ");
}

export const KeywordV1 = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  tenantId: zTenantId,
  projectId: z.string().min(1),
  clientId: zClientId,
  phrase: z.string().min(1),
  normalizedPhrase: z.string().min(1),
  status: KeywordStatus.default("proposed"),
  intent: KeywordIntent.optional(),
  group: z.string().optional(),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  locationIds: z.array(z.string()).default([]),
  targetUrl: z.string().optional(),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
  owner: zUserId.optional(),
  createdAt: zIsoTimestamp,
  updatedAt: zIsoTimestamp,
});
export type KeywordV1 = z.infer<typeof KeywordV1>;

export const CreateKeywordInput = z.object({
  projectId: z.string().min(1),
  clientId: zClientId,
  phrase: z.string().min(1),
  intent: KeywordIntent.optional(),
  group: z.string().optional(),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  locationIds: z.array(z.string()).default([]),
  targetUrl: z.string().optional(),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
});
export type CreateKeywordInput = z.infer<typeof CreateKeywordInput>;

export const BulkKeywordAction = z.object({
  keywordIds: z.array(z.string().min(1)).min(1),
  action: z.enum(["set_status", "set_group", "retire"]),
  status: KeywordStatus.optional(),
  group: z.string().optional(),
});
export type BulkKeywordAction = z.infer<typeof BulkKeywordAction>;
