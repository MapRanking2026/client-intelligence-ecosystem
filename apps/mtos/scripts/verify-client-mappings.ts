/**
 * Does this client's mapping actually resolve, right now, for every provider?
 *
 * The owner pinned Belza Painting and Resurfacing's Business Profile listing, saved it, re-ran the
 * preparation, and was told none of the 227 synced locations matched the client by name -- twice in
 * one day, the second time after the pin was already being honoured inside the per-client refresh.
 * The reason was that a pin only reached the rest of the application by being WRITTEN into the
 * shared snapshot at the end of a live Google read, so any failure in that read discarded it.
 *
 * That is fixed by resolving pins at read time (`src/lib/contracts/client-mappings.ts`), and this
 * script is how you confirm it for a real client without running a preparation and reading a brief:
 * it loads the stored snapshots and the client record exactly as the preparation does, runs the
 * same resolver, and prints what the preparation would see.
 *
 * ## Read-only
 *
 * It syncs nothing, writes nothing and refreshes no token. A diagnostic that repairs its own
 * subject destroys the evidence -- and the point here is to see what the stored state resolves to,
 * not to make it resolve. It prints no secret.
 *
 *   npx tsx scripts/verify-client-mappings.ts --tenant map-ranking --client "Belza"
 *   npx tsx scripts/verify-client-mappings.ts --tenant map-ranking            (every client)
 *   npx tsx scripts/verify-client-mappings.ts --tenant map-ranking --unmapped (only the gaps)
 */
import { loadEnvConfig } from "@next/env";

import { clientsCollectionPath, integrationSnapshotPath } from "@/src/lib/server/firebase/collections";
import { namesLikelyMatch } from "@/src/lib/server/name-matching";
import {
  gbpLocationId,
  resolveAccountIds,
  resolveGbpMapping,
  resolveGhlLocationId,
  suggestMappingCandidates,
} from "@/src/lib/contracts/client-mappings";
import type { ClientRecord } from "@/src/lib/mtos-data";
import type { IntegrationSnapshotRecord } from "@/src/lib/contracts/integration-sync";

type JsonRecord = Record<string, unknown>;

