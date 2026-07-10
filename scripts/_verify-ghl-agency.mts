import { syncIntegrationProvider } from "@/src/lib/server/integration-sync";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";

const context = { tenantId: "map-ranking", userId: "unknown", role: "account_manager" as const };

try {
  const result = await syncIntegrationProvider(context, "gohighlevel");
  console.log("gohighlevel sync ->", result.summary);
} catch (error) {
  console.log("gohighlevel sync FAILED ->", error instanceof Error ? error.message : error);
  process.exit(1);
}

const db = getFirebaseAdminDb()!;
const snap = await db.doc("tenants/map-ranking/integrationSnapshots/gohighlevel").get();
const payload = snap.data()?.payload || {};
const leadsByClient = (payload.leadsByClient || {}) as Record<string, Record<string, unknown>>;
const entries = Object.entries(leadsByClient);
console.log("clients with lead data:", entries.length);

const withLeads = entries.filter(([, d]) => Number(d.totalLeads) > 0);
console.log("clients with >0 leads:", withLeads.length);
for (const [clientId, d] of withLeads.slice(0, 10)) {
  console.log(` - ${clientId}: "${d.locationName}" leads=${d.totalLeads} qualified=${d.qualifiedLeads} booked=${d.bookedJobs}`);
}

const diamond = leadsByClient["868ef7dcu"];
console.log("\nDiamond Cleaners USA:", diamond ? JSON.stringify(diamond).slice(0, 400) : "no matched GHL location");

process.exit(0);
