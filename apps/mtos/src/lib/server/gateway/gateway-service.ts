import {
  CanonicalClientV1,
  MapCheckinActivityV1,
  ProviderHealthV1,
  type GatewayResource,
} from "@cie/contracts";
import type { TenantContext } from "@/src/lib/contracts/mtos";
import { listIntegrationViews } from "@/src/lib/server/integrations";
import { getClientsDirectoryView } from "@/src/lib/server/services/clients-service";
import {
  fetchCheckinBusinesses,
  openDashboardSession,
} from "@/src/lib/server/services/mapranking-dashboard";

/**
 * MTOS-side gateway service. Exposes SECRET-FREE, read-only views of MTOS's
 * existing integration connections to the ecosystem, so SEOOS reuses the same
 * connections without duplicating credentials or forcing reconnection.
 * Credentials never leave the MTOS server boundary here.
 */
export async function getIntegrationHealth(
  context: TenantContext,
): Promise<ProviderHealthV1[]> {
  const views = await listIntegrationViews(context);
  return views.map((v) =>
    ProviderHealthV1.parse({
      schemaVersion: 1,
      id: v.id,
      name: v.name,
      category: v.category,
      status: v.status,
      statusDetail: v.statusDetail ?? "",
      isConnected: v.isConnected,
      isShared: v.isShared,
      supportsSync: v.supportsSync,
      lastSyncAt: v.lastSyncAt,
      lastSyncStatus: v.lastSyncStatus,
      tokenExpiresAt: v.tokenExpiresAt,
    }),
  );
}

export interface DispatchResult {
  data?: unknown;
  freshness: "live" | "cached" | "stale" | "unknown";
  dataGaps: { schemaVersion: 1; area: string; reason: string; severity: "info" | "warning" | "blocking" }[];
}

/**
 * Dispatch a gateway resource. `integration-health` is fully wired to real MTOS
 * connection state; data resources return a structured data gap until their
 * normalized MTOS adapter is exposed here (never fabricated numbers).
 */
export async function dispatchGatewayResource(
  context: TenantContext,
  resource: GatewayResource,
): Promise<DispatchResult> {
  if (resource === "integration-health") {
    return {
      data: await getIntegrationHealth(context),
      freshness: "live",
      dataGaps: [],
    };
  }

  if (resource === "clients.list") {
    // The canonical client roster (MTOS owns it; synced from ClickUp).
    const { clients } = await getClientsDirectoryView(context);
    const data = clients.map((c) =>
      CanonicalClientV1.parse({
        id: c.id,
        name: c.name,
        industry: c.industry || undefined,
        lifecycleStage: c.lifecycleStage || undefined,
        accountManager: c.accountManager || undefined,
        location: c.location || undefined,
        healthScore: typeof c.healthScore === "number" ? c.healthScore : undefined,
      }),
    );
    return { data, freshness: "live", dataGaps: [] };
  }

  if (resource === "map-checkins.activity") {
    // Reuse the EXISTING tenant-wide Map Check-Ins connection and normalized
    // data. No connection → an honest data gap, never fabricated activity.
    const session = await openDashboardSession(context);
    if (!session) {
      return {
        freshness: "unknown",
        dataGaps: [
          {
            schemaVersion: 1,
            area: "map-checkins",
            reason: "No Map Check-Ins connection is available for this tenant.",
            severity: "warning",
          },
        ],
      };
    }
    const businesses = await fetchCheckinBusinesses(session);
    const data = MapCheckinActivityV1.parse({
      businesses,
      businessCount: businesses.length,
      totalPosts: businesses.reduce((sum, b) => sum + b.totalPosts, 0),
    });
    return { data, freshness: "live", dataGaps: [] };
  }

  return {
    freshness: "unknown",
    dataGaps: [
      {
        schemaVersion: 1,
        area: resource,
        reason:
          "Normalized adapter for this resource is not yet exposed through the gateway.",
        severity: "info",
      },
    ],
  };
}
