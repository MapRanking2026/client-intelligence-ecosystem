import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { ModuleScaffold } from "@/src/components/module-scaffold";
import { UnauthorizedPage } from "@/src/components/states";

export const dynamic = "force-dynamic";

export default async function RankingsPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  return (
    <ModuleScaffold
      authz={authz}
      title="Rankings & Grids"
      subtitle="Average rank, coverage, market share, and grid/heatmap analysis"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Rankings & Grids" }]}
      requiredPermission="seo.package.read"
      phase="Phase 4"
      purpose="Rankings with period comparison, top-3/10 coverage, share of local voice, winners/decliners, and grid heatmaps with competitor overlays. Historical gaps are labeled, never fabricated."
      blocked={[
        { provider: "rank-tracker", requirement: "Rank Tracker access via the shared gateway" },
        { provider: "geogrid", requirement: "a completed GeoGrid sync branch (no live sync in the audited source)" },
      ]}
    />
  );
}
