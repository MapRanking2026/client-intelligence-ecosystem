import { AivShell, Denied, pageContext } from "@/src/components/ai-visibility/aiv-shell";
import { ProfileEditor } from "@/src/components/ai-visibility/profile-editor";
import { InitProfileButton } from "@/src/components/ai-visibility/small-actions";
import { EmptyState } from "@/src/components/states";
import { listAudit } from "@/src/lib/server/ai-visibility/audit";
import { activationCheck, getProfile } from "@/src/lib/server/ai-visibility/profile-service";
import { listProviderStatus } from "@/src/lib/server/ai-visibility/settings-service";

export const dynamic = "force-dynamic";

export default async function AivSetupPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await pageContext(projectId);
  if ("denied" in ctx) return <Denied />;
  const { authz, project } = ctx;
  const canManage = authz.permissions.includes("seo.project.manage");
  const profile = await getProfile(authz.tenantId, project.id);
  if (!profile) {
    return (
      <AivShell authz={authz} project={project} tab="setup">
        <EmptyState title="Not set up yet" message="Create the measurement profile for this client." action={canManage ? <InitProfileButton projectId={project.id} /> : undefined} />
      </AivShell>
    );
  }
  const [providers, events] = await Promise.all([listProviderStatus(authz.tenantId), listAudit(authz.tenantId, project.id, 40)]);
  return (
    <AivShell authz={authz} project={project} tab="setup" subtitle="Review and approve what is measured. Suggestions are never used until approved.">
      <p className="aiv-ev">
        Client record: <strong>{project.businessName}</strong> (canonical client <code>{project.clientId}</code>){project.website ? ` · ${project.website}` : ""}. Identity comes from the SEOOS/CIE client record; this page only adds measurement configuration.
      </p>
      {canManage ? (
        <ProfileEditor
          projectId={project.id}
          initial={profile}
          providers={providers.map((p) => ({ providerId: p.providerId, displayName: p.displayName, ready: p.ready, readyReason: p.readyReason }))}
          check={activationCheck(profile)}
        />
      ) : (
        <pre className="aiv-raw">{JSON.stringify({ ...profile, tenantId: undefined }, null, 2)}</pre>
      )}
      <section className="panel">
        <details>
          <summary style={{ cursor: "pointer" }}>Audit log ({events.length})</summary>
          <table className="data" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>When (UTC)</th>
                <th>Who</th>
                <th>Action</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>{e.at.slice(0, 19).replace("T", " ")}</td>
                  <td>{e.actor}</td>
                  <td>{e.action}</td>
                  <td style={{ fontSize: 12 }}><code>{JSON.stringify(e.detail).slice(0, 300)}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>
    </AivShell>
  );
}
