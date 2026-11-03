import Link from "next/link";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CalendarRange,
  ClipboardCheck,
  Clock,
  Phone,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { DataError } from "@/src/components/mtos/data-error";
import { ClientHint } from "@/src/components/mtos/client-hint";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { TONE_CLASS, TONE_LABEL } from "@/src/lib/health-display";
import {
  getCommandCenterV2View,
  type TouchWithClient,
} from "@/src/lib/server/services/command-center-v2-service";
import { deriveRunSheetStage, RUN_SHEET_PRIMARY_ACTION } from "@/src/lib/server/services/prep-readiness-service";

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
 * Command Center v2 — the AM's day, in the order it has to be worked.
 *
 * Today's calls, then the preparation due in the next 48 hours, then the follow-through that is
 * late, then the QA waiting on someone, then the accounts that genuinely need attention. Each queue
 * is built from real scheduled dates and real workflow state, and each one says plainly when it is
 * empty rather than being padded with whatever was nearest.
 */

function formatTime(date: Date | null): string {
  if (!date) return "no time set";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function formatDay(date: Date | null): string {
  if (!date) return "no date set";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function Queue({
  icon,
  title,
  count,
  subtitle,
  empty,
  children,
}: {
  icon: ReactNode;
  title: string;
  count: number;
  subtitle: string;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <div className="card-head">
        <div className="card-title">
          {icon}
          {title}
        </div>
        <span className={`chip ${count > 0 ? "" : "muted"}`}>{count}</span>
      </div>
      <p className="muted -mt-2 mb-3.5 text-[0.78rem]">{subtitle}</p>
      {count === 0 ? <p className="muted text-[0.85rem]">{empty}</p> : children}
    </section>
  );
}

function TouchRow({ entry, detail }: { entry: TouchWithClient; detail: string }) {
  const stage = deriveRunSheetStage(entry.touch);
  const tone = TONE_CLASS[entry.client.tone];
  return (
    <Link href={`/monthly-touch/${entry.touch.id}/v2`} className="list-row" style={{ padding: 12 }}>
      <span className={`sig-dot ${tone}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[0.88rem] font-semibold" style={{ color: "var(--text)" }}>
          {entry.client.name}
        </span>
        <span className="muted block text-[0.78rem]">{detail}</span>
      </span>
      <span className="chip">{RUN_SHEET_PRIMARY_ACTION[stage].label}</span>
      <ArrowRight style={{ width: 15, height: 15, color: "var(--slate-400)" }} />
    </Link>
  );
}

export default async function CommandCenterV2Page() {
  let view: Awaited<ReturnType<typeof getCommandCenterV2View>>;
  try {
    view = await getCommandCenterV2View(await resolveTenantContext());
  } catch {
    return (
      <AppShell>
        <DataError title="Couldn't load your Command Center" />
      </AppShell>
    );
  }

  const {
    greeting,
    today,
    todaysCalls,
    prepDueWithin48h,
    overdueFollowThrough,
    qaWaiting,
    atRisk,
    thisWeek,
    weekLabel,
    overdueCommitments,
    averageGrowthScore,
    unassessedClients,
    clientCount,
  } = view;

  const workItems = todaysCalls.length + prepDueWithin48h.length + overdueFollowThrough.length + qaWaiting.length;

  const stats = [
    {
      label: "Calls today",
      value: String(todaysCalls.length),
      sub: todaysCalls.length ? `first at ${formatTime(todaysCalls[0].scheduledAt)}` : "nothing scheduled",
      icon: <Phone />,
    },
    {
      label: "Prep due in 48h",
      value: String(prepDueWithin48h.length),
      sub: "meetings whose preparation is unfinished",
      icon: <Clock />,
      tone: prepDueWithin48h.length ? ("watch" as const) : undefined,
    },
    {
      label: "Follow-through late",
      value: String(overdueFollowThrough.length),
      sub: "meetings held, decisions not applied",
      icon: <AlertTriangle />,
      tone: overdueFollowThrough.length ? ("risk" as const) : undefined,
    },
    {
      label: "Overdue commitments",
      value: String(overdueCommitments.length),
      sub: "promises past their date",
      icon: <BadgeCheck />,
      tone: overdueCommitments.length ? ("risk" as const) : undefined,
    },
  ];

  return (
    <AppShell>
      <section className="flex flex-wrap items-start justify-between gap-5">
        <div className="max-w-2xl">
          <div className="eyebrow">
            <Sparkles />
            <span>
              Your day ·{" "}
              {new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(today)}
            </span>
          </div>
          <h1 className="h1 mt-3.5">
            {greeting.label}
            <br />
            <span style={{ color: "var(--accent)" }}>
              {workItems === 0
                ? "Nothing is waiting on you right now."
                : `${workItems} ${workItems === 1 ? "thing needs" : "things need"} you today.`}
            </span>
          </h1>
          <p className="lead mt-3.5">
            In order: the calls you have today, the preparation due within 48 hours, the follow-through that is late,
            and the QA waiting on a decision. Accounts needing attention are below that — they matter, but they are not
            what your day is made of.
          </p>
        </div>
        <Link href="/command-center" className="btn btn-ghost btn-sm">
          Open the original Command Center
        </Link>
      </section>

      <div className="mt-7 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="card" style={{ padding: "16px 18px" }}>
            <div className="flex items-center justify-between">
              <div className="stat-label">{stat.label}</div>
              <span
                className="grid h-8 w-8 place-items-center rounded-[9px]"
                style={{
                  background: stat.tone ? `var(--${stat.tone}-bg)` : "var(--surface-2)",
                  color: stat.tone ? `var(--${stat.tone})` : "var(--accent)",
                }}
              >
                {stat.icon}
              </span>
            </div>
            <div className="stat-val mt-3.5" style={stat.tone ? { color: `var(--${stat.tone})` } : undefined}>
              {stat.value}
            </div>
            <div className="muted mt-1.5 text-[0.76rem]">{stat.sub}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="grid gap-4">
          <Queue
            icon={<Phone />}
            title="Today's calls"
            count={todaysCalls.length}
            subtitle="Scheduled for today, earliest first."
            empty="No Monthly Touch is scheduled for today."
          >
            {todaysCalls.map((entry) => (
              <TouchRow
                key={entry.touch.id}
                entry={entry}
                detail={`${formatTime(entry.scheduledAt)} · ${entry.client.industry}`}
              />
            ))}
          </Queue>

          <Queue
            icon={<Clock />}
            title="Preparation due within 48 hours"
            count={prepDueWithin48h.length}
            subtitle="The meeting is close and the preparation has not finished."
            empty="Nothing in the next 48 hours still needs preparing."
          >
            {prepDueWithin48h.map((entry) => (
              <TouchRow
                key={entry.touch.id}
                entry={entry}
                detail={`${formatDay(entry.scheduledAt)} at ${formatTime(entry.scheduledAt)}`}
              />
            ))}
          </Queue>

          <Queue
            icon={<AlertTriangle />}
            title="Follow-through that is late"
            count={overdueFollowThrough.length}
            subtitle="The meeting happened and the recap, the tickets and the notes are not done. The window is 24 business hours."
            empty="Every meeting that has happened has had its follow-through completed."
          >
            {overdueFollowThrough.map((entry) => (
              <TouchRow
                key={entry.touch.id}
                entry={entry}
                detail={`met ${formatDay(entry.scheduledAt)} · ${
                  entry.touch.postMeeting?.status === "draft_ready"
                    ? "drafts are waiting for your decisions"
                    : "nothing captured yet"
                }`}
              />
            ))}
          </Queue>

          <Queue
            icon={<ClipboardCheck />}
            title="QA waiting on a decision"
            count={qaWaiting.length}
            subtitle="Reviewed and waiting for approval."
            empty="No QA review is waiting on a decision."
          >
            {qaWaiting.map((entry) => (
              <TouchRow
                key={entry.touch.id}
                entry={entry}
                detail={`graded ${entry.touch.qaReview?.overallGrade ?? "—"} · met ${formatDay(entry.scheduledAt)}`}
              />
            ))}
          </Queue>

          <Queue
            icon={<ShieldAlert />}
            title="Accounts needing attention"
            count={atRisk.length}
            subtitle="Only accounts whose health says Needs attention, At risk or Critical. Healthy and Excellent accounts are not listed here."
            empty="No account is currently flagged as needing attention."
          >
            {atRisk.slice(0, 8).map((client) => {
              const tone = TONE_CLASS[client.tone];
              return (
                <Link key={client.id} href={`/clients/${client.id}`} className="list-row" style={{ padding: 12 }}>
                  <span className={`sig-dot ${tone}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.88rem] font-semibold" style={{ color: "var(--text)" }}>
                      <ClientHint client={client} />
                    </span>
                    <span className="muted block text-[0.78rem]">
                      {client.topRisks?.length ? client.topRisks.join(" · ") : client.summary}
                    </span>
                  </span>
                  <span className={`chip ${tone}`}>{TONE_LABEL[client.tone]}</span>
                </Link>
              );
            })}
            {atRisk.length > 8 ? (
              <Link href="/clients" className="ilink mt-2.5 inline-block text-[0.8rem]">
                {atRisk.length - 8} more in Clients
              </Link>
            ) : null}
          </Queue>
        </div>

        <div className="flex flex-col gap-4">
          <div className="card">
            <div className="card-head">
              <div className="card-title">
                <CalendarRange />
                This week · {weekLabel}
              </div>
              <span className="chip">{thisWeek.length}</span>
            </div>
            {thisWeek.length === 0 ? (
              <p className="muted text-[0.85rem]">No Monthly Touch falls in this calendar week.</p>
            ) : (
              thisWeek.map((entry) => (
                <TouchRow
                  key={entry.touch.id}
                  entry={entry}
                  detail={`${formatDay(entry.scheduledAt)} at ${formatTime(entry.scheduledAt)}`}
                />
              ))
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <div className="card-title">
                <Users />
                Your book
              </div>
            </div>
            <div className="grid gap-3">
              <div>
                <div className="stat-label">Clients</div>
                <div className="stat-val mt-1.5">{clientCount}</div>
              </div>
              <div>
                <div className="stat-label">Average growth score</div>
                <div
                  className="stat-val mt-1.5"
                  style={averageGrowthScore.value === null ? { color: "var(--slate-400)" } : undefined}
                >
                  {averageGrowthScore.value === null ? "—" : averageGrowthScore.value}
                </div>
                <p className="muted mt-1.5 text-[0.76rem]">
                  {averageGrowthScore.counted
                    ? `The average growth readiness of the ${averageGrowthScore.counted} of ${averageGrowthScore.total} clients that have one. This is not an overall health figure.`
                    : "No client has a growth score yet, so there is nothing to average."}
                </p>
              </div>
              {unassessedClients ? (
                <p className="muted text-[0.78rem]">
                  {unassessedClients} client{unassessedClients === 1 ? " has" : "s have"} no health set. Not assessed is
                  not the same as unhealthy — set it on the client page.
                </p>
              ) : null}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div className="card-title">
                <BadgeCheck />
                Overdue promises
              </div>
              <Link href="/commitments" className={`chip ${overdueCommitments.length ? "risk" : "good"}`}>
                {overdueCommitments.length ? `${overdueCommitments.length} overdue` : "On track"}
              </Link>
            </div>
            {overdueCommitments.slice(0, 5).map((commitment) => (
              <div key={commitment.id} className="border-t py-2.5" style={{ borderColor: "var(--hair)" }}>
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[0.84rem]" style={{ color: "var(--text)", maxWidth: "72%" }}>
                    {commitment.title}
                  </span>
                  <span className="chip risk" style={{ whiteSpace: "nowrap" }}>
                    due {commitment.dueDate}
                  </span>
                </div>
                <div className="muted mt-1.5 text-[0.72rem]">{commitment.owner}</div>
              </div>
            ))}
            {overdueCommitments.length === 0 ? (
              <p className="muted text-[0.85rem]">Nothing we promised is past its date.</p>
            ) : null}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
