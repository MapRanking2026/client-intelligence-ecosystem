import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { BlockedExternal, EmptyState, Panel, PhaseNote, StatCard, UnauthorizedPage } from "@/src/components/states";
import { getMapCheckinActivity } from "@/src/lib/server/gateway/client";

export const dynamic = "force-dynamic";

export default async function GbpPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;

  const checkins = await getMapCheckinActivity(authz.tenantId);

  return (
    <AppShell
      authz={authz}
      title="GBP & Local Presence"
      subtitle="GBP performance, reviews, and Map Check-In activity"
      breadcrumbs={[{ label: "SEOOS" }, { label: "GBP & Local Presence" }]}
    >
      <PhaseNote
        phase="Phase 5"
        purpose="GBP performance and profile-change tracking build on the shared connections; Map Check-Ins is wired live through the gateway below."
      />

      <Panel title="Map Check-In activity">
        {!checkins.configured ? (
          <BlockedExternal
            provider="Map Check-Ins (via gateway)"
            requirement="MTOS_GATEWAY_URL + CIE_SERVICE_SECRET set (reuses the shared tenant-wide connection)"
          />
        ) : !checkins.ok || !checkins.activity ? (
          <div className="state state--blocked">
            <span className="badge badge--warn">No Map Check-In data</span>
            <p className="muted">
              {checkins.dataGaps[0]?.reason ?? checkins.error ?? "No connection for this tenant."}
            </p>
          </div>
        ) : checkins.activity.businessCount === 0 ? (
          <EmptyState title="No businesses" message="The Map Check-Ins connection returned no businesses." />
        ) : (
          <>
            <div className="grid-cards" style={{ marginBottom: 14 }}>
              <StatCard label="Businesses" value={checkins.activity.businessCount} />
              <StatCard label="Total posts" value={checkins.activity.totalPosts} />
            </div>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>Business</th>
                    <th>Posts</th>
                    <th>Scheduled</th>
                    <th>Platforms</th>
                    <th>Last post</th>
                    <th>Next scheduled</th>
                  </tr>
                </thead>
                <tbody>
                  {checkins.activity.businesses.map((b) => (
                    <tr key={b.businessName}>
                      <td>{b.businessName}</td>
                      <td>{b.totalPosts}</td>
                      <td>{b.scheduledPosts}</td>
                      <td className="muted">{b.connectedPlatforms.join(", ") || "—"}</td>
                      <td className="muted">{b.lastPostAt ? b.lastPostAt.slice(0, 10) : "—"}</td>
                      <td className="muted">{b.nextScheduledPostAt ? b.nextScheduledPostAt.slice(0, 10) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      <Panel title="GBP performance & reviews">
        <BlockedExternal
          provider="google-business-profile (via gateway)"
          requirement="the GBP normalized adapter exposed through dispatchGatewayResource + gateway config"
        />
      </Panel>
    </AppShell>
  );
}
