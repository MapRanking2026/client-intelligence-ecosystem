import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { ClientRecord } from "@/src/lib/mtos-data";
import type { IntegrationSnapshotRecord } from "@/src/lib/contracts/integration-sync";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { clientPath, integrationSnapshotPath } from "@/src/lib/server/firebase/collections";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { withQuotaFallback } from "@/src/lib/server/firebase/quota";
import { namesLikelyMatch } from "@/src/lib/server/name-matching";
import { resolveGbpMapping } from "@/src/lib/contracts/client-mappings";
import {
  fetchAllBusinesses,
  fetchCheckinBusinesses,
  openDashboardSession,
} from "@/src/lib/server/services/mapranking-dashboard";

type JsonRecord = Record<string, unknown>;

export type MappingProviderId =
  | "rankTracker"
  | "mapCheckins"
  | "googleBusinessProfile"
  | "gohighlevel"
  | "googleAds"
  | "googleLsa"
  | "metaAds";

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
  return withQuotaFallback(`the ${providerId} snapshot`, null, async () => {
    const doc = await db.doc(integrationSnapshotPath(tenantId, providerId)).get();
    if (!doc.exists) {
      return null;
    }
    return ((doc.data() as IntegrationSnapshotRecord).payload || {}) as JsonRecord;
  });
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
      ? "A pinned listing is read on the next preparation -- its performance and listing health are pulled live for this client."
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
      ? "A pinned sub-account is read on the next preparation, ahead of any automatic match -- its leads are pulled live for this client."
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

  const googleLsaPayload = await readSnapshotPayload(context.tenantId, "google-lsa");
  const googleLsaAccounts = Array.isArray(googleLsaPayload?.accountIndex)
    ? (googleLsaPayload!.accountIndex as JsonRecord[])
    : [];
  providers.push({
    providerId: "googleLsa",
    label: "Google Local Services Ads",
    note: googleLsaAccounts.length
      ? "Charged lead and cost data for newly pinned LSA accounts appears after the next Google LSA sync."
      : "No Local Services account list yet -- connect and run a Google LSA sync in Settings > Integrations to load candidates. Each client's LSA account must be linked to the agency manager account.",
    candidates: googleLsaAccounts.map((account) => ({
      id: String(account.accountId || ""),
      label: String(account.businessName || "Unnamed LSA account"),
      detail: String(account.currencyCode || ""),
    })),
    autoMatchedIds: googleLsaAccounts
      .filter((account) => namesLikelyMatch(client.name, String(account.businessName || "")))
      .map((account) => String(account.accountId || "")),
    manualIds: mappings.googleLsa || [],
  });

  /*
    Meta Ads, pinnable for the first time.

    Meta had OAuth, a token refresh and a green tile, but no sync and no mapping row -- so the only
    way an ad account could ever reach a client was for its Meta name to match the client's name in
    MTOS. A painting company whose ad account is named after its owner had no route at all, which is
    half of why the brief showed Meta as unconnected on a connected tenant.
  */
  const metaAdsPayload = await readSnapshotPayload(context.tenantId, "meta-ads");
  const metaAdsAccounts = Array.isArray(metaAdsPayload?.accountIndex)
    ? (metaAdsPayload!.accountIndex as JsonRecord[])
    : [];
  providers.push({
    providerId: "metaAds",
    label: "Meta Ads",
    note: metaAdsAccounts.length
      ? "A pinned ad account is read on the next Meta Ads sync, ahead of any automatic match."
      : "No Meta ad account list yet -- connect and run a Meta Ads sync in Settings > Integrations to load candidates.",
    candidates: metaAdsAccounts.map((account) => ({
      id: String(account.accountId || ""),
      label: String(account.name || "Unnamed ad account"),
      // "1" is ACTIVE in Meta's own numbering; anything else is worth seeing before pinning,
      // because a closed account is the answer to "why is there no spend".
      detail: [
        String(account.currencyCode || ""),
        String(account.status || "") && String(account.status) !== "1" ? `status ${account.status}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    })),
    autoMatchedIds: metaAdsAccounts
      .filter((account) => namesLikelyMatch(client.name, String(account.name || "")))
      .map((account) => String(account.accountId || "")),
    manualIds: mappings.metaAds || [],
  });

  return {
    clientId: client.id,
    clientName: client.name,
    providers,
  };
}

const mappingKeys: MappingProviderId[] = [
  "rankTracker",
  "mapCheckins",
  "googleBusinessProfile",
  "gohighlevel",
  "googleAds",
  "googleLsa",
  "metaAds",
];

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

  /*
    And apply the Business Profile pin to the shared snapshot now, not on some later sync.

    Every reader resolves pins for itself (see `contracts/client-mappings`), so this is not what
    makes a pin work -- it is what makes a pin VISIBLE in the one place the rest of the application
    and any future reader looks, from the moment the AM presses Save. The owner's words for what
    was wrong: "I linked it and then I saved the mapping, but for some reason it's not picking it
    up over here when it's running the prep." The pin was saved on the client; the map that the
    preparation, the lead reconciliation and the brief all read was not touched until a sync or a
    live refresh happened to succeed.

    Deliberately non-fatal and deliberately additive: the save itself has already happened, the
    pin is already in force, and a snapshot that cannot be written is a stale cache rather than a
    lost instruction.
  */
  if (sanitized.googleBusinessProfile) {
    await applyGbpPinsToSnapshot(context, clientId, sanitized.googleBusinessProfile).catch(() => undefined);
  }

  return sanitized;
}

/**
 * Fold this client's pinned listings into `locationsByClient` in the Business Profile snapshot.
 *
 * Resolved against the locations the snapshot has already discovered, which is the same list the
 * mapping screen offered the AM -- so a pin made from that screen always resolves. A pin naming a
 * listing no sync has seen cannot be folded in and is left alone; the readers report it, and
 * inventing a location record for it would put an empty listing on the brief.
 */
async function applyGbpPinsToSnapshot(
  context: TenantContext,
  clientId: string,
  pinnedIds: string[],
): Promise<void> {
  const db = getFirebaseAdminDb();
  if (!db) return;

  const reference = db.doc(integrationSnapshotPath(context.tenantId, "google-business-profile"));
  const document = await reference.get();
  if (!document.exists) return;

  const payload = ((document.data() as IntegrationSnapshotRecord).payload || {}) as JsonRecord;
  const locationsByClient = (payload.locationsByClient || {}) as JsonRecord;
  const mapping = resolveGbpMapping({
    discovered: Array.isArray(payload.locations) ? (payload.locations as JsonRecord[]) : [],
    stored: Array.isArray(locationsByClient[clientId]) ? (locationsByClient[clientId] as JsonRecord[]) : [],
    pinnedIds,
  });

  /*
    An unpin has to be able to remove a listing, so this writes the resolved list rather than
    merging into it -- but only the listings that are still pinned or still matched by name. The
    resolver keeps name matches in, so unpinning never costs a client the listing its title earned.
  */
  await reference.set(
    { payload: { locationsByClient: { ...locationsByClient, [clientId]: mapping.locations } } },
    { merge: true },
  );
}
