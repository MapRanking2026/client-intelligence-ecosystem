import Link from "next/link";

import { AivShell, Denied, pageContext } from "@/src/components/ai-visibility/aiv-shell";
import { SafeLink } from "@/src/components/ai-visibility/evidence-view";
import { FilterBar } from "@/src/components/ai-visibility/filter-bar";
import { EmptyState } from "@/src/components/states";
import { effectiveEntities, validity } from "@/src/lib/ai-visibility/effective";
import { filterToQuery, parseViewFilter } from "@/src/lib/ai-visibility/filters";
import { applyFilter } from "@/src/lib/ai-visibility/metrics";
import { hostMatchesDomain, normalizeDomain } from "@/src/lib/ai-visibility/url";
import { loadProjectData } from "@/src/lib/server/ai-visibility/data-service";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AivCitationsPage({ params, searchParams }: Props) {
  const { projectId } = await params;
  const ctx = await pageContext(projectId);
  if ("denied" in ctx) return <Denied />;
  const { authz, project } = ctx;
  const data = await loadProjectData(authz.tenantId, project.id);
  const base = `/ai-visibility/${project.id}`;
  if (!data.profile) {
    return (
      <AivShell authz={authz} project={project} tab="citations">
        <EmptyState title="Not set up yet" message="Set up the client profile first." action={<Link href={`${base}/setup`}>Setup →</Link>} />
      </AivShell>
    );
  }
  const profile = data.profile;
  const f = parseViewFilter(await searchParams);
  const { flag: _f, ...mf } = f;
  void _f;
  const valid = applyFilter(data.observations, mf).filter((o) => validity(o) === "valid");
  const owned = profile.ownedDomains.filter((d) => d.status === "approved").map((d) => normalizeDomain(d.value));
  const compDomains = profile.competitors.map((c) => ({ name: c.name, domains: c.domains.map(normalizeDomain) }));
  const kindOf = (domain: string) => {
    if (owned.some((d) => hostMatchesDomain(domain, d))) return "Client-owned";
    const c = compDomains.find((x) => x.domains.some((d) => hostMatchesDomain(domain, d)));
    return c ? `Competitor (${c.name})` : "Third-party";
  };

  const domains = new Map<string, { answers: Set<string>; clientMentioned: number; clientAbsent: number }>();
  const pages = new Map<string, { url: string; title?: string; domain: string; answers: Set<string>; supports: Set<string> }>();
  for (const o of valid) {
    const ents = effectiveEntities(o);
    const clientIn = Boolean(ents.find((e) => e.entityKey === "client")?.mentioned);
    const seen = new Set<string>();
    for (const c of o.citations) {
      if (!seen.has(c.domain)) {
        seen.add(c.domain);
        const d = domains.get(c.domain) ?? { answers: new Set(), clientMentioned: 0, clientAbsent: 0 };
        d.answers.add(o.id);
        if (clientIn) d.clientMentioned += 1;
        else d.clientAbsent += 1;
        domains.set(c.domain, d);
      }
      const p = pages.get(c.normalizedUrl) ?? { url: c.url, title: c.title, domain: c.domain, answers: new Set(), supports: new Set() };
      p.answers.add(o.id);
      for (const e of ents) if (e.mentioned && e.thirdPartyCitationUrls.includes(c.normalizedUrl)) p.supports.add(e.name);
      pages.set(c.normalizedUrl, p);
    }
  }
  const domainRows = [...domains].sort((a, b) => b[1].answers.size - a[1].answers.size);
  const pageRows = [...pages].sort((a, b) => b[1].answers.size - a[1].answers.size).slice(0, 100);

  return (
    <AivShell authz={authz} project={project} tab="citations" subtitle="Websites and pages the providers cited in valid answers">
      <FilterBar action={`${base}/citations`} filter={f} profile={profile} observations={data.observations} scans={data.scans} />
      {!valid.length ? (
        <EmptyState title="No valid answers" message="Run a scan to collect citations." action={<Link href={`${base}/scans`}>Scans →</Link>} />
      ) : (
        <>
          <section className="panel aiv-table-wrap">
            <h2 className="panel-title">Cited domains ({domainRows.length})</h2>
            <p className="aiv-ev">Counts are answers citing the domain at least once, across {valid.length} valid answers. Citation order is not a ranking.</p>
            <table className="data">
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Type</th>
                  <th className="num">Answers citing</th>
                  <th className="num">…client mentioned</th>
                  <th className="num">…client absent</th>
                </tr>
              </thead>
              <tbody>
                {domainRows.map(([d, r]) => (
                  <tr key={d}>
                    <td><Link href={`${base}/results${filterToQuery({ ...f, flag: `cites:${d}` })}`}>{d}</Link></td>
                    <td>{kindOf(d)}</td>
                    <td className="num">{r.answers.size}</td>
                    <td className="num">{r.clientMentioned}</td>
                    <td className="num">{r.clientAbsent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="panel aiv-table-wrap">
            <h2 className="panel-title">Cited pages (top {pageRows.length})</h2>
            <table className="data">
              <thead>
                <tr>
                  <th>Page</th>
                  <th>Type</th>
                  <th className="num">Answers</th>
                  <th>Supports mentions of</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pageRows.map(([n, p]) => (
                  <tr key={n}>
                    <td style={{ maxWidth: 420, fontSize: 13 }}>
                      <SafeLink href={p.url}>{p.title || p.url}</SafeLink>
                      <div className="aiv-ev">{n}</div>
                    </td>
                    <td>{kindOf(p.domain)}</td>
                    <td className="num">{p.answers.size}</td>
                    <td style={{ fontSize: 13 }}>{[...p.supports].join(", ") || "—"}</td>
                    <td><Link href={`${base}/results${filterToQuery({ ...f, flag: `url:${n}` })}`}>Evidence</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="aiv-ev">“Supports” = the provider attached this citation to the passage naming that business, or the page title/snippet names it.</p>
          </section>
        </>
      )}
    </AivShell>
  );
}
