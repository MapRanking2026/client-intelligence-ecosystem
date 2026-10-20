import Link from "next/link";

import { AivShell, Denied, pageContext } from "@/src/components/ai-visibility/aiv-shell";
import { PromptLibrary } from "@/src/components/ai-visibility/prompt-library";
import { EmptyState } from "@/src/components/states";
import { getProfile } from "@/src/lib/server/ai-visibility/profile-service";
import { listPrompts } from "@/src/lib/server/ai-visibility/prompt-service";

export const dynamic = "force-dynamic";

export default async function AivPromptsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await pageContext(projectId);
  if ("denied" in ctx) return <Denied />;
  const { authz, project } = ctx;
  const profile = await getProfile(authz.tenantId, project.id);
  if (!profile) {
    return (
      <AivShell authz={authz} project={project} tab="prompts">
        <EmptyState title="Not set up yet" message="Set up the client profile first." action={<Link href={`/ai-visibility/${project.id}/setup`}>Setup →</Link>} />
      </AivShell>
    );
  }
  const prompts = await listPrompts(authz.tenantId, project.id);
  const services = profile.services.filter((s) => s.status === "approved").map((s) => ({ id: s.id, value: s.value }));
  const locations = profile.locations.filter((l) => l.status === "approved").map((l) => ({ id: l.id, label: `${l.city}${l.region ? `, ${l.region}` : ""}` }));
  return (
    <AivShell authz={authz} project={project} tab="prompts" subtitle="Versioned prompts; scans record the exact version sent">
      {!services.length || !locations.length ? (
        <p className="aiv-msg aiv-msg--error">Approve at least one service and one location in <Link href={`/ai-visibility/${project.id}/setup`}>Setup</Link> to generate prompts.</p>
      ) : null}
      <PromptLibrary projectId={project.id} prompts={prompts} canManage={authz.permissions.includes("seo.project.manage")} services={services} locations={locations} bilingual={profile.bilingualLanguage === "es"} />
    </AivShell>
  );
}
