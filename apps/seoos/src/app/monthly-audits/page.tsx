import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { ModuleScaffold } from "@/src/components/module-scaffold";
import { UnauthorizedPage } from "@/src/components/states";

export const dynamic = "force-dynamic";

export default async function MonthlyAuditsPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  return (
    <ModuleScaffold
      authz={authz}
      title="Monthly Audits"
      subtitle="Structured monthly SEO audit book replacing the Excel workbook"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Monthly Audits" }]}
      requiredPermission="seo.package.read"
      phase="Phase 7"
      purpose="Per-client monthly audit: platform connection/usable-data checks, schema/automation/review checks, each item pass/warning/fail/N-A/data-unavailable with evidence and remediation, unresolved items carried forward, QA before publishing into an MTOS package."
    />
  );
}
