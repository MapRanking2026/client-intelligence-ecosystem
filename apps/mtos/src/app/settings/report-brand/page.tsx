import { AppShell } from "@/src/components/mtos/app-shell";
import { SectionCard } from "@/src/components/mtos/section-card";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getReportBrand } from "@/src/lib/server/services/report-brand-service";

import { ReportBrandClient } from "./report-brand-client";

/**
 * Rendered per request, never prerendered.
 *
 * This page reads one tenant's data behind a session cookie, so a build-time copy of it would
 * be the wrong tenant's page for everyone -- and the build would have to reach Firestore to
 * make it, which is what failed the deploys of 2026-11-02 when the daily read quota ran out.
 * Next cannot infer this on its own here: the session read calls `cookies()` inside a
 * try/catch and skips it entirely when the cookie secret is absent, so on a build without
 * that secret nothing marks the route dynamic and it is prerendered.
 */
export const dynamic = "force-dynamic";

export default async function ReportBrandPage() {
  const brand = await getReportBrand(await resolveTenantContext());

  return (
    <AppShell
      title="Report Branding"
      subtitle="How this workspace's client reports look. Every report generated for this tenant — retention briefs, performance reports — uses this logo, color, and font, so each company's documents come out in their own brand."
    >
      <SectionCard
        eyebrow="Per-tenant identity"
        title="Report brand"
        subtitle="Set your logo, brand color, and font — or seed it all from an existing sample report. The full report palette derives from a single brand color for consistency."
      >
        <ReportBrandClient initialBrand={brand} />
      </SectionCard>
    </AppShell>
  );
}
