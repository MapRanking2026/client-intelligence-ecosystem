import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { ClientRecord } from "@/src/lib/mtos-data";
import type { IntegrationSnapshotRecord } from "@/src/lib/contracts/integration-sync";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { clientPath, integrationSnapshotPath } from "@/src/lib/server/firebase/collections";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { namesLikelyMatch } from "@/src/lib/server/name-matching";
import {
  fetchAllBusinesses,
  fetchCheckinBusinesses,
  openDashboardSession,
} from "@/src/lib/server/services/mapranking-dashboard";

type JsonRecord = Record<string, unknown>;

export type MappingProviderId = "rankTracker" | "mapCheckins" | "googleBusinessProfile" | "gohighlevel" | "googleAds";

export interface MappingCandidate {
  id: string;
  label: string;
  detail: string;
}

export interface ProviderMappingView {
  providerId: MappingProviderId;
  label: string;
  note?: string;
  candidates: MappingCandidate[];
  autoMatchedIds: string[];
  manualIds: string[];
}

export interface ClientMappingView {
  clientId: string;
  clientName: string;
  providers: ProviderMappingView[];
}

async function readSnapshotPayload(tenantId: string, providerId: string): Promise<JsonRecord | null> {
  const db = getFirebaseAdminDb();
  if (!db) {
    return null;
  }
  const doc = await db.doc(integrationSnapshotPath(tenantId, providerId)).get();
  if (!doc.exists) {
    return null;
  }
  return ((doc.data() as IntegrationSnapshotRecord).payload || {}) as JsonRecord;
}

