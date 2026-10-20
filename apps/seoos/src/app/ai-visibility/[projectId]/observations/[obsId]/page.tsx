import Link from "next/link";
import { notFound } from "next/navigation";

import { AivShell, Denied, pageContext } from "@/src/components/ai-visibility/aiv-shell";
import { EvidenceView } from "@/src/components/ai-visibility/evidence-view";
import { getEvidence } from "@/src/lib/server/ai-visibility/evidence-service";
import { getProfile } from "@/src/lib/server/ai-visibility/profile-service";

export const dynamic = "force-dynamic";

export default async function AivObservationPage({ params }: { params: Promise<{ projectId: string; obsId: string }> }) {
  const { projectId, obsId } = await params;
  const ctx = await pageContext(projectId);
  if ("denied" in ctx) return <Denied />;
  const { authz, project } = ctx;
  const [profile, ev] = await Promise.all([getProfile(authz.tenantId, project.id), getEvidence(authz.tenantId, project.id, obsId)]);
  if (!profile || !ev) notFound();
  return (
    <AivShell authz={authz} project={project} tab="results" subtitle={`Observation ${ev.obs.id}`}>
      <p className="aiv-noprint"><Link href={`/ai-visibility/${project.id}/results`}>← All results</Link></p>
      <EvidenceView obs={ev.obs} profile={profile} attempts={ev.attempts} corrections={ev.corrections} canManage={authz.permissions.includes("seo.project.manage")} />
    </AivShell>
  );
}
