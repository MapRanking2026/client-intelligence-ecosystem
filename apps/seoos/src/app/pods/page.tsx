import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { Panel, UnauthorizedPage } from "@/src/components/states";
import { PodAssignForm } from "@/src/components/pod-assign-form";
import { listPods } from "@/src/lib/server/pods-service";
import { getUserRepo } from "@/src/lib/server/repositories/user-repo";

export const dynamic = "force-dynamic";

export default async function PodsPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;

  const isAdmin = authz.clientVisibility === "all";
  if (!isAdmin) {
    return (
      <AppShell authz={authz} title="Pods" breadcrumbs={[{ label: "SEOOS" }, { label: "Pods" }]}>
        <div className="state state--blocked">
          <span className="badge badge--warn">Admin only</span>
          <p className="muted">Only an admin can assign pods to specialists.</p>
        </div>
      </AppShell>
    );
  }

  const [pods, users] = await Promise.all([
    listPods(authz.tenantId),
    getUserRepo().list(authz.tenantId),
  ]);
  const userOptions = users
    .filter((u) => !u.disabled)
    .map((u) => ({ userId: u.userId, email: u.email, displayName: u.displayName ?? u.email }));

  return (
    <AppShell
      authz={authz}
      title="Pods"
      subtitle="Assign each ClickUp pod to an SEO specialist"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Pods" }]}
    >
      <Panel title={`Pods (${pods.length})`}>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Pods are read from ClickUp&apos;s SEO Dashboard <strong>⭐ Pod</strong> field. Assign a
          specialist to a pod and, on their next visit, they&apos;ll see every client in that pod on
          the Clients page. Admins always see all clients.
        </p>
        <PodAssignForm pods={pods} users={userOptions} />
      </Panel>
    </AppShell>
  );
}
