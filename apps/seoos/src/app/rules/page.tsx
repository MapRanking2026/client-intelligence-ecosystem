import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { Panel, UnauthorizedPage } from "@/src/components/states";
import { RuleLibrary, type RuleRow } from "@/src/components/rule-library";
import { listRuleCatalog } from "@/src/lib/server/rules-service";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  const isAdmin = authz.clientVisibility === "all";
  if (!isAdmin) {
    return (
      <AppShell authz={authz} title="Rule Library" breadcrumbs={[{ label: "SEOOS" }, { label: "Rule Library" }]}>
        <div className="state state--blocked">
          <span className="badge badge--warn">Admin only</span>
          <p className="muted">Only an admin can view and edit the automation thresholds.</p>
        </div>
      </AppShell>
    );
  }

  const rules = (await listRuleCatalog(authz.tenantId)) as RuleRow[];

  return (
    <AppShell
      authz={authz}
      title="Rule Library"
      subtitle="The thresholds that govern the automation — one editable source of truth"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Rule Library" }]}
    >
      <Panel title="How this works">
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Every threshold below is encoded from Map Ranking&apos;s SOPs and is the single source of truth for one
          automation decision — the map-pack dominance rule, GBP description length, review velocity targets, and so
          on. Edit and <strong>Save</strong> and it takes effect immediately. Where the SOPs disagree, the chosen
          value is the default and the alternates are kept beneath each rule so nothing is lost. Admin-only, and
          purely internal — changing a value here never writes anything to ClickUp or Google.
        </p>
      </Panel>
      <RuleLibrary rules={rules} />
    </AppShell>
  );
}
