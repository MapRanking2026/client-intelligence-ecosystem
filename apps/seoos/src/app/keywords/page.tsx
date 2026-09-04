import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { ModuleScaffold } from "@/src/components/module-scaffold";
import { UnauthorizedPage } from "@/src/components/states";

export const dynamic = "force-dynamic";

export default async function KeywordsPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  return (
    <ModuleScaffold
      authz={authz}
      title="Keywords"
      subtitle="Discovery, grouping, mapping, approval, and Rank Tracker sync"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Keywords" }]}
      requiredPermission="seo.package.read"
      phase="Phase 4"
      purpose="Keyword CRUD, CSV import/export, dedup, clustering, service/page mapping, approval, and one-way sync to Rank Tracker."
      blocked={[{ provider: "rank-tracker", requirement: "Rank Tracker access via the shared MTOS integration gateway" }]}
    />
  );
}
