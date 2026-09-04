import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { ModuleScaffold } from "@/src/components/module-scaffold";
import { UnauthorizedPage } from "@/src/components/states";

export const dynamic = "force-dynamic";

export default async function WorkOrdersPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  return (
    <ModuleScaffold
      authz={authz}
      title="Work Orders & Deliverables"
      subtitle="Work lifecycle, QA, and ClickUp reconciliation"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Work Orders" }]}
      requiredPermission="seo.package.read"
      phase="Phase 6"
      purpose="Recommendation → approved work order → assignment → delivery → QA → completion evidence, with list/board/calendar views. ClickUp writes remain behind the existing human-approval gate."
      blocked={[{ provider: "clickup", requirement: "the shared ClickUp connection via the gateway (writes stay human-approved)" }]}
    />
  );
}
