import Link from "next/link";
import { ClipboardCheck } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { DataError } from "@/src/components/mtos/data-error";
import { Linkified } from "@/src/components/mtos/annotate";
import { ClientHint } from "@/src/components/mtos/client-hint";
import { QcAppealReview } from "@/src/components/mtos/qc-appeal-review";
import { QcQueue } from "@/src/components/mtos/qc-queue";
import { QcScoring } from "@/src/components/mtos/qc-scoring";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import {
  QC_SPECIALIST_TITLE,
  canOpenQcQueue,
  canReadQcRecord,
  canScoreQc,
} from "@/src/lib/contracts/qc-access";
import { getQaClientIndexView } from "@/src/lib/server/services/qa-service";
import { getQcIndexRow, getQcQueueView } from "@/src/lib/server/services/qc-queue-service";
import { getQcScoringView } from "@/src/lib/server/services/qc-review-service";
import { getAccountManagerIdentity } from "@/src/lib/server/services/user-service";

/**
 * Rendered per request, never prerendered.
 *
 * This page reads one tenant's data behind a session cookie, so a build-time copy of it would
 * be the wrong tenant's page for everyone -- and the build would have to reach Firestore to
 * make it, which is what failed the deploys of 2026-11-02 when the daily read quota ran out.
 * Next cannot infer this on its own here: the session read calls `cookies()` inside a
 * try/catch and skips it entirely when the cookie secret is absent, so on a build without
 * that secret nothing marks the route dynamic and it is prerendered.
 */
export const dynamic = "force-dynamic";

/**
 * `/qa` is two different screens behind one path, chosen by role.
 *
 * A QC reviewer, an admin or a manager gets the QC queue; everyone else gets the client index that
 * was here before. One path rather than two because the sidebar has one "QA & Coaching" link and
 * the role already decides what that means -- and because the notifications raised in the previous
 * phase link to `/qa?qc={touchId}`, which has to open the scoring screen for the person who was
 * notified. The AM's own QA & Coaching page replaces the index below in the next phase.
 */

function riskTone(risk: "Low" | "Moderate" | "High"): "good" | "watch" | "risk" {
  if (risk === "Low") return "good";
  if (risk === "Moderate") return "watch";
  return "risk";
}
function scoreTone(score: number | null): "good" | "watch" | "risk" | undefined {
  if (score === null) return undefined;
  if (score >= 85) return "good";
  if (score >= 70) return "watch";
  return "risk";
}
function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function Mini({ label, value, tone }: { label: string; value: string | number; tone?: "good" | "watch" | "risk" }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--hair)", background: "var(--surface-2)" }}>
      <div className="muted text-[0.68rem]">{label}</div>
      <div className="mt-1 font-bold" style={{ fontSize: "1rem", color: tone ? `var(--${tone})` : "var(--text)" }}>
        {value}
      </div>
    </div>
  );
}

/** The green banner after a submit or a decision, built from the stored record rather than a URL. */
async function flashFor(
  context: Awaited<ReturnType<typeof resolveTenantContext>>,
  scored: string | undefined,
  decided: string | undefined,
): Promise<string | undefined> {
  const touchId = scored || decided;
  if (!touchId) return undefined;
  const row = await getQcIndexRow(context, touchId).catch(() => undefined);
  if (!row) return undefined;
  const who = row.am || "the account manager";
  if (scored) {
    const score =
      typeof row.score === "number"
        ? `${row.score}${row.rating ? ` (${row.rating})` : ""}`
        : "no criterion applied";
    return `Score sent to ${who} — ${row.client} · ${score}. They've been notified.`;
  }
  return `Decision sent to ${who} — ${row.client} · ${
    typeof row.score === "number" ? `score ${row.score}` : "score unchanged"
  }. They've been notified.`;
}

