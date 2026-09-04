import type {
  ReportingPeriodV1,
  SeoRequestIdentityV1,
} from "@cie/contracts";

/**
 * Deterministic idempotency + correlation helpers. Identical logical inputs
 * MUST produce identical keys so retries and duplicate Monthly-Touch prep do
 * not create duplicate SEO orders.
 */

function periodToken(p: ReportingPeriodV1): string {
  return `${p.start}_${p.end}`;
}

/** Lowercase, collapse whitespace, and strip separators that vary by caller. */
function norm(part: string): string {
  return part.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * tenant + client + monthlyTouch + capability + presetVersion + reportingPeriod.
 * Stable field order; missing monthlyTouch collapses to the literal "none".
 */
export function makeSeoRequestIdempotencyKey(
  identity: SeoRequestIdentityV1,
): string {
  return [
    "seo-req",
    norm(identity.tenantId),
    norm(identity.clientId),
    norm(identity.monthlyTouchId ?? "none"),
    norm(identity.capability),
    `v${identity.presetVersion}`,
    periodToken(identity.reportingPeriod),
  ].join(":");
}

/** Idempotency key for a package version derived from its request. */
export function makeSeoPackageIdempotencyKey(
  requestIdempotencyKey: string,
  version: number,
): string {
  return `${requestIdempotencyKey}#pkg-v${version}`;
}
