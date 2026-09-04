import Link from "next/link";
import { Phone, ArrowRight, Sparkles, ShieldAlert, BadgeCheck } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { LeadVerificationQuickActions } from "@/src/components/mtos/lead-verification-quick-actions";
import { Callout, Hl } from "@/src/components/mtos/annotate";
import { ClientHint } from "@/src/components/mtos/client-hint";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getClientsDirectoryView } from "@/src/lib/server/services/clients-service";
import { getStoredLeadVerification } from "@/src/lib/server/services/lead-verification-service";
import {
  LEAD_CATEGORY_LABEL,
  LEAD_CHANNEL_LABEL,
  type LeadCategory,
  type LeadVerificationReview,
} from "@/src/lib/mtos-data";

const CAT_COLOR: Record<LeadCategory, string> = {
  valid_new_lead: "var(--good)",
  spam: "var(--risk)",
  duplicate: "var(--risk)",
  existing_customer: "var(--slate-400)",
  wrong_number: "var(--risk)",
  sales_solicitation: "var(--risk)",
  out_of_area: "var(--risk)",
  incomplete: "var(--watch)",
  irrelevant: "var(--slate-400)",
};

function initials(name: string) {
  return name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function StatTile({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: "good" | "risk" | "watch" }) {
  return (
    <div className="card" style={{ padding: "16px 18px" }}>
      <div className="stat-label">{label}</div>
      <div className="stat-val mt-3" style={tone ? { color: `var(--${tone})` } : undefined}>
        {value}
      </div>
      {sub ? <div className="muted mt-1.5 text-[0.74rem]">{sub}</div> : null}
    </div>
  );
}

function Analytics({ review }: { review: LeadVerificationReview }) {
  const total = review.totals.total || 1;
  const callLeads = review.leads.filter((l) => l.type === "call");

  const catCounts = review.leads.reduce<Record<string, number>>((acc, l) => {
    acc[l.category] = (acc[l.category] || 0) + 1;
    return acc;
  }, {});
  const cats = (Object.keys(catCounts) as LeadCategory[]).sort((a, b) => catCounts[b] - catCounts[a]);

  return (
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Total leads & calls" value={review.totals.total} sub={`${callLeads.length} calls`} />
        <StatTile label="Valid (revenue-relevant)" value={review.totals.valid} sub={`${Math.round((review.totals.valid / total) * 100)}% of total`} tone="good" />
        <StatTile label="Missed calls" value={review.totals.missedCalls} sub="voicemail / no-answer" tone={review.totals.missedCalls > 0 ? "risk" : undefined} />
        <StatTile label="Flagged / invalid" value={review.totals.flagged} sub="spam, wrong-number, out-of-area" tone={review.totals.flagged > 0 ? "watch" : undefined} />
      </div>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* Categorization */}
        <div className="card">
          <div className="card-head">
            <div className="card-title">
              <Sparkles />
              Auto-categorization
            </div>
            <span className="muted text-[0.76rem]">{review.totals.valid} of {review.totals.total} valid</span>
          </div>
          <div className="catbar mb-4">
            {cats.map((c) => (
              <span key={c} style={{ width: `${(catCounts[c] / total) * 100}%`, background: CAT_COLOR[c] }} title={`${LEAD_CATEGORY_LABEL[c]}: ${catCounts[c]}`} />
            ))}
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {cats.map((c) => (
              <div key={c} className="flex items-center justify-between py-0.5">
                <span className="flex items-center gap-2">
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: CAT_COLOR[c] }} />
                  <span className="text-[0.85rem]" style={{ color: "var(--text-2)" }}>
                    {LEAD_CATEGORY_LABEL[c]}
                  </span>
                </span>
                <span className="font-bold" style={{ color: "var(--text)" }}>
                  {catCounts[c]}
                  <span className="muted text-[0.72rem]" style={{ fontWeight: 500 }}>
                    {" "}· {Math.round((catCounts[c] / total) * 100)}%
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Channel attribution */}
        <div className="card" style={{ padding: 8 }}>
          <div className="mb-1 px-3 pt-3">
            <div className="card-title">Channel attribution</div>
          </div>
          <div className="table-scroll">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Total</th>
                  <th>Valid</th>
                  <th>Flagged</th>
                </tr>
              </thead>
              <tbody>
                {review.byChannel.map((ch) => (
                  <tr key={ch.channel}>
                    <td style={{ fontWeight: 600, color: "var(--text)" }}>{LEAD_CHANNEL_LABEL[ch.channel]}</td>
                    <td>{ch.total}</td>
                    <td style={{ color: "var(--good)", fontWeight: 600 }}>{ch.valid}</td>
                    <td style={{ color: ch.flagged > 0 ? "var(--risk)" : "var(--slate-400)" }}>{ch.flagged}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {review.totals.missedCalls > 0 ? (
        <div className="mt-4">
          <Callout
            tone="critical"
            title={
              <>
                <Hl tone="critical">{review.totals.missedCalls} missed calls</Hl> in this window
              </>
            }
          >
            Every missed call is a lead that rang through but wasn&apos;t answered. Listen to the recordings below and
            recover the ones that matter — <Hl tone="critical">this is where revenue leaks</Hl>.
          </Callout>
        </div>
      ) : null}
    </>
  );
}

export default async function CallIntelligencePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { client: clientId } = await searchParams;
  const context = await resolveTenantContext();
  const { clients } = await getClientsDirectoryView(context);

  const selected = clientId ? clients.find((c) => c.id === clientId) : undefined;
  let review: LeadVerificationReview | null = null;
  let loadError = false;
  if (selected) {
    try {
      review = await getStoredLeadVerification(context, selected.id);
    } catch {
      // Firestore read failed (e.g. quota exceeded / transient) — degrade gracefully.
      loadError = true;
    }
  }

  return (
    <AppShell>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="eyebrow muted">
            <Phone />
            <span>Call Intelligence</span>
          </div>
          <h2 className="h2 mt-2">Are we delivering calls that become revenue?</h2>
          <p className="muted mt-1.5 text-[0.88rem]">
            Every call and lead pulled from GoHighLevel, auto-categorized, attributed to a channel, and playable — so you
            can verify what&apos;s real and recover what was missed.
          </p>
        </div>
        {selected ? (
          <Link href="/calls" className="chip">
            Switch client
          </Link>
        ) : null}
      </div>

      {!selected ? (
        <div className="mt-6">
          <div className="section-head" style={{ marginTop: 0 }}>
            <div className="h4">Choose a client to review their calls</div>
          </div>
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
            {clients.map((c) => (
              <Link key={c.id} href={`/calls?client=${c.id}`} className="card is-hover flex items-center gap-3">
                <div className="av-sm" style={{ width: 42, height: 42, borderRadius: 12, fontSize: "0.9rem", background: "var(--accent)" }}>
                  {initials(c.name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold" style={{ color: "var(--text)" }}>
                    {c.name}
                  </div>
                  <div className="muted text-[0.78rem]">{c.industry}</div>
                </div>
                <ArrowRight style={{ width: 16, height: 16, color: "var(--slate-400)" }} />
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-6">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2.5">
              <div className="av-sm" style={{ width: 38, height: 38, borderRadius: 11, background: "var(--accent)" }}>
                {initials(selected.name)}
              </div>
              <div className="h3">
                <ClientHint client={selected} />
              </div>
            </div>
            {review?.generatedAt ? (
              <span className="chip good">
                <span className="sig-dot good" />
                GoHighLevel · synced {new Date(review.generatedAt).toLocaleDateString("en-US")}
              </span>
            ) : (
              <span className="chip">Not yet pulled</span>
            )}
          </div>

          {review && review.leads.length ? (
            <Analytics review={review} />
          ) : loadError ? (
            <div className="insight watch mt-2" style={{ gridTemplateColumns: "auto 1fr" }}>
              <div className="insight-icon">
                <ShieldAlert />
              </div>
              <div>
                <div className="h4">Couldn&apos;t load stored calls right now</div>
                <p className="muted mt-1.5 text-[0.85rem]">
                  The data store returned an error (often a Firestore read-quota limit or a transient hiccup). You can
                  still run a fresh pull below, or retry shortly.
                </p>
              </div>
            </div>
          ) : (
            <div className="insight info mt-2" style={{ gridTemplateColumns: "auto 1fr" }}>
              <div className="insight-icon">
                <BadgeCheck />
              </div>
              <div>
                <div className="h4">No stored pull yet for {selected.name}</div>
                <p className="muted mt-1.5 text-[0.85rem]">
                  Run a pull below to fetch this client&apos;s calls and leads from GoHighLevel for your chosen window,
                  auto-categorize them, and reconcile the channel counts.
                </p>
              </div>
            </div>
          )}

          {/* The proven interactive engine: window pull, lead-by-lead verify, recordings */}
          <div className="card mt-4">
            <div className="mb-4">
              <div className="eyebrow muted">
                <ShieldAlert />
                <span>Pull, verify & listen</span>
              </div>
              <div className="h4 mt-1.5">Run a window & play recordings</div>
              <p className="muted mt-1 text-[0.82rem]">
                Pull the last 7 / 30 / 90 days (or a custom range) from GoHighLevel, vet each call lead-by-lead, and play
                the recording for anything that needs a listen.
              </p>
            </div>
            <LeadVerificationQuickActions clientId={selected.id} initialReview={review} />
          </div>
        </div>
      )}
    </AppShell>
  );
}
