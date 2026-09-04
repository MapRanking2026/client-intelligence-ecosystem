import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { ModuleScaffold } from "@/src/components/module-scaffold";
import { UnauthorizedPage } from "@/src/components/states";

export const dynamic = "force-dynamic";

export default async function RecommendationsPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  return (
    <ModuleScaffold
      authz={authz}
      title="Recommendations"
      subtitle="Evidence-grounded AI recommendations with approval and work-order conversion"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Recommendations" }]}
      requiredPermission="seo.package.read"
      phase="Phase 6"
      purpose="AI strategist over normalized evidence (grids, rankings, GBP, audits, verified lead/call outcomes) via the shared Prompt Engine. Every item carries evidence, rationale, impact, confidence, dependencies, and approval — with edit/approve/reject/defer and conversion to work. AI never completes or publishes without human confirmation."
    />
  );
}