export default async function QaPage({
  searchParams,
}: {
  searchParams: Promise<{ qc?: string; appeal?: string; scored?: string; decided?: string }>;
}) {
  const context = await resolveTenantContext();
  const params = await searchParams;

  if (canOpenQcQueue(context.role)) {
    const touchId = params.qc || params.appeal;

    if (touchId) {
      // The index row first: it is small, and it is what says whose touch this is. Permission is
      // decided on it before the touch document is opened at all.
      const row = await getQcIndexRow(context, touchId).catch(() => undefined);
      if (!row || !canReadQcRecord(context.role, context.userId, row.amId)) {
        return (
          <AppShell>
            <Link href="/qa" className="ilink text-[0.8rem]">
              QC queue
            </Link>
            <div className="card mt-4">
              <p className="muted text-[0.86rem]">
                That touch is not in the QC queue, or you do not have access to it.
              </p>
            </div>
          </AppShell>
        );
      }

      const view = await getQcScoringView(context, touchId, row).catch(() => undefined);
      if (!view) {
        return (
          <AppShell>
            <DataError title="Couldn't load that QC record" />
          </AppShell>
        );
      }

      const shared = {
        touchId,
        qc: view.qc,
        client: view.client?.name || row.client,
        amName: row.am || "",
        amFirstName: view.amFirstName,
        canScore: canScoreQc(context.role),
        ...(view.touch.scheduledAt ? { scheduledAt: view.touch.scheduledAt } : {}),
      };

      return (
        <AppShell>
          {params.appeal ? (
            <QcAppealReview {...shared} />
          ) : (
            <QcScoring
              {...shared}
              sources={view.sources}
              {...(typeof view.qc.callLengthMin === "number"
                ? { callLengthMin: view.qc.callLengthMin }
                : {})}
            />
          )}
        </AppShell>
      );
    }

    let view: Awaited<ReturnType<typeof getQcQueueView>>;
    try {
      view = await getQcQueueView(context);
    } catch {
      return (
        <AppShell>
          <DataError title="Couldn't load the QC queue" />
        </AppShell>
      );
    }

    const me = await getAccountManagerIdentity(context).catch(() => ({ name: "" }));
    const title = me.name
      ? `QC queue · ${me.name}, ${QC_SPECIALIST_TITLE}`
      : `QC queue · ${QC_SPECIALIST_TITLE}`;
    const flash = await flashFor(context, params.scored, params.decided);

    return (
      <AppShell>
        <QcQueue
          reviewerTitle={title}
          counts={view.counts}
          queue={view.queue}
          appeals={view.appeals}
          scored={view.scored}
          team={view.team}
          {...(view.reviewerName ? { reviewerName: view.reviewerName } : {})}
          {...(flash ? { flash } : {})}
        />
      </AppShell>
    );
  }

  // ---------------------------------------------------------------------------
  // The AM's view, unchanged. Replaced by the QA & Coaching page in the next phase.
  // ---------------------------------------------------------------------------

  let cards: Awaited<ReturnType<typeof getQaClientIndexView>>["cards"];
  try {
    ({ cards } = await getQaClientIndexView(context));
  } catch {
    return (
      <AppShell>
        <DataError title="Couldn't load QA reviews" />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="section-head" style={{ marginTop: 0 }}>
        <div>
          <div className="eyebrow muted">
            <ClipboardCheck />
            <span>Quality &amp; coaching · consistency across every AM</span>
          </div>
          <h2 className="h2 mt-2">QA &amp; Coaching</h2>
        </div>
      </div>

      {cards.length === 0 ? (
        <p className="muted">No recorded Monthly Touch reviews on file yet.</p>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
          {cards.map((item) => {
            const rt = riskTone(item.retentionRisk);
            return (
              <div key={item.client.id} className="card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="av-sm" style={{ width: 42, height: 42, borderRadius: 12, fontSize: "0.9rem", background: "var(--accent)" }}>
                      {initials(item.client.name)}
                    </div>
                    <div>
                      <div className="font-semibold" style={{ color: "var(--text)" }}>
                        <ClientHint client={item.client} />
                      </div>
                      <div className="muted text-[0.78rem]">{item.client.industry}</div>
                    </div>
                  </div>
                  <span className={`chip ${rt}`}>
                    <span className={`sig-dot ${rt}`} />
                    {item.retentionRisk} risk
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <Mini label="Avg QA" value={item.averageQaScore ?? "—"} tone={scoreTone(item.averageQaScore)} />
                  <Mini label="Sentiment" value={item.averageSentimentScore ?? "—"} tone={scoreTone(item.averageSentimentScore)} />
                  <Mini label="Meetings" value={item.meetingsRecorded} />
                  <Mini label="Grade" value={item.latestGrade} />
                </div>

                <p className="mt-4 text-[0.86rem] leading-6" style={{ color: "var(--text-2)" }}>
                  <Linkified text={item.client.summary} clientId={item.client.id} />
                </p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="muted text-[0.76rem]">Latest touch · {item.latestTouchDate}</span>
                  <Link href={`/qa/${item.client.id}`} className="ilink text-[0.78rem]">
                    View reviews →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
