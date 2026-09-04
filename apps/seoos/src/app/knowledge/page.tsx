import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { ModuleScaffold } from "@/src/components/module-scaffold";
import { UnauthorizedPage } from "@/src/components/states";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  return (
    <ModuleScaffold
      authz={authz}
      title="Knowledge / Niche Studies"
      subtitle="Niche studies and case knowledge via the shared Knowledge Base"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Knowledge" }]}
      requiredPermission="seo.package.read"
      phase="Phase 9"
      purpose="Search/browse niche studies, case studies, and approved Drive/ClickUp knowledge through the existing Knowledge Base retrieval interfaces, with source/permissions/citations and no cross-tenant leakage."
      blocked={[{ provider: "knowledge-base", requirement: "the shared Knowledge Base retrieval interface exposed through the gateway" }]}
    />
  );
}
