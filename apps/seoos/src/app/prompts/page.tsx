import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { Panel, UnauthorizedPage } from "@/src/components/states";
import { PromptEngine, type PromptRow } from "@/src/components/prompt-engine";
import { listPromptCatalog } from "@/src/lib/server/prompts-service";

export const dynamic = "force-dynamic";

export default async function PromptsPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  const isAdmin = authz.clientVisibility === "all";
  if (!isAdmin) {
    return (
      <AppShell authz={authz} title="Prompt Engine" breadcrumbs={[{ label: "SEOOS" }, { label: "Prompt Engine" }]}>
        <div className="state state--blocked">
          <span className="badge badge--warn">Admin only</span>
          <p className="muted">Only an admin can view and edit the AI prompts.</p>
        </div>
      </AppShell>
    );
  }

  const prompts = (await listPromptCatalog(authz.tenantId)) as PromptRow[];

  return (
    <AppShell
      authz={authz}
      title="Prompt Engine"
      subtitle="The instructions that govern every AI action — editable, live"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Prompt Engine" }]}
    >
      <Panel title="How this works">
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Each prompt below is the source of truth for one AI action. Edit and <strong>Save</strong> and it takes
          effect immediately — the next time that action runs, it follows exactly what&apos;s written here. Every
          AI call also automatically applies the account&apos;s <strong>specialist style</strong> on top, so drafts
          match whoever the client belongs to. Admin-only.
        </p>
      </Panel>
      <PromptEngine prompts={prompts} />
    </AppShell>
  );
}
