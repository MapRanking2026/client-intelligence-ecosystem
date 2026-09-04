import { z } from "zod";
import { PermissionScope } from "./identity";
import { SeoCapabilityId } from "./seo-request";

/**
 * SeoCapability — the "menu" MTOS orders from. Versioned metadata describing
 * each capability's inputs, windows, filters, data sources, whether it can use
 * cached data or needs a new scan, whether it can incur cost/side effects, and
 * the permission/approval it requires.
 */

export const SeoCapabilityV1 = z.object({
  schemaVersion: z.literal(1),
  id: SeoCapabilityId,
  version: z.number().int().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  requiredInputs: z.array(z.string()).default([]),
  supportedWindows: z
    .array(z.enum(["last_7d", "last_30d", "last_60d", "last_90d", "custom"]))
    .default(["last_30d"]),
  supportedFilters: z
    .object({
      keywords: z.boolean().default(false),
      locations: z.boolean().default(false),
      gbpProfiles: z.boolean().default(false),
      competitors: z.boolean().default(false),
    })
    .default({
      keywords: false,
      locations: false,
      gbpProfiles: false,
      competitors: false,
    }),
  dataSources: z.array(z.string()).default([]),
  /** Can be fulfilled from already-synced/cached data. */
  cacheable: z.boolean().default(true),
  /** Requires a fresh scan (may be paid / consequential). */
  requiresNewScan: z.boolean().default(false),
  canCauseCost: z.boolean().default(false),
  canCauseSideEffect: z.boolean().default(false),
  requiredPermission: PermissionScope.default("seo.package.read"),
  requiredApproval: z.boolean().default(false),
  availability: z.string().default("Fulfilled from synced data"),
});
export type SeoCapabilityV1 = z.infer<typeof SeoCapabilityV1>;
