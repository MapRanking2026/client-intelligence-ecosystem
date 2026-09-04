/**
 * Per-tenant report branding. Reports (retention, performance, and future types)
 * read this config so each tenant's documents come out in THEIR brand — logo,
 * colors, font, company name — rather than a single hard-coded look. When a
 * tenant has not configured a brand, we fall back to the MapRanking defaults,
 * so nothing breaks before a tenant customizes it.
 *
 * The prompt library is global (see prompt-store.ts); branding is deliberately
 * tenant-scoped and lives here instead, keyed under tenants/{id}/settings.
 */
import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { reportBrandPath } from "@/src/lib/server/firebase/collections";

export interface ReportBrandColors {
  /** Cover background + dark strips. */
  navy: string;
  /** Section heading strips. */
  blueDeep: string;
  /** Table headers / sub-headers. */
  blueMid: string;
  /** Primary accent (links, header rule). */
  blue: string;
  /** Bright accent / eyebrow labels. */
  blueBright: string;
  /** Alternating light cell background. */
  bluePale: string;
  blueBg: string;
}

export interface ReportBrand {
  /** Company name shown in the header and cover (e.g. "MapRanking"). */
  companyName: string;
  /** Default report-type label on the cover (e.g. "Local SEO Performance Report"). */
  reportTypeLabelDefault: string;
  /** Footer left text (e.g. "Confidential  |  mapranking.com"). */
  footerText: string;
  /** Font family used throughout — must be Word-safe / offline (e.g. "Arial"). */
  font: string;
  /** The single brand color the palette is derived from (hex, no #). Shown in the editor. */
  primaryColor: string;
  colors: ReportBrandColors;
  /**
   * Base64 PNG data URL of the tenant's logo. Undefined = use the built-in
   * default MapRanking logo bundled with the report generator.
   */
  logoDataUrl?: string;
  updatedAt?: string;
  updatedBy?: string;
}

/** The default brand — the MapRanking report look, used until a tenant customizes theirs. */
export const MAPRANKING_BRAND: ReportBrand = {
  companyName: "MapRanking",
  reportTypeLabelDefault: "Local SEO Performance Report",
  footerText: "Confidential  |  mapranking.com",
  font: "Arial",
  primaryColor: "1a73e8",
  colors: {
    navy: "0d1b2a",
    blueDeep: "0d47a1",
    blueMid: "1565c0",
    blue: "1a73e8",
    blueBright: "2979ff",
    bluePale: "d0e4ff",
    blueBg: "e8f0fd",
  },
};

/** Merge a stored (partial) brand over the defaults so a half-configured brand still renders. */
function withBrandDefaults(data: Partial<ReportBrand> | undefined): ReportBrand {
  return {
    ...MAPRANKING_BRAND,
    ...(data || {}),
    colors: { ...MAPRANKING_BRAND.colors, ...(data?.colors || {}) },
  };
}

export async function getReportBrand(context: TenantContext): Promise<ReportBrand> {
  const db = getFirebaseAdminDb();
  if (!db) return MAPRANKING_BRAND;
  try {
    const snapshot = await db.doc(reportBrandPath(context.tenantId)).get();
    if (!snapshot.exists) return MAPRANKING_BRAND;
    return withBrandDefaults(snapshot.data() as Partial<ReportBrand>);
  } catch {
    // Branding is non-critical — never let a config read failure block a report.
    return MAPRANKING_BRAND;
  }
}

export async function saveReportBrand(
  context: TenantContext,
  patch: Partial<ReportBrand>,
): Promise<ReportBrand> {
  const db = getFirebaseAdminDb();
  if (!db) throw new Error("Storage is not configured.");
  const update: Record<string, unknown> = {
    ...patch,
    updatedAt: new Date().toISOString(),
    updatedBy: context.userId,
  };
  // Firestore rejects undefined values.
  for (const key of Object.keys(update)) {
    if (update[key] === undefined) delete update[key];
  }
  await db.doc(reportBrandPath(context.tenantId)).set(update, { merge: true });
  return getReportBrand(context);
}