function flagValue(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const ONLY_UNMAPPED = process.argv.includes("--unmapped");

function list(values: string[], limit = 4): string {
  if (!values.length) return "none";
  return values.length <= limit
    ? values.join(", ")
    : `${values.slice(0, limit).join(", ")} … (+${values.length - limit})`;
}

async function main() {
  loadEnvConfig(process.cwd());
  const { getFirebaseAdminDb } = await import("@/src/lib/server/firebase/admin");
  const db = getFirebaseAdminDb();
  if (!db) {
    console.error("Firebase Admin is not configured, so there is nothing to read. Set the service account env vars.");
    process.exit(1);
  }

  const tenantId = flagValue("--tenant") || process.env.MTOS_DEFAULT_TENANT_ID || "map-ranking";
  const nameFilter = (flagValue("--client") || "").toLowerCase();

  const readPayload = async (providerId: string): Promise<JsonRecord | null> => {
    const document = await db.doc(integrationSnapshotPath(tenantId, providerId)).get();
    if (!document.exists) return null;
    return ((document.data() as IntegrationSnapshotRecord).payload || {}) as JsonRecord;
  };

  const [gbp, ghl, googleAds, lsa, meta] = await Promise.all([
    readPayload("google-business-profile"),
    readPayload("gohighlevel"),
    readPayload("google-ads"),
    readPayload("google-lsa"),
    readPayload("meta-ads"),
  ]);

  const snapshot = await db.collection(clientsCollectionPath(tenantId)).get();
  const clients = snapshot.docs
    .map((doc) => doc.data() as ClientRecord)
    .filter((client) => !nameFilter || (client.name || "").toLowerCase().includes(nameFilter))
    .sort((left, right) => (left.name || "").localeCompare(right.name || ""));

  console.log(`Tenant ${tenantId} · ${clients.length} client${clients.length === 1 ? "" : "s"}${
    nameFilter ? ` matching "${nameFilter}"` : ""
  }`);
  console.log(
    [
      "",
      "Snapshots in the database:",
      `  Business Profile  ${gbp ? `${(gbp.locations as unknown[] | undefined)?.length ?? 0} locations discovered` : "NEVER SYNCED"}`,
      `  GoHighLevel       ${ghl ? `${(ghl.locationIndex as unknown[] | undefined)?.length ?? 0} sub-accounts visible` : "NEVER SYNCED"}`,
      `  Google Ads        ${googleAds ? `${(googleAds.customerIndex as unknown[] | undefined)?.length ?? 0} accounts` : "NEVER SYNCED"}`,
      `  Local Services    ${lsa ? `${(lsa.accountIndex as unknown[] | undefined)?.length ?? 0} accounts` : "NEVER SYNCED"}`,
      `  Meta Ads          ${meta ? `${(meta.accountIndex as unknown[] | undefined)?.length ?? 0} ad accounts` : "NEVER SYNCED"}`,
    ].join("\n"),
  );

  const gbpDiscovered = Array.isArray(gbp?.locations) ? (gbp!.locations as JsonRecord[]) : [];
  const gbpByClient = (gbp?.locationsByClient || {}) as JsonRecord;
  const ghlIndex = Array.isArray(ghl?.locationIndex) ? (ghl!.locationIndex as JsonRecord[]) : [];
  const ghlByClient = (ghl?.leadsByClient || {}) as JsonRecord;
  const adsIndex = Array.isArray(googleAds?.customerIndex) ? (googleAds!.customerIndex as JsonRecord[]) : [];
  const lsaIndex = Array.isArray(lsa?.accountIndex) ? (lsa!.accountIndex as JsonRecord[]) : [];
  const metaIndex = Array.isArray(meta?.accountIndex) ? (meta!.accountIndex as JsonRecord[]) : [];
  const metaByClient = (meta?.metaByClient || {}) as JsonRecord;

  let problems = 0;

  for (const client of clients) {
    const pins = client.integrationMappings || {};
    const lines: string[] = [];
    const flags: string[] = [];

    // ---- Business Profile -------------------------------------------------
    const gbpMapping = resolveGbpMapping({
      discovered: gbpDiscovered,
      stored: Array.isArray(gbpByClient[client.id]) ? (gbpByClient[client.id] as JsonRecord[]) : [],
      pinnedIds: pins.googleBusinessProfile || [],
    });
    const gbpTitles = gbpMapping.locations.map((location) => String(location.title || gbpLocationId(location)));
    lines.push(
      `  GBP            ${gbpMapping.locations.length} listing${gbpMapping.locations.length === 1 ? "" : "s"}` +
        ` (${gbpMapping.pinned.length} pinned, ${gbpMapping.autoMatched.length} by name): ${list(gbpTitles)}`,
    );
    if (gbpMapping.unresolvedPins.length) {
      flags.push(
        `GBP pin(s) ${gbpMapping.unresolvedPins.join(", ")} are NOT in the stored snapshot — run a Business Profile sync, then re-pin`,
      );
    }
    if (!gbpMapping.locations.length) {
      flags.push("GBP resolves to no listing — the brief will say no location matches this client");
      /*
        And the closest names, so this is a shortlist rather than a complaint. The same ranking the
        mapping screen shows, printed here because a run over the whole book is how you work through
        141 of them without opening 141 screens.
      */
      const suggestions = suggestMappingCandidates({
        clientName: client.name,
        candidates: gbpDiscovered.map((entry) => ({
          id: gbpLocationId(entry),
          label: String(entry.title || ""),
          detail: String(entry.storeCode || entry.websiteUri || ""),
        })),
        limit: 3,
      });
      for (const suggestion of suggestions) {
        lines.push(
          `                 ? ${suggestion.label} (${suggestion.id}) — ${
            suggestion.score >= 70 ? "likely" : suggestion.score >= 45 ? "possible" : "weak"
          }: ${suggestion.why}`,
        );
      }
      if (!suggestions.length) {
        lines.push("                 ? no listing in the snapshot shares a distinguishing word with this name");
      }
    }

    // ---- GoHighLevel ------------------------------------------------------
    const storedGhl = (ghlByClient[client.id] || null) as JsonRecord | null;
    const ghlName = ghlIndex.find((entry) => namesLikelyMatch(client.name, String(entry.name || "")));
    const ghlResolved = resolveGhlLocationId({
      pinnedIds: pins.gohighlevel || [],
      locationIndex: ghlIndex,
      ...(storedGhl?.locationId ? { storedLocationId: String(storedGhl.locationId) } : {}),
      ...(ghlName?.id ? { nameMatchedId: String(ghlName.id) } : {}),
    });
    const ghlLabel = ghlIndex.find((entry) => String(entry.id || "") === ghlResolved.locationId);
    lines.push(
      `  GoHighLevel    ${ghlResolved.locationId || "none"} (${ghlResolved.source})` +
        `${ghlLabel ? ` — ${String(ghlLabel.name || "")}` : ""}`,
    );
    if (ghlResolved.unresolvedPins.length) {
      flags.push(
        `GoHighLevel pin(s) ${ghlResolved.unresolvedPins.join(", ")} are not visible to this agency connection`,
      );
    }

    // ---- The three flat-id providers --------------------------------------
    const flat: [string, JsonRecord[], string, string[]][] = [
      ["Google Ads", adsIndex, "customerId", pins.googleAds || []],
      ["Local Services", lsaIndex, "accountId", pins.googleLsa || []],
      ["Meta Ads", metaIndex, "accountId", pins.metaAds || []],
    ];
    const nameOf = (entry: JsonRecord) =>
      String(entry.descriptiveName || entry.businessName || entry.name || "");

    for (const [label, index, idKey, pinned] of flat) {
      const resolved = resolveAccountIds({
        availableIds: index.map((entry) => String(entry[idKey] || entry.id || "")),
        autoMatchedIds: index
          .filter((entry) => namesLikelyMatch(client.name, nameOf(entry)))
          .map((entry) => String(entry[idKey] || entry.id || "")),
        pinnedIds: pinned,
      });
      const named = resolved.ids.map((id) => {
        const entry = index.find((candidate) => String(candidate[idKey] || candidate.id || "") === id);
        return entry ? `${nameOf(entry)} (${id})` : id;
      });
      lines.push(`  ${label.padEnd(14)} ${resolved.ids.length ? list(named, 2) : "none"}`);
      if (resolved.unresolvedPins.length) {
        flags.push(`${label} pin(s) ${resolved.unresolvedPins.join(", ")} are not visible to this connection`);
      }
    }

    // Meta is the one with a stored per-client row to check, since its sync is new.
    const metaRow = (metaByClient[client.id] || null) as JsonRecord | null;
    if (metaRow?.error) {
      flags.push(`Meta Ads refused this account: ${String(metaRow.error)}`);
    }

    if (ONLY_UNMAPPED && !flags.length) continue;

    console.log(`\n${client.name} (${client.id})`);
    for (const line of lines) console.log(line);
    for (const flag of flags) {
      problems += 1;
      console.log(`  !! ${flag}`);
    }
  }

  console.log(
    [
      "",
      problems
        ? `${problems} thing${problems === 1 ? "" : "s"} to look at above.`
        : "Every mapping above resolves.",
      "",
      "Two things this does NOT tell you.",
      "",
      "One: whether the numbers inside a mapped account are there. A listing that resolves and has no",
      "performance rows, and an ad account that resolves and spent nothing, both read as a mapping",
      "that works -- which they are. Run the preparation for the client to see what each source",
      "actually returned.",
      "",
      "Two: what the NEXT sync would match. A pin resolves here and now, which is the whole point of",
      "a pin. Automatic name matching is done by the provider's own sync, because the sync is also",
      "the only thing that can pull the performance rows for a listing it has just matched -- so a",
      "client shown with no listing may well match one after the next Business Profile sync, and",
      "resolving it here instead would only put an empty listing on a brief.",
    ].join("\n"),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