export async function getClientMappingView(
  context: TenantContext,
  clientId: string,
): Promise<ClientMappingView | null> {
  const dataSource = getMtosDataSource(context);
  const client = await dataSource.getClientById(clientId);
  if (!client) {
    return null;
  }

  const mappings = client.integrationMappings || {};
  const providers: ProviderMappingView[] = [];

  // Rank Tracker + Map Check-Ins candidates come live from the dashboard so brand-new
  // profiles are pinnable immediately.
  let rankTrackerCandidates: MappingCandidate[] = [];
  let rankTrackerAuto: string[] = [];
  let checkinCandidates: MappingCandidate[] = [];
  let checkinAuto: string[] = [];
  let dashboardNote: string | undefined;
  try {
    const session = await openDashboardSession(context);
    if (session) {
      const businesses = await fetchAllBusinesses(session);
      rankTrackerCandidates = businesses.map((business) => ({
        id: business.businessId,
        label: business.businessName,
        detail: business.address,
      }));
      rankTrackerAuto = businesses
        .filter((business) => namesLikelyMatch(client.name, business.businessName))
        .map((business) => business.businessId);

      const checkins = await fetchCheckinBusinesses(session);
      checkinCandidates = checkins.map((business) => ({
        id: business.businessId,
        label: business.businessName,
        detail: `${business.totalPosts} posts · ${business.address || "no address"}`,
      }));
      checkinAuto = checkins
        .filter((business) => namesLikelyMatch(client.name, business.businessName))
        .map((business) => business.businessId);
    } else {
      dashboardNote = "Rank Tracker connection unavailable -- connect it in Settings > Integrations to load candidates.";
    }
  } catch (error) {
    dashboardNote = `Could not load live candidates: ${error instanceof Error ? error.message : "unknown error"}`;
  }

  providers.push({
    providerId: "rankTracker",
    label: "Rank Tracker",
    note: dashboardNote,
    candidates: rankTrackerCandidates,
    autoMatchedIds: rankTrackerAuto,
    manualIds: mappings.rankTracker || [],
  });
  providers.push({
    providerId: "mapCheckins",
    label: "Map Check-Ins",
    note: dashboardNote,
    candidates: checkinCandidates,
    autoMatchedIds: checkinAuto,
    manualIds: mappings.mapCheckins || [],
  });

  const gbpPayload = await readSnapshotPayload(context.tenantId, "google-business-profile");
  const gbpLocations = Array.isArray(gbpPayload?.locations) ? (gbpPayload!.locations as JsonRecord[]) : [];
  providers.push({
    providerId: "googleBusinessProfile",
    label: "Google Business Profile",
    note: gbpLocations.length
      ? "Performance data for newly pinned locations appears after the next GBP sync."
      : "No GBP snapshot yet -- run a GBP sync in Settings > Integrations to load candidates.",
    candidates: gbpLocations.map((location) => ({
      id: String(location.name || "").split("/").filter(Boolean).pop() || "",
      label: String(location.title || "Untitled location"),
      detail: String(location.storeCode || location.websiteUri || location.accountName || ""),
    })),
    autoMatchedIds: gbpLocations
      .filter((location) => namesLikelyMatch(client.name, String(location.title || "")))
      .map((location) => String(location.name || "").split("/").filter(Boolean).pop() || ""),
    manualIds: mappings.googleBusinessProfile || [],
  });

  const ghlPayload = await readSnapshotPayload(context.tenantId, "gohighlevel");
  const ghlLocations = Array.isArray(ghlPayload?.locationIndex) ? (ghlPayload!.locationIndex as JsonRecord[]) : [];
  providers.push({
    providerId: "gohighlevel",
    label: "GoHighLevel",
    note: ghlLocations.length
      ? "Lead data for newly pinned locations appears after the next GoHighLevel sync."
      : "No GoHighLevel location list yet -- run a GoHighLevel sync in Settings > Integrations to load candidates.",
    candidates: ghlLocations.map((location) => ({
      id: String(location.id || ""),
      label: String(location.name || "Unnamed location"),
      detail: "",
    })),
    autoMatchedIds: ghlLocations
      .filter((location) => namesLikelyMatch(client.name, String(location.name || "")))
      .map((location) => String(location.id || "")),
    manualIds: mappings.gohighlevel || [],
  });

  const googleAdsPayload = await readSnapshotPayload(context.tenantId, "google-ads");
  const googleAdsCustomers = Array.isArray(googleAdsPayload?.customerIndex)
    ? (googleAdsPayload!.customerIndex as JsonRecord[])
    : [];
  providers.push({
    providerId: "googleAds",
    label: "Google Ads",
    note: googleAdsCustomers.length
      ? "Spend and conversion data for newly pinned Google Ads accounts appears after the next Google Ads sync."
      : "No Google Ads customer list yet -- connect and run a Google Ads sync in Settings > Integrations to load candidates.",
    candidates: googleAdsCustomers.map((customer) => ({
      id: String(customer.customerId || customer.id || ""),
      label: String(customer.descriptiveName || customer.name || "Unnamed account"),
      detail: String(customer.currencyCode || customer.manager ? `Manager: ${customer.manager}` : customer.id || ""),
    })),
    autoMatchedIds: googleAdsCustomers
      .filter((customer) => namesLikelyMatch(client.name, String(customer.descriptiveName || customer.name || "")))
      .map((customer) => String(customer.customerId || customer.id || "")),
    manualIds: mappings.googleAds || [],
  });

  return {
    clientId: client.id,
    clientName: client.name,
    providers,
  };
}

const mappingKeys: MappingProviderId[] = ["rankTracker", "mapCheckins", "googleBusinessProfile", "gohighlevel", "googleAds"];

export async function saveClientMappings(
  context: TenantContext,
  clientId: string,
  mappings: Partial<Record<MappingProviderId, string[]>>,
) {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firebase Admin must be configured before mappings can be saved");
  }

  const dataSource = getMtosDataSource(context);
  const client = await dataSource.getClientById(clientId);
  if (!client) {
    throw new Error("Client not found or not visible for the current user");
  }

  const sanitized: ClientRecord["integrationMappings"] = {};
  for (const key of mappingKeys) {
    const values = mappings[key];
    if (Array.isArray(values)) {
      sanitized[key] = Array.from(new Set(values.map((value) => String(value).trim()).filter(Boolean))).slice(0, 20);
    }
  }

  await db.doc(clientPath(context.tenantId, clientId)).set({ integrationMappings: sanitized }, { merge: true });
  return sanitized;
}
