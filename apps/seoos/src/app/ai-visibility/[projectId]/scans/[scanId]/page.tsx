import Link from "next/link";
import { notFound } from "next/navigation";

import { AivShell, Denied, pageContext } from "@/src/components/ai-visibility/aiv-shell";
import { ScanLive } from "@/src/components/ai-visibility/scan-live";
import { COLLECTION_STATUS_LABEL, type CollectionStatus } from "@/src/lib/ai-visibility/types";
import { usd } from "@/src/lib/ai-visibility/util";
import { listJobs } from "@/src/lib/server/ai-visibility/scan-service";
import { attempts, scans } from "@/src/lib/server/ai-visibility/store";

export const dynamic = "force-dynamic";

export default async function AivScanPage({ params }: { params: Promise<{ projectId: string; scanId: string }> }) {
  const { projectId, scanId } = await params;
  const ctx = await pageContext(projectId);
  if ("denied" in ctx) return <Denied />;
  const { authz, project } = ctx;
  const scan = await scans().get(authz.tenantId, scanId);
  if (!scan || scan.projectId !== project.id) notFound();
  const [js, atts] = await Promise.all([listJobs(authz.tenantId, scanId), attempts().listWhere(authz.tenantId, "scanId", scanId)]);
  const done = scan.counts.succeeded + scan.counts.failed + scan.counts.cancelled;
  const attemptCost = atts.reduce((s, a) => s + a.costUsd, 0);
  const interrupted = atts.filter((a) => a.outcome === "interrupted").length;
  return (
    <AivShell authz={authz} project={project} tab="scans" subtitle={`Scan ${scan.id} · ${scan.trigger}`}>
      <section className="panel">
        <div className="panel-head">
          <h2 className="panel-title">Status: {scan.status.replace(/_/g, " ")}</h2>
          <Link href={`/ai-visibility/${project.id}/results?scan=${scan.id}`}>Observations from this scan →</Link>
        </div>
        <div className="aiv-progress" role="progressbar" aria-valuemin={0} aria-valuemax={scan.plannedCount} aria-valuenow={done} aria-label="Scan progress">
          <span style={{ width: `${scan.plannedCount ? (done / scan.plannedCount) * 100 : 100}%` }} />
        </div>
        <p style={{ fontSize: 14 }}>
          {done} of {scan.plannedCount} slots finished · {scan.counts.succeeded} succeeded · {scan.counts.failed} failed · {scan.counts.cancelled} cancelled · {scan.counts.pending} pending
        </p>
        {scan.stopReason ? <p className="aiv-msg aiv-msg--error">{scan.stopReason}</p> : null}
        <dl className="aiv-kv">
          <dt>Estimated cost</dt>
          <dd>{usd(scan.estimatedCostUsd)} (estimate shown before start)</dd>
          <dt>Calculated cost</dt>
          <dd>{usd(scan.actualCostUsd)} from provider-reported usage · attempts total {usd(attemptCost)}{interrupted ? ` · ${interrupted} interrupted attempt(s) with unknown cost` : ""}</dd>
          <dt>Per-scan cap</dt>
          <dd>{usd(scan.budgetCapUsd)}</dd>
          <dt>Configuration</dt>
          <dd>
            fingerprint <code>{scan.configFingerprint}</code> · {Object.entries(scan.configSummary).map(([k, v]) => `${k}: ${v}`).join(" · ")} · {scan.repetitions} repetition(s)
          </dd>
          <dt>Created</dt>
          <dd>{scan.createdAt.replace("T", " ").slice(0, 19)} UTC by {scan.createdBy}{scan.finishedAt ? ` · finished ${scan.finishedAt.replace("T", " ").slice(0, 19)}` : ""}</dd>
        </dl>
        <ScanLive projectId={project.id} scanId={scan.id} status={scan.status} canManage={authz.permissions.includes("seo.project.manage")} hasFailed={js.some((j) => j.status === "failed" || (j.status === "cancelled" && j.lastErrorClass === "budget_blocked"))} pending={scan.counts.pending} />
      </section>
      <section className="panel aiv-table-wrap">
        <h2 className="panel-title">Jobs ({js.length})</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Prompt</th>
              <th>Provider · model</th>
              <th className="num">Rep</th>
              <th>Status</th>
              <th className="num">Attempts</th>
              <th>Last error</th>
            </tr>
          </thead>
          <tbody>
            {js.map((j) => (
              <tr key={j.id}>
                <td style={{ fontSize: 13 }}>{j.slot.submittedText}</td>
                <td>{j.slot.providerId} · {j.slot.model}</td>
                <td className="num">{j.slot.repetition}</td>
                <td>
                  {j.status === "succeeded" ? <Link href={`/ai-visibility/${project.id}/results?scan=${scan.id}&obs=${j.id}`}>succeeded</Link> : j.status}
                  {j.status === "queued" && j.attempts > 0 ? <div className="aiv-ev">retry at {j.nextAttemptAt.slice(11, 19)}</div> : null}
                </td>
                <td className="num">{j.attempts}</td>
                <td style={{ fontSize: 12 }}>{j.lastErrorClass ? `${COLLECTION_STATUS_LABEL[j.lastErrorClass as CollectionStatus] ?? j.lastErrorClass}: ${j.lastError ?? ""}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </AivShell>
  );
}
