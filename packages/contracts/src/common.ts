import { z } from "zod";

/**
 * Shared primitives for every Client Intelligence Ecosystem contract.
 *
 * Design rules (see docs/architecture/mtos-seoos-boundaries.md):
 * - Every durable record carries an explicit integer `schemaVersion` literal so
 *   readers can branch and corrections make a *new* version instead of mutating.
 * - Timestamps are ISO-8601 strings (UTC). We validate shape without pulling a
 *   date library into the contract layer.
 * - Identity is tenant-scoped; nothing crosses tenants.
 */

/** Which app produced or authorized a change. Memberships are additive. */
export const AppId = z.enum(["mtos", "seoos"]);
export type AppId = z.infer<typeof AppId>;

/** ISO-8601 timestamp (UTC). Kept as a string across process/app boundaries. */
export const zIsoTimestamp = z
  .string()
  .refine(
    (v) => !Number.isNaN(Date.parse(v)),
    "Must be an ISO-8601 timestamp",
  );
export type IsoTimestamp = z.infer<typeof zIsoTimestamp>;

/** Non-empty, trimmed identifier string. */
export const zId = z.string().trim().min(1);

export const zTenantId = zId;
export const zClientId = zId;
export const zUserId = zId;

/** Ties related requests/packages/events together across apps and retries. */
export const zCorrelationId = zId;

/** Deterministic dedup key — identical inputs must yield an identical key. */
export const zIdempotencyKey = zId;

/**
 * Canonical sort direction for any time-ordered list surfaced in either app.
 * `newest_first` is the product default.
 */
export const SortDirection = z.enum(["newest_first", "oldest_first"]);
export type SortDirection = z.infer<typeof SortDirection>;
export const DEFAULT_SORT_DIRECTION: SortDirection = "newest_first";

/** Half-open reporting window [start, end). */
export const ReportingPeriodV1 = z
  .object({
    start: zIsoTimestamp,
    end: zIsoTimestamp,
    /** IANA timezone the window is expressed in (e.g. "America/New_York"). */
    timezone: z.string().min(1).optional(),
  })
  .refine((p) => Date.parse(p.start) <= Date.parse(p.end), {
    message: "Reporting period start must not be after end",
    path: ["end"],
  });
export type ReportingPeriodV1 = z.infer<typeof ReportingPeriodV1>;

/** Opaque, forward-only pagination cursor. */
export const zCursor = z.string().min(1);

export const PageRequest = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  cursor: zCursor.optional(),
});
export type PageRequest = z.infer<typeof PageRequest>;

/** Build a validated page-result schema for a given item schema. */
export function pageResult<TItem extends z.ZodTypeAny>(item: TItem) {
  return z.object({
    items: z.array(item),
    nextCursor: zCursor.nullable(),
    /** Timezone the caller should render timestamps in (IANA name). */
    timezone: z.string().min(1),
  });
}
