import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import {
  refreshGbpInsightsForClient,
  refreshGhlLeadsForClient,
  refreshSnapshotsForPrep,
  type PrepSnapshotRefresh,
} from "@/src/lib/server/integration-sync";
import { getNowIso } from "@/src/lib/server/services/mtos-ai";
import { rewriteTouchPerformancePanels } from "@/src/lib/server/services/monthly-touch-prep-service";

/**
 * "Refresh this client's performance", as one button.
 *
 * The Performance tab on a client opens with a card admitting what it is: "Snapshot, not live data.
 * Taken when the preparation last ran. Run the preparation again for current numbers." Honest, and
 * not much use -- the preparation is a three-to-five-minute job that re-reads every platform, calls
 * the model, and rewrites the agenda and the recommendations. Nobody sets that off because they
 * would like to see this month's call volume before a client rings.
 *
 * So this is the data half on demand: re-read the platforms, rebuild the three performance panels,
 * leave everything the model wrote alone.
 *
 * ## Why it lives here
 *
 * It needs the per-client refreshers from `integration-sync` and the panel builders from
 * `monthly-touch-prep-service`, and `integration-sync` already imports that module to re-prepare
 * touches after a sync. Importing the refreshers into the prep service would close that cycle, so
 * the orchestration sits in a third file that is free to import both -- the same arrangement
 * `prep-workflow-service` uses for the preparation itself.
 */

export interface ClientPerformanceRefresh {
  refreshedAt: string;
  /** One line per platform, in the AM's words: what was asked and what came back. */
  sources: { label: string; status: string; detail: string }[];
  /** True when the three performance panels were rewritten from the refreshed data. */
  rebuilt: boolean;
  message: string;
}

/** The display names the preparation's own source summary uses, so both screens agree. */
const PROVIDER_LABEL: Record<string, string> = {
  clickup: "ClickUp",
  "google-calendar": "Google Calendar",
  "google-business-profile": "Google Business Profile",
  "google-search-console": "Google Search Console",
  "rank-tracker": "Rank Tracker",
  "map-checkins": "Map Check-ins",
  gohighlevel: "GoHighLevel",
  "google-ads": "Google Ads",
  "google-lsa": "Google Local Services Ads",
  "meta-ads": "Meta Ads",
};

export async function refreshClientPerformance(
  context: TenantContext,
  clientId: string,
): Promise<ClientPerformanceRefresh> {
  const dataSource = getMtosDataSource(context);
  const client = await dataSource.getClientById(clientId);
  if (!client) {
    throw new Error("Client not found or not visible for the current user");
  }

  /*
    The Business Profile and the GoHighLevel sub-account are per-client reads and honour this
    client's pins; the rest are tenant-wide provider snapshots. All three run together because they
    hit different APIs and none depends on another.

    `freshWithinMs: 0` because the automatic refresh inside a preparation skips a provider pulled
    recently, and the entire point of a button is that the person pressing it wants it asked again
    now. Every one of them is non-fatal: a refused platform is a line on the screen, not a failed
    refresh, because the other platforms' numbers are still worth having.
  */
  const [gbp, snapshots, ghl] = await Promise.all([
    refreshGbpInsightsForClient(context, clientId).catch((error: unknown) => ({
      status: "failed" as const,
      locations: 0,
      detail: error instanceof Error ? error.message : "The Business Profile refresh failed.",
    })),
    refreshSnapshotsForPrep(context, { freshWithinMs: 0 }).catch(() => [] as PrepSnapshotRefresh[]),
    refreshGhlLeadsForClient(context, clientId, client.name).catch((error: unknown) => ({
      status: "failed" as const,
      detail: error instanceof Error ? error.message : "The GoHighLevel refresh failed.",
    })),
  ]);

  const sources: ClientPerformanceRefresh["sources"] = [
    { label: "Google Business Profile", status: gbp.status, detail: gbp.detail },
    { label: "GoHighLevel", status: ghl.status, detail: ghl.detail },
    ...snapshots.map((entry) => ({
      label: PROVIDER_LABEL[entry.providerId] || entry.providerId,
      status: entry.status,
      detail: entry.detail,
    })),
  ];

  const refreshedAt = getNowIso();
  const { rebuilt } = await rewriteTouchPerformancePanels(context, clientId, refreshedAt);

  const answered = sources.filter((entry) => entry.status === "refreshed").length;

  return {
    refreshedAt,
    sources,
    rebuilt,
    message: rebuilt
      ? `Re-read ${answered} of ${sources.length} platforms and rewrote the scorecard, the local visibility panel and the paid-media panel. The brief, the agenda and the recommendations are untouched.`
      : `Re-read ${answered} of ${sources.length} platforms, but this client has no Monthly Touch yet, so there is no performance snapshot to rewrite. The next preparation will use what was pulled just now.`,
  };
}
