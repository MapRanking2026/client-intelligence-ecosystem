import { SourceChips } from "@/src/components/mtos/source-chip";
import {
  findClientChip,
  unlinkedChip,
  type SourceChip,
  type SourceKind,
} from "@/src/lib/contracts/brief-sources";
import type { ClientRecord, MonthlyTouchRecord } from "@/src/lib/mtos-data";

/**
 * The header of the brief: who, when, what data — and what is missing.
 *
 * Built from the real records rather than written by the model, because every line here is a fact
 * the application already holds and a model asked to restate it can only get it wrong. Where a
 * fact is genuinely absent it says so in the AM's words and, where it matters for the call, it is
 * listed as something to confirm. A dash is the honest rendering of "not recorded"; a zero or a
 * confident-looking blank is not.
 */

const PROVIDER_KIND: Record<string, SourceKind> = {
  clickup: "clickup",
  intercom: "intercom",
  gmail: "gmail",
  google_business_profile: "gbp",
  googleBusinessProfile: "gbp",
  gbp: "gbp",
  google_ads: "google-ads",
  googleAds: "google-ads",
  google_analytics: "analytics",
  googleAnalytics: "analytics",
  search_console: "search-console",
  gohighlevel: "ghl",
  stripe: "stripe",
  quickbooks: "quickbooks",
  google_calendar: "calendar",
  googleCalendar: "calendar",
  google_drive: "drive",
  meta_ads: "meta",
  metaAds: "meta",
  google_lsa: "lsa",
  googleLsa: "lsa",
  map_checkins: "map-checkins",
  mapCheckins: "map-checkins",
  rank_tracker: "rank-tracker",
  rankTracker: "rank-tracker",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-3">
      <div className="eyebrow muted" style={{ paddingTop: 2 }}>
        {label}
      </div>
      <div className="text-[0.86rem] leading-6" style={{ color: "var(--text-2)" }}>
        {children}
      </div>
    </div>
  );
}

function Unknown({ what }: { what: string }) {
  return <span className="muted">— {what}</span>;
}

export function BriefHeader({
  client,
  touch,
  accountManager,
  timeZone,
}: {
  client: ClientRecord;
  touch: MonthlyTouchRecord;
  accountManager: { name: string; email: string };
  timeZone: string;
}) {
  const prepPack = touch.prepPack;
  const scheduled = touch.scheduledAt || prepPack?.schedule.scheduledAt;
  const meetingLink = touch.googleMeeting?.meetingUrl;

  const sourceChips: SourceChip[] = (prepPack?.integrationSources || [])
    .map((source) => {
      const kind = PROVIDER_KIND[source.providerId];
      if (!kind) return undefined;
      return unlinkedChip(kind, `${source.label} · synced ${shortDate(source.syncedAt, timeZone)}`);
    })
    .filter((chip): chip is SourceChip => Boolean(chip));

  const accountIds = Object.entries(client.integrationMappings || {})
    .filter(([, ids]) => Array.isArray(ids) && ids.length)
    .map(([key, ids]) => `${mappingLabel(key)}: ${(ids as string[]).join(", ")}`);

  return (
    <div className="flex flex-col gap-3">
      <Row label="Client">
        <strong style={{ color: "var(--text)" }}>{client.name}</strong>
        {client.industry ? ` — ${client.industry}` : ""}
        {client.location ? ` · ${client.location}` : ""}
        <div className="muted mt-0.5 text-[0.8rem]">
          Services:{" "}
          {prepPack?.focusAreas?.length ? (
            prepPack.focusAreas.join(", ")
          ) : (
            <Unknown what="no service list on this client in MTOS; confirm what we deliver" />
          )}
        </div>
        <SourceChips chips={[unlinkedChip("clickup", "Client Health Tracker"), findClientChip()]} />
      </Row>

      <Row label="Call">
        {scheduled ? (
          <>
            {longDateTime(scheduled, timeZone)} <span className="muted">(your time)</span>
          </>
        ) : (
          <Unknown what={`no time on the calendar event; the touch is dated ${client.touchDate}`} />
        )}
        <div className="muted mt-0.5 text-[0.8rem]">
          The client&apos;s own time zone is not recorded in MTOS — say the time in their zone on the invite and in
          the agenda email.
        </div>
        {meetingLink ? (
          <div className="mt-1">
            <a className="ilink text-[0.82rem]" href={meetingLink} target="_blank" rel="noreferrer">
              {meetingLink}
            </a>
          </div>
        ) : (
          <div className="mt-1">
            <Unknown what="no Google Meet link selected for this touch yet" />
          </div>
        )}
      </Row>

      <Row label="Who is on it">
        Account manager: {accountManager.name || client.accountManager || <Unknown what="not recorded" />}
        <div className="mt-0.5">
          Client contact: {client.contact || <Unknown what="not recorded" />}
          <span className="muted"> · role not recorded in MTOS</span>
        </div>
      </Row>

      <Row label="Account">
        {client.lifecycleStage ? `${client.lifecycleStage} stage` : <Unknown what="stage not recorded" />}
        {client.tenure ? ` · with us ${client.tenure}` : ""}
        {client.mrr ? ` · ${client.mrr} MRR` : ""}
        <div className="muted mt-0.5 text-[0.8rem]">
          Direct or white label is held in the Client Health Tracker, not in MTOS — check the row before you talk
          about billing.
        </div>
      </Row>

      <Row label="Reporting period">
        {prepPack ? (
          <>
            Prepared {longDateTime(prepPack.preparedAt, timeZone)} for the {client.touchDate} touch.
            <div className="muted mt-0.5 text-[0.8rem]">
              Every number in this brief carries its own period and source on the line it appears.
            </div>
          </>
        ) : (
          <Unknown what="the account review has not run for this touch" />
        )}
      </Row>

      <Row label="Data sources">
        {sourceChips.length ? (
          <SourceChips chips={sourceChips} className="mt-0" />
        ) : (
          <Unknown what="no integration reached during the account review" />
        )}
      </Row>

      {accountIds.length ? (
        <Row label="Account IDs">
          <span className="font-mono text-[0.78rem]">{accountIds.join(" · ")}</span>
        </Row>
      ) : null}

      {prepPack?.dataGaps?.length ? (
        <div
          className="mt-1 rounded-[10px] p-3"
          style={{ background: "var(--watch-bg)", border: "1px solid transparent" }}
        >
          <div className="eyebrow" style={{ color: "var(--watch)" }}>
            Confirm before or during the call
          </div>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {prepPack.dataGaps.map((gap) => (
              <li key={gap} className="text-[0.84rem] leading-6" style={{ color: "var(--text-2)" }}>
                {gap}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function mappingLabel(key: string): string {
  switch (key) {
    case "rankTracker":
      return "Rank Tracker";
    case "mapCheckins":
      return "Map Check-Ins";
    case "googleBusinessProfile":
      return "Google profile";
    case "gohighlevel":
      return "GoHighLevel";
    case "googleAds":
      return "Google Ads";
    case "googleLsa":
      return "Local Services Ads";
    default:
      return key;
  }
}

function longDateTime(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function shortDate(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(date);
}
