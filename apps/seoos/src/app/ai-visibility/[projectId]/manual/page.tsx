import Link from "next/link";

import { AivShell, Denied, pageContext } from "@/src/components/ai-visibility/aiv-shell";
import { ManualForm } from "@/src/components/ai-visibility/manual-form";
import { EmptyState } from "@/src/components/states";
import { MANUAL_SURFACES } from "@/src/lib/server/ai-visibility/manual-service";
import { getProfile } from "@/src/lib/server/ai-visibility/profile-service";

export const dynamic = "force-dynamic";

export default async function AivManualPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await pageContext(projectId);
  if ("denied" in ctx) return <Denied />;
  const { authz, project } = ctx;
  const profile = await getProfile(authz.tenantId, project.id);
  const base = `/ai-visibility/${project.id}`;
  if (!profile) {
    return (
      <AivShell authz={authz} project={project} tab="manual">
        <EmptyState title="Not set up yet" message="Set up the client profile first." action={<Link href={`${base}/setup`}>Setup →</Link>} />
      </AivShell>
    );
  }
  return (
    <AivShell authz={authz} project={project} tab="manual" subtitle="Channel C — answers or screenshots recorded by an authorized user">
      <p className="aiv-ev">
        Manual observations are analyzed with the same detector but reported only under the “Manual observation” channel. View them in{" "}
        <Link href={`${base}/results?channel=manual`}>Results (manual channel)</Link>.
      </p>
      {authz.permissions.includes("seo.project.manage") ? (
        <ManualForm
          projectId={project.id}
          surfaces={MANUAL_SURFACES}
          services={profile.services.filter((s) => s.status === "approved").map((s) => ({ id: s.id, value: s.value }))}
          locations={profile.locations.filter((l) => l.status === "approved").map((l) => ({ id: l.id, label: `${l.city}${l.region ? `, ${l.region}` : ""}` }))}
        />
      ) : (
        <p className="muted">Recording manual observations requires project permissions.</p>
      )}
    </AivShell>
  );
}
