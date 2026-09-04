import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { ModuleScaffold } from "@/src/components/module-scaffold";
import { UnauthorizedPage } from "@/src/components/states";

export const dynamic = "force-dynamic";

export default async function AuditsPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  return (
    <ModuleScaffold
      authz={authz}
      title="Website Audits"
      subtitle="Technical SEO crawl audits, issue lifecycle, and phase checklists"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Website Audits" }]}
      requiredPermission="seo.package.read"
      phase="Phase 5"
      purpose="Crawl/import via an audit adapter, technical issue inventory with lifecycle, page↔keyword map, and Phase-One/Two optimization checklists with validation."
      blocked={[
        { provider: "website-audit source", requirement: "Screaming Frog or an approved crawl API (feasibility/licensing review pending)" },
        { provider: "google-search-console", requirement: "Search Console access via the shared gateway" },
      ]}
    />
  );
}
