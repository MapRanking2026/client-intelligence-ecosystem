import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { ModuleScaffold } from "@/src/components/module-scaffold";
import { UnauthorizedPage } from "@/src/components/states";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  return (
    <ModuleScaffold
      authz={authz}
      title="Team / Settings"
      subtitle="Assignments, roles/permissions, flags, prompt management, and audit log"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Team / Settings" }]}
      requiredPermission="settings.manage"
      phase="Phase 9"
      purpose="SEO team assignments and workload, app memberships/permissions, capability catalog, scan schedules, freshness thresholds, feature flags, SEOOS prompt management (shared Prompt Engine discipline), and the audit log for sensitive actions."
    />
  );
}
