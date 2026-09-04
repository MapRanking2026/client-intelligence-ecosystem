import { Suspense } from "react";
import { sortDirectionFromAlias } from "@cie/core";

import { resolveSeoAuthz, authzHas } from "@/src/lib/auth/context";
import { AppShell } from "@/src/components/app-shell";
import { EmptyState, Panel, StatusPill, UnauthorizedPage } from "@/src/components/states";
import { LeadSortToggle } from "@/src/components/lead-sort-toggle";
import { VerifyControl } from "@/src/components/verify-control";
import { getLeadCallRepo } from "@/src/lib/server/repositories/lead-call-repo";
import { LeadCallListQueryV1 } from "@cie/contracts";

export const dynamic = "force-dynamic";

export default async function LeadVerificationPage({
  searchParams,
}: {
  searchParams: Promise<{ dir?: string }>;
}) {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  const canRead = authzHas(authz, "lead_call.read");
  const canVerify = authzHas(authz, "lead_call.verify");
  const canPlay = authzHas(authz, "lead_call.play_recording");

  const { dir } = await searchParams;
  const direction = sortDirectionFromAlias(dir === "asc" ? "asc" : "desc");

  const query = LeadCallListQueryV1.parse({ sort: direction, limit: 50, filter: {} });
  const page = canRead
    ? await getLeadCallRepo().list(authz.tenantId, query)
    : { items: [], nextCursor: null, timezone: "UTC" };

  return (
    <AppShell
      authz={authz}
      title="Lead & Call Verification"
      subtitle="The same canonical records MTOS uses · authorized access"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Lead & Call Verification" }]}
    >
      {!canRead ? (
        <div className="state state--blocked">
          <span className="badge badge--warn">Permission required</span>
          <p className="muted">You need lead_call.read to view lead/call records.</p>
        </div>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Times shown in <strong>{page.timezone}</strong>. Records without a valid
            occurrence time are sorted last and marked <em>Date unavailable</em>.
            Recording playback uses the shared protected proxy — no raw URLs or
            provider credentials reach the browser.
          </p>
          <Suspense fallback={<div className="toolbar muted">Loading sort…</div>}>
            <LeadSortToggle />
          </Suspense>

          <Panel title={`Records (${page.items.length})`}>
            {page.items.length === 0 ? (
              <EmptyState title="No lead/call records" message="No records for this tenant/client scope yet." />
            ) : (
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Occurred</th>
                      <th>Channel</th>
                      <th>Contact</th>
                      <th>Status</th>
                      <th>Recording</th>
                      {canVerify ? <th>Change</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {page.items.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.occurredAt ? (
                            r.occurredAt.slice(0, 16).replace("T", " ")
                          ) : (
                            <span className="badge badge--warn">Date unavailable</span>
                          )}
                        </td>
                        <td>{r.channel}</td>
                        <td className="muted">{r.contact.displayName ?? "—"}</td>
                        <td><StatusPill status={r.verificationStatus} /></td>
                        <td>
                          {r.recordingRef ? (
                            canPlay ? (
                              <button type="button" disabled title="Protected proxy — blocked_external until integration gateway is wired">
                                ▶ Play (protected)
                              </button>
                            ) : (
                              <span className="muted">available</span>
                            )
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        {canVerify ? (
                          <td>
                            <VerifyControl recordId={r.id} current={r.verificationStatus} />
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </>
      )}
    </AppShell>
  );
}
