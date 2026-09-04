import Link from "next/link";
import { notFound } from "next/navigation";

import { isSeoosRequestsEnabled } from "@/src/lib/flags";
import { DEMO_TENANT } from "@/src/lib/server/context";
import {
  getLatestPackageSync,
  getRequestSync,
} from "@/src/lib/server/seo-engine";

export const dynamic = "force-dynamic";

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  if (!isSeoosRequestsEnabled()) {
    return (
      <main className="wrap">
        <div className="panel">
          <span className="badge">SEOOS requests disabled</span>
        </div>
      </main>
    );
  }

  const { requestId } = await params;
  const request = getRequestSync(DEMO_TENANT, requestId);
  if (!request) notFound();
  const pkg = getLatestPackageSync(DEMO_TENANT, requestId);

  return (
    <main className="wrap">
      <p>
        <Link href="/requests">← Requests</Link>
      </p>
      <h1>Request {request.id}</h1>
      <div className="panel">
        <p>
          <strong>{request.capability}</strong> · client{" "}
          <code>{request.clientId}</code> · <span className="badge">{request.status}</span>
        </p>
        <p className="muted">
          Period {request.reportingPeriod.start} → {request.reportingPeriod.end}
        </p>
        <p className="muted">
          Idempotency: <code>{request.idempotencyKey}</code>
        </p>
      </div>

      <h2>Package</h2>
      {!pkg ? (
        <div className="panel">
          <p className="muted">No package produced yet.</p>
        </div>
      ) : (
        <div className="panel">
          <p>
            Version {pkg.version} ·{" "}
            <span className="badge">confidence: {pkg.overallConfidence}</span> ·{" "}
            <span className="muted">produced {pkg.producedAt}</span>
          </p>
          {pkg.sections.map((s) => (
            <div
              key={s.key}
              style={{
                borderTop: "1px solid var(--border)",
                paddingTop: 12,
                marginTop: 12,
              }}
            >
              <h3 style={{ margin: "0 0 6px" }}>
                {s.title}{" "}
                <span className="badge">{s.confidence}</span>
              </h3>
              <pre
                style={{
                  background: "#0c1626",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 12,
                  overflowX: "auto",
                }}
              >
                {JSON.stringify(s.data, null, 2)}
              </pre>
              <p className="muted" style={{ fontSize: 12 }}>
                {s.evidence.length} evidence ref(s)
              </p>
            </div>
          ))}
          {pkg.dataGaps.length > 0 ? (
            <p className="muted" style={{ marginTop: 12 }}>
              Data gaps: {pkg.dataGaps.map((g) => g.area).join(", ")}
            </p>
          ) : null}
        </div>
      )}
    </main>
  );
}
