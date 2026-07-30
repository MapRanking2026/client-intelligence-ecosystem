import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";

import { LEAD_CHANNEL_LABEL } from "@/src/lib/mtos-data";
import type { LeadVerificationReview } from "@/src/lib/mtos-data";

/**
 * Read-only summary of a lead-verification review: totals, channel breakdown,
 * reconciliation, and warnings. Shared by the monthly-touch workspace and the
 * dedicated verification page header. Presentational only — no interactivity.
 */
export function LeadVerificationSummary({
  review,
  clientId,
  showLink = true,
}: {
  review: LeadVerificationReview;
  clientId: string;
  showLink?: boolean;
}) {
  const { totals, byChannel, reconciliation, warnings } = review;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Total" value={totals.total} tone="slate" />
        <StatTile label="Valid" value={totals.valid} tone="emerald" />
        <StatTile label="Flagged" value={totals.flagged} tone="rose" />
        <StatTile label="Needs review" value={totals.needsReview} tone="amber" />
      </div>

      {byChannel.length ? (
        <div className="flex flex-wrap gap-2">
          {byChannel.map((row) => (
            <span
              key={row.channel}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-white/4 px-3 py-1 text-xs text-slate-300"
            >
              {LEAD_CHANNEL_LABEL[row.channel]}
              <span className="font-semibold text-white">{row.total}</span>
              {row.flagged ? <span className="text-rose-300">({row.flagged} flagged)</span> : null}
            </span>
          ))}
        </div>
      ) : null}

      {reconciliation.length ? (
        <div className="overflow-x-auto rounded-[20px] border border-white/8 bg-black/20">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                <th className="px-4 py-3 font-medium">Channel</th>
                <th className="px-4 py-3 font-medium">GoHighLevel</th>
                <th className="px-4 py-3 font-medium">Platform reported</th>
                <th className="px-4 py-3 font-medium">Δ</th>
              </tr>
            </thead>
            <tbody>
              {reconciliation.map((row) => (
                <tr key={row.channel} className="border-t border-white/6 text-slate-200">
                  <td className="px-4 py-3">{LEAD_CHANNEL_LABEL[row.channel]}</td>
                  <td className="px-4 py-3">{row.ghlCount}</td>
                  <td className="px-4 py-3">
                    {row.platformCount === null ? (
                      <span className="text-slate-500">{row.platformLabel}</span>
                    ) : (
                      <span>
                        {row.platformCount}
                        <span className="ml-1 text-xs text-slate-500">{row.platformLabel}</span>
                      </span>
                    )}
                  </td>
                  <td className={`px-4 py-3 ${row.delta && row.delta !== 0 ? "text-amber-200" : "text-slate-400"}`}>
                    {row.delta === null ? "—" : row.delta > 0 ? `+${row.delta}` : row.delta}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {warnings.length ? (
        <div className="space-y-2">
          {warnings.map((warning) => (
            <p key={warning} className="flex items-start gap-2 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{warning}</span>
            </p>
          ))}
        </div>
      ) : null}

      {showLink ? (
        <Link
          href={`/clients/${clientId}/lead-verification`}
          className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/4 px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/8"
        >
          Open full verification
          <ArrowRight className="h-4 w-4" />
        </Link>
      ) : null}
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "slate" | "emerald" | "rose" | "amber";
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
      : tone === "rose"
        ? "border-rose-400/20 bg-rose-500/10 text-rose-100"
        : tone === "amber"
          ? "border-amber-400/20 bg-amber-500/10 text-amber-100"
          : "border-white/8 bg-white/4 text-slate-100";
  return (
    <div className={`rounded-2xl border px-4 py-3 text-center ${toneClass}`}>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-[0.18em] opacity-80">{label}</p>
    </div>
  );
}
