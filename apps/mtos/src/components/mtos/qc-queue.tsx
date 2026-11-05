"use client";

import { useState } from "react";
import Link from "next/link";
import { ClipboardCheck, Scale, Users } from "lucide-react";

import {
  QC_QUEUE_TABS,
  QC_TAB_LABEL,
  callLengthLabel,
  evidenceSummary,
  queueActionLabel,
  queueStatusChip,
  queueTitle,
  rowInitials,
  scoredStatusLabel,
  waitLabel,
  type QcQueueTab,
} from "@/src/lib/contracts/qc-queue";
import { qcTone, type QcIndexRow } from "@/src/lib/contracts/qc-record";
import { goalsLabel, lowestLabel, type QcTeamCard } from "@/src/lib/contracts/qc-team";
import { QC_KPI_TARGET } from "@/src/lib/contracts/qc-record";

/**
 * The QC Specialist's queue: four tabs over one index collection.
 *
 * A client component only because the tabs switch without a round trip -- every number on it was
 * computed on the server. The lists are already in the right order when they arrive (oldest first
 * for the queue, newest first for history); nothing is re-sorted here, so the ordering rule lives
 * in one tested place rather than in a component nobody can test.
 *
 * ## The red wait is the only alarm on the page
 *
 * Everything else is neutral. A touch past twenty-four hours turns its wait red because that is the
 * promise made to the AM when they pressed Finish, and it is the one thing on this screen a
 * reviewer should act on before anything else.
 */

function dateLabel(iso: string | undefined): string {
  if (!iso) return "no date";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "no date";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function Avatar({ name }: { name: string | undefined }) {
  return (
    <div
      className="av-sm"
      style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        fontSize: "0.85rem",
        background: "var(--violet)",
        color: "#fff",
        flexShrink: 0,
      }}
    >
      {rowInitials(name) || "—"}
    </div>
  );
}

function ScoreChip({ score, rating }: { score: number | undefined; rating: string | undefined }) {
  // No score is a dash, never a zero. An unscored touch shown as "0" reads as a catastrophic review.
  if (typeof score !== "number") return <span className="chip muted">—</span>;
  return (
    <span className={`chip ${qcTone(score)}`}>
      {score}
      {rating ? ` · ${rating}` : ""}
    </span>
  );
}

function QueueRow({ row }: { row: QcIndexRow }) {
  const chip = queueStatusChip(row.status);
  const wait = waitLabel(row.readyAt);
  const evidence = evidenceSummary(
    typeof row.evidenceTotal === "number"
      ? Array.from({ length: row.evidenceTotal }, (_, index) => ({
          ok: index < (row.evidenceOk || 0),
        }))
      : undefined,
  );

  return (
    <div className="card flex flex-wrap items-center gap-4" style={{ padding: "14px 16px" }}>
      <Avatar name={row.am} />
      <div className="min-w-[220px] flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold" style={{ color: "var(--text)" }}>
            {row.client}
          </span>
          <span className={`chip ${chip.tone}`}>{chip.label}</span>
        </div>
        <div className="muted mt-1 text-[0.78rem]">
          {row.am || "Unnamed account manager"} · Monthly Touch · {dateLabel(row.date)} ·{" "}
          {callLengthLabel(row.callLengthMin)}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="chip muted">{row.tickets ?? 0} tickets</span>
          {typeof row.evidenceTotal === "number" ? (
            <span className={`chip ${evidence.tone}`}>{evidence.text}</span>
          ) : null}
          <span className={`chip ${row.ai ? "qc" : "muted"}`}>
            {row.ai ? "AI pre-read ready" : "Manual"}
          </span>
        </div>
      </div>
      <div className="text-right">
        {wait.text ? (
          <>
            <div
              className="font-semibold text-[0.82rem]"
              style={{ color: wait.late ? "var(--risk)" : "var(--text-2)" }}
            >
              {wait.text}
            </div>
            <div className="muted text-[0.7rem]">since Finish follow-through</div>
          </>
        ) : (
          <div className="muted text-[0.75rem]">no handoff time recorded</div>
        )}
      </div>
      <Link href={`/qa?qc=${row.touchId}`} className="btn btn-primary text-[0.8rem]">
        {queueActionLabel(row.status)}
      </Link>
    </div>
  );
}

function AppealRow({ row }: { row: QcIndexRow }) {
  // The criterion count is only claimed when the appeal actually recorded one -- see `appealCount`.
  const parts = [
    row.am || "Unnamed account manager",
    ...(typeof row.appealCount === "number"
      ? [`${row.appealCount} ${row.appealCount === 1 ? "criterion" : "criteria"}`]
      : []),
    `score ${typeof row.score === "number" ? row.score : "—"}`,
  ];
  return (
    <div className="card flex flex-wrap items-center gap-4" style={{ padding: "14px 16px" }}>
      <Avatar name={row.am} />
      <div className="min-w-[220px] flex-1">
        <div className="font-semibold" style={{ color: "var(--text)" }}>
          {row.client} · {dateLabel(row.date)}
        </div>
        <div className="muted mt-1 text-[0.78rem]">{parts.join(" · ")}</div>
      </div>
      <Link href={`/qa?appeal=${row.touchId}`} className="btn btn-primary text-[0.8rem]">
        Review appeal
      </Link>
    </div>
  );
}

