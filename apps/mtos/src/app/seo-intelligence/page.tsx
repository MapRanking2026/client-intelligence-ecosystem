import { AppShell } from "@/src/components/mtos/app-shell";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getServerEnv } from "@/src/lib/server/env";
import { SeoIntelligenceRequestForm } from "@/src/components/mtos/seo-intelligence-request-form";
import {
  getMtosReceivedPackage,
  listMtosSeoRequests,
} from "@/src/lib/server/seo-intelligence/request-service";

export const dynamic = "force-dynamic";

export default async function SeoIntelligencePage() {
  const env = getServerEnv();
  if (!env.seoosEnabled) {
    return (
      <AppShell title="SEO Intelligence" subtitle="Request structured SEO packages from SEOOS">
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-200">
          SEOOS is not enabled for this tenant. Set <code>SEOOS_ENABLED=true</code> to request packages.
        </div>
      </AppShell>
    );
  }

  const context = await resolveTenantContext();
  const requests = await listMtosSeoRequests(context);
  const withPackages = await Promise.all(
    requests.slice(0, 25).map(async (r) => ({ request: r, pkg: await getMtosReceivedPackage(context, r.id) })),
  );

  return (
    <AppShell title="SEO Intelligence" subtitle="Order a package from the SEO team; consume it when ready">
      <div className="space-y-6">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-white/80">Request a package</h2>
          <SeoIntelligenceRequestForm />
          <p className="mt-2 text-xs text-white/50">
            Requests are idempotency-keyed (tenant + client + capability + period), so re-requesting the
            same prep never double-orders. SEOOS fulfills and delivers the immutable package back here.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-white/80">Recent requests</h2>
          {withPackages.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-white/50">
              No requests yet. Requests require the shared Firestore transport; when it isn&apos;t configured
              they aren&apos;t persisted.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <thead className="text-left text-white/50">
                  <tr>
                    <th className="p-2">Client</th>
                    <th className="p-2">Capability</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Package</th>
                    <th className="p-2">Freshness</th>
                  </tr>
                </thead>
                <tbody>
                  {withPackages.map(({ request: r, pkg }) => (
                    <tr key={r.id} className="border-t border-white/10">
                      <td className="p-2">{r.clientId}</td>
                      <td className="p-2">{r.capability}</td>
                      <td className="p-2">{r.status}</td>
                      <td className="p-2 text-white/60">{pkg ? `v${pkg.version}` : "—"}</td>
                      <td className="p-2 text-white/60">{pkg ? pkg.overallConfidence : "pending"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
