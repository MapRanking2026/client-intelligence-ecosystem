import Link from "next/link";
import { notFound } from "next/navigation";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, Panel, StatusPill, UnauthorizedPage } from "@/src/components/states";
import { getLatestPackage, getRequest } from "@/src/lib/server/seo-engine";

export const dynamic = "force-dynamic";

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;

  const { requestId } = await params;
  const request = await getRequest(authz.tenantId, requestId);
  if (!request) notFound();
  const pkg = await getLatestPackage(authz.tenantId, requestId);

  return (
    <AppShell
      authz={authz}
      title={`Request · ${request.capability}`}
      breadcrumbs={[
        { label: "SEOOS" },
        { label: "Requests", href: "/requests" },
        { label: request.id },
      ]}
    >
      <Panel title="Request">
        <p style={{ marginTop: 0 }}>
          Client <code>{request.clientId}</code> · <StatusPill status={request.status} /> ·{" "}
          audience {request.intendedAudience} · priority {request.priority} · from {request.requestedByApp}
        </p>
        <p className="muted">
          Period {request.reportingPeriod.start.slice(0, 10)} → {request.reportingPeriod.end.slice(0, 10)}
          {request.reportingPeriod.timezone ? ` (${request.reportingPeriod.timezone})` : ""}
        </p>
        {request.customQuestions.length > 0 ? (
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Custom questions</div>
            <ul>
              {request.customQuestions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="muted" style={{ fontSize: 12 }}>Idempotency: <code>{request.idempotencyKey}</code></p>
      </Panel>

      <Panel title="Package" actions={pkg ? <span className="badge">v{pkg.version}</span> : null}>
        {!pkg ? (
          <EmptyState title="No package yet" message="Fulfillment has not produced a package for this request." />
        ) : (
          <>
            <p style={{ marginTop: 0 }}>
              <span className="badge">confidence: {pkg.overallConfidence}</span>{" "}
              <span className="muted">produced {pkg.producedAt.slice(0, 16).replace("T", " ")}</span>
            </p>
            {pkg.sections.map((s) => (
              <div key={s.key} style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12 }}>
                <h3 style={{ margin: "0 0 6px" }}>
                  {s.title} <span className="badge">{s.confidence}</span>
                </h3>
                <pre style={{ background: "#0c1626", border: "1px solid var(--border)", borderRadius: 8, padding: 12, overflowX: "auto" }}>
                  {JSON.stringify(s.data, null, 2)}
                </pre>
                <p className="muted" style={{ fontSize: 12 }}>{s.evidence.length} evidence ref(s)</p>
              </div>
            ))}
            {pkg.dataGaps.length > 0 ? (
              <p className="muted" style={{ marginTop: 12 }}>
                Data gaps: {pkg.dataGaps.map((g) => g.area).join(", ")}
              </p>
            ) : null}
          </>
        )}
      </Panel>

      <p><Link href="/requests">← Back to inbox</Link></p>
    </AppShell>
  );
}