function ScoredRow({ row, reviewerName }: { row: QcIndexRow; reviewerName?: string }) {
  return (
    <div className="card flex flex-wrap items-center gap-4" style={{ padding: "12px 16px" }}>
      <div className="muted min-w-[92px] text-[0.76rem]">{dateLabel(row.date)}</div>
      <div className="min-w-[200px] flex-1">
        <div className="font-semibold" style={{ color: "var(--text)" }}>
          {row.client}
        </div>
        <div className="muted mt-0.5 text-[0.76rem]">
          {row.am || "Unnamed account manager"} · scored {dateLabel(row.scoredAt)}
        </div>
      </div>
      <span className="chip muted">{scoredStatusLabel(row.status, reviewerName)}</span>
      <ScoreChip score={row.score} rating={row.rating} />
      <Link href={`/qa?qc=${row.touchId}`} className="ilink text-[0.78rem]">
        Open →
      </Link>
    </div>
  );
}

function KpiAverage({ label, value }: { label: string; value: number | null }) {
  const met = value !== null && value >= QC_KPI_TARGET;
  return (
    <div
      style={{
        padding: "9px 11px",
        borderRadius: 10,
        border: "1px solid var(--hair)",
        background: "var(--surface-2)",
      }}
    >
      <div className="muted text-[0.66rem]">{label}</div>
      <div
        className="mt-0.5 font-bold"
        style={{ fontSize: "0.95rem", color: value === null ? "var(--slate-400)" : met ? "var(--good)" : "var(--watch)" }}
      >
        {value === null ? "—" : value.toFixed(1)}
      </div>
    </div>
  );
}

function TeamCard({ card }: { card: QcTeamCard }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar name={card.am} />
          <div>
            <div className="font-semibold" style={{ color: "var(--text)" }}>
              {card.am}
            </div>
            <div className="muted text-[0.76rem]">
              {card.scored} {card.scored === 1 ? "QC" : "QCs"} · {card.inQueue} in queue
            </div>
          </div>
        </div>
        {card.averageScore === null ? (
          <span className="chip muted">—</span>
        ) : (
          <span className={`chip ${qcTone(card.averageScore)}`}>{card.averageScore} avg</span>
        )}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <KpiAverage label="Meeting prep" value={card.prepAverage} />
        <KpiAverage label="Post-touch actions" value={card.postTouchAverage} />
      </div>
      <div className="muted mt-3 text-[0.78rem]">{goalsLabel(card)}</div>
      <div className="muted mt-1 text-[0.78rem]">{lowestLabel(card)}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="card">
      <p className="muted text-[0.86rem]">{children}</p>
    </div>
  );
}

export function QcQueue({
  reviewerTitle,
  reviewerName,
  counts,
  queue,
  appeals,
  scored,
  team,
  flash,
}: {
  /** "QC queue · {name}, QC Specialist" is built on the server, where the session is. */
  reviewerTitle: string;
  reviewerName?: string;
  counts: { queue: number; appeals: number; scored: number; team: number };
  queue: QcIndexRow[];
  appeals: QcIndexRow[];
  scored: QcIndexRow[];
  team: QcTeamCard[];
  flash?: string;
}) {
  const [tab, setTab] = useState<QcQueueTab>(queue.length || !appeals.length ? "queue" : "appeals");

  return (
    <>
      {flash ? (
        <div
          className="card mb-4"
          style={{ borderColor: "transparent", background: "var(--good-bg)", color: "var(--good)" }}
        >
          <div className="font-semibold text-[0.86rem]">{flash}</div>
        </div>
      ) : null}

      <div className="section-head" style={{ marginTop: 0 }}>
        <div>
          <div className="eyebrow" style={{ color: "var(--violet)" }}>
            <ClipboardCheck />
            <span>{reviewerTitle}</span>
          </div>
          <h2 className="h2 mt-2">{queueTitle(counts.queue, counts.appeals)}</h2>
          <p className="muted mt-2 max-w-[62ch] text-[0.86rem] leading-6">
            Each touch arrives with the follow-through evidence the AM&apos;s own screen showed, the
            transcript, and an AI pre-read that suggests a score per criterion with the moment it
            came from. You set the final score.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="QC views">
          {QC_QUEUE_TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => setTab(name)}
              className="btn text-[0.78rem]"
              style={
                tab === name
                  ? { background: "var(--violet)", color: "#fff", borderColor: "transparent" }
                  : undefined
              }
            >
              {QC_TAB_LABEL[name]} {counts[name]}
            </button>
          ))}
        </div>
      </div>

      {tab === "queue" ? (
        <div className="grid gap-3">
          {queue.length ? (
            queue.map((row) => <QueueRow key={row.touchId} row={row} />)
          ) : (
            <Empty>
              Queue is clear. New touches appear here as soon as an AM finishes follow-through.
            </Empty>
          )}
        </div>
      ) : null}

      {tab === "appeals" ? (
        <div className="grid gap-3">
          {appeals.length ? (
            appeals.map((row) => <AppealRow key={row.touchId} row={row} />)
          ) : (
            <Empty>No appeals waiting. An AM can appeal any score they think missed context.</Empty>
          )}
        </div>
      ) : null}

      {tab === "scored" ? (
        <div className="grid gap-2">
          {scored.length ? (
            scored.map((row) => (
              <ScoredRow key={row.touchId} row={row} reviewerName={reviewerName} />
            ))
          ) : (
            <Empty>
              <Scale className="mr-1 inline" style={{ width: 14, height: 14 }} />
              Nothing scored yet. Submitted reviews appear here, newest first.
            </Empty>
          )}
        </div>
      ) : null}

      {tab === "team" ? (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))" }}>
          {team.length ? (
            team.map((card) => <TeamCard key={card.amId} card={card} />)
          ) : (
            <Empty>
              <Users className="mr-1 inline" style={{ width: 14, height: 14 }} />
              No account manager has a QC record yet.
            </Empty>
          )}
        </div>
      ) : null}
    </>
  );
}
