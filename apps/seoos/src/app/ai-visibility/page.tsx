import Link from "next/link";

import { AppShell } from "@/src/components/app-shell";
import { EmptyState, UnauthorizedPage } from "@/src/components/states";
import { Disclaimer } from "@/src/components/ai-visibility/aiv-shell";
import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { pct } from "@/src/lib/ai-visibility/util";
import { loadPortfolio } from "@/src/lib/server/ai-visibility/data-service";
import { storeBackend } from "@/src/lib/server/ai-visibility/store";

export const dynamic = "force-dynamic";

export default async function AiVisibilityPortfolio({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const authz = await resolveSeoAuthz();
  if (!authz || !authz.permissions.includes("seo.package.read")) return <UnauthorizedPage />;
  const { q = "", status = "" } = await searchParams;
  const all = await loadPortfolio(authz);
  const rows = all.filter(
    (r) => (!q || r.businessName.toLowerCase().includes(q.toLowerCase())) && (!status || (status === "set_up" ? r.profileStatus !== "not_set_up" : r.profileStatus === status)),
  );
  const setUp = all.filter((r) => r.profileStatus !== "not_set_up").length;
  const measured = all.filter((r) => r.validUnbranded > 0).length;

  return (
    <AppShell
      authz={authz}
      title="AI Visibility"
      subtitle="How often each client appears in AI answers to local buying questions"
      breadcrumbs={[{ label: "SEOOS" }, { label: "AI Visibility" }]}
      actions={authz.permissions.includes("integrations.manage") ? <Link className="aiv-btn" href="/ai-visibility/settings">Providers &amp; caps</Link> : undefined}
    >
      <Disclaimer />
      {storeBackend() === "memory" ? (
        <p className="aiv-msg aiv-msg--error">Persistence is not configured (no Firebase credentials): data is held in memory and will be lost on restart.</p>
      ) : null}
      <div className="aiv-grid">
        <div className="aiv-metric"><div className="aiv-metric-label">Clients visible to you</div><div className="aiv-metric-value">{all.length}</div></div>
        <div className="aiv-metric"><div className="aiv-metric-label">Set up for AI visibility</div><div className="aiv-metric-value">{setUp}</div></div>
        <div className="aiv-metric"><div className="aiv-metric-label">With measured answers</div><div className="aiv-metric-value">{measured}</div><div className="aiv-metric-sub">official API, unbranded</div></div>
      </div>
      <form className="aiv-filters" method="get" action="/ai-visibility">
        <div className="aiv-field" style={{ maxWidth: 360 }}>
          <label htmlFor="q">Search clients</label>
          <input id="q" name="q" defaultValue={q} placeholder="Business name" />
        </div>
        <div className="aiv-field">
          <label htmlFor="st">Status</label>
          <select id="st" name="status" defaultValue={status}>
            <option value="">All</option>
            <option value="set_up">Set up</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="paused">Paused</option>
            <option value="not_set_up">Not set up</option>
          </select>
        </div>
        <button type="submit">Filter</button>
      </form>
      {!all.length ? (
        <EmptyState title="No clients" message="No clients are visible to your account yet." action={<Link href="/clients">Clients →</Link>} />
      ) : (
        <div className="panel aiv-table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Client</th>
                <th>Status</th>
                <th>Last scan</th>
                <th className="num">Valid answers</th>
                <th className="num">Mention rate</th>
                <th className="num">Recommendation rate</th>
                <th>Providers</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.projectId}>
                  <td>
                    <Link href={`/ai-visibility/${r.projectId}`}>{r.businessName}</Link>
                    {r.niche ? <div className="aiv-ev">{r.niche}</div> : null}
                  </td>
                  <td>
                    <span className={`aiv-pill ${r.profileStatus === "active" ? "aiv-pill--ok" : r.profileStatus === "not_set_up" ? "" : "aiv-pill--warn"}`}>{r.profileStatus.replace(/_/g, " ")}</span>
                    {r.runningScans ? <span className="aiv-pill" style={{ marginLeft: 4 }}>scan running</span> : null}
                  </td>
                  <td>
                    {r.lastScanAt ? `${r.lastScanAt.slice(0, 10)} · ${r.lastScanStatus}` : "—"}
                    {r.stale ? <span className="aiv-pill aiv-pill--warn" style={{ marginLeft: 4 }}>stale</span> : null}
                  </td>
                  <td className="num">{r.validUnbranded}</td>
                  <td className="num">{r.validUnbranded ? pct(r.mentionRate) : "—"}</td>
                  <td className="num">{r.validUnbranded ? pct(r.recommendationRate) : "—"}</td>
                  <td>{r.providers.join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length ? <p className="muted">No clients match these filters.</p> : null}
          <p className="aiv-ev">Rates are unbranded, official-API answers across all scans; open a client for sample sizes, intervals and trends. “Stale” = no scan in 35 days.</p>
        </div>
      )}
    </AppShell>
  );
}
