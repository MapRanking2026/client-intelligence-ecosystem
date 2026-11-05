import Link from "next/link";
import { ClipboardCheck } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { DataError } from "@/src/components/mtos/data-error";
import { Linkified } from "@/src/components/mtos/annotate";
import { ClientHint } from "@/src/components/mtos/client-hint";
import { QcAmCoaching } from "@/src/components/mtos/qc-am-coaching";
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
import {
  amDateLabel,
  amHeadline,
  amKpis,
  amSubtitle,
  appealBanner,
  breakdownRows,
  focusRows,
  historyRows,
  improvedRows,
  latestCard,
  pendingChipLabel,
  rowScore,
  trendPoints,
} from "@/src/lib/contracts/qc-am";
import { appealCandidates, canAppeal } from "@/src/lib/contracts/qc-appeal-draft";
import { callLengthLabel } from "@/src/lib/contracts/qc-queue";
import { LEGACY_QA_EXPLAINER, LEGACY_QA_TAG } from "@/src/lib/contracts/qc-legacy";
import { getQaClientIndexView } from "@/src/lib/server/services/qa-service";
import { getQcAmView } from "@/src/lib/server/services/qc-am-service";
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
  searchParams: Promise<{
    qc?: string;
    appeal?: string;
    scored?: string;
    decided?: string;
    touch?: string;
    mine?: string;
    legacy?: string;
  }>;
}) {
  const context = await resolveTenantContext();
  const params = await searchParams;

  /*
    Who gets the queue, and the two ways somebody who normally gets it lands on their own page
    instead.

    `?mine=1` is the link in the queue header. `?touch=` is the href on a "your QC score is ready"
    notification. Both matter because a manager at this company also runs client touches: without
    them, Ian or Yosef could see the whole team's averages on the Team tab and never reach the
    breakdown of their own score, and the notification telling them it existed would open a queue.
  */
  const wantsOwnScores = Boolean(params.mine || params.touch);

  if (canOpenQcQueue(context.role) && !wantsOwnScores) {
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
    // Counted off the rows already in hand rather than with another query: a reviewer who has
    // never run a touch sees no link, and one who has gets a way to their own breakdown.
    const ownScores = view.scored.filter((row) => row.amId === context.userId).length;

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
          ownScores={ownScores}
          {...(flash ? { flash } : {})}
        />
      </AppShell>
    );
  }

  // ---------------------------------------------------------------------------
  // The AM's own QA & Coaching page (handoff §6.7)
  // ---------------------------------------------------------------------------

  const am = await getQcAmView(context, params.touch).catch(() => undefined);
  // The way back, for a reviewer or manager who arrived here from the queue or a notification.
  const backToQueue = canOpenQcQueue(context.role);
  const me = await getAccountManagerIdentity(context).catch(() => ({ name: "" }));
  const reviewerName = am?.reviewerName || "QC";

  /*
    `?legacy=1` keeps the earlier A–F reviews reachable (handoff §6.10).

    Without it they were not: once an account manager had a single QC record this page stopped
    rendering the client index below, which is the only screen those reviews can be read from. The
    link to here sits on the QC page itself, so the old reviews are one click away rather than
    gone.
  */
  if ((am?.done.length || am?.pending.length) && !params.legacy) {
    const { done, pending, selected } = am;
    const selectedId = selected?.row.touchId;
    const coachingSource = selected?.qc.coaching?.some((item) => item.idea.trim())
      ? selected
      : undefined;
    const latest = latestCard(done, am.reviewerName);
    // The coaching plan shown is the selected touch's own when it has one. A touch scored before
    // the reviewer wrote any coaching shows none rather than borrowing another client's plan --
    // advice about a different account, presented under this one's heading, is worse than silence.
    const coaching = coachingSource?.qc.coaching?.filter((item) => item.idea.trim()) || [];

    return (
      <AppShell>
        <div className="mb-4 flex flex-wrap items-center gap-4">
          {backToQueue ? (
            <Link href="/qa" className="ilink text-[0.8rem]">
              ← QC queue
            </Link>
          ) : null}
          <Link href="/qa?legacy=1" className="ilink text-[0.8rem]">
            Earlier A–F reviews →
          </Link>
        </div>
        <QcAmCoaching
          amName={me.name}
          reviewerName={reviewerName}
          headline={amHeadline(done)}
          subtitle={amSubtitle(done)}
          pendingChips={pending.map(pendingChipLabel)}
          {...(latest ? { latest } : {})}
          kpis={amKpis(done)}
          trend={trendPoints(done, selectedId)}
          improved={improvedRows(done)}
          focus={focusRows(done, am.notesByTouch)}
          coaching={coaching}
          coachingFrom={
            coachingSource
              ? `${coachingSource.clientName} · ${amDateLabel(coachingSource.row.date)}`
              : ""
          }
          history={historyRows(done, selectedId, am.reviewerName)}
          {...(selected
            ? {
                detail: {
                  touchId: selected.row.touchId,
                  client: selected.clientName,
                  dateLabel: amDateLabel(selected.row.date),
                  score: rowScore(selected.row),
                  rating: selected.qc.rating || null,
                  meta: [
                    callLengthLabel(selected.qc.callLengthMin),
                    `scored by ${reviewerName} ${amDateLabel(selected.qc.scoredAt)}`,
                    `client goal ${selected.qc.goal || "—"}`,
                  ].join(" · "),
                  strengths: selected.qc.strengths || "—",
                  focus: selected.qc.focus || "—",
                  breakdown: breakdownRows({
                    crit: selected.qc.crit,
                    previousCrit: selected.previousCrit,
                    notes: selected.qc.notes,
                    appeal: selected.qc.appeal,
                  }),
                  ...(appealBanner(selected.qc.appeal)
                    ? { appealBanner: appealBanner(selected.qc.appeal)! }
                    : {}),
                  ...(selected.qc.appeal?.reply ? { appealReply: selected.qc.appeal.reply } : {}),
                  appealCandidates: appealCandidates(selected.qc.crit, selected.qc.notes),
                  canAppeal: canAppeal({
                    hasAppeal: Boolean(selected.qc.appeal),
                    hasScore: rowScore(selected.row) !== null,
                    isOwner: selected.row.amId === context.userId,
                  }),
                  canAcknowledge:
                    selected.qc.status === "scored" || selected.qc.status === "appeal_resolved",
                  chatRequested: Boolean(selected.qc.chatRequestedAt),
                },
              }
            : {})}
        />
      </AppShell>
    );
  }

  // ---------------------------------------------------------------------------
  // No QC record for this AM yet.
  //
  // The new page's empty state, and below it the client index that was here before. The index is
  // kept rather than removed because it is the only place the legacy A-F reviews can still be read,
  // and those are folded into the history above in a later phase (handoff §6.10). Removing it now
  // would take something away from an AM whose touches all predate QC.
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
          <div className="eyebrow">
            <ClipboardCheck />
            <span>QA &amp; Coaching{me.name ? ` · ${me.name}` : ""}</span>
          </div>
          <h2 className="h2 mt-2">
            {params.legacy ? "Earlier A–F reviews" : "No QC scores yet."}
          </h2>
          <p className="muted mt-2 max-w-[62ch] text-[0.86rem] leading-6">
            {params.legacy ? LEGACY_QA_EXPLAINER : null}{" "}
            {params.legacy
              ? null
              : `Your first score appears here after ${reviewerName} grades a finished monthly touch. The reviews below are the earlier A–F ones, which stay readable.`}
          </p>
          {params.legacy ? (
            <Link href="/qa" className="ilink mt-3 inline-block text-[0.8rem]">
              ← Back to QA &amp; Coaching
            </Link>
          ) : null}
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
                  <Mini label={`${LEGACY_QA_TAG} grade`} value={item.latestGrade} />
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
