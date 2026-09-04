import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { ModuleScaffold } from "@/src/components/module-scaffold";
import { UnauthorizedPage } from "@/src/components/states";

export const dynamic = "force-dynamic";

export default async function GbpPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  return (
    <ModuleScaffold
      authz={authz}
      title="GBP & Local Presence"
      subtitle="GBP performance, profile changes, reviews, and Map Check-Ins"
      breadcrumbs={[{ label: "SEOOS" }, { label: "GBP & Local Presence" }]}
      requiredPermission="seo.package.read"
      phase="Phase 5"
      purpose="GBP performance and profile-field change tracking, review operations, and Map Check-In activity/coverage — all from real connected sources, reusing the shared MTOS connections."
      blocked={[
        { provider: "google-business-profile", requirement: "GBP data via the shared gateway (GBP has the only live connection test today)" },
        { provider: "map-checkins", requirement: "the shared tenant-wide Map Check-Ins connection" },
      ]}
    />
  );
}
