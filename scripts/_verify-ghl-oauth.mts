import { createDecipheriv, createHash } from "node:crypto";

import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { getServerEnv } from "@/src/lib/server/env";
import { syncIntegrationProvider } from "@/src/lib/server/integration-sync";

const context = { tenantId: "map-ranking", userId: "unknown", role: "account_manager" as const };
const db = getFirebaseAdminDb()!;

function unseal(ciphertext: string) {
  const key = createHash("sha256").update(getServerEnv().integrationsEncryptionSecret).digest();
  const buffer = Buffer.from(ciphertext, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key, buffer.subarray(0, 12));
  decipher.setAuthTag(buffer.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString("utf8"));
}

const doc = await db.doc("tenants/map-ranking/integrations/gohighlevel").get();
if (!doc.exists) {
  console.log("gohighlevel connection: NOT FOUND -- reconnect has not completed yet");
  process.exit(1);
}
const data = doc.data()!;
console.log("connection:", {
  status: data.status,
  displayLabel: data.displayLabel,
  connectedAt: data.connectedAt,
  metadata: data.metadata,
});
const creds = unseal(data.credentialCiphertext);
const [, payloadB64] = String(creds.accessToken || "").split(".");
if (payloadB64) {
  const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString());
  console.log("token authClass:", payload.authClass, "| authClassId:", payload.authClassId, "| scopes:", payload.oauthMeta?.scopes);
}

console.log("\nrunning sync...");
try {
  const result = await syncIntegrationProvider(context, "gohighlevel");
  console.log("sync ->", result.summary);
} catch (error) {
  console.log("sync FAILED ->", error instanceof Error ? error.message : error);
  process.exit(1);
}

const snap = await db.doc("tenants/map-ranking/integrationSnapshots/gohighlevel").get();
const payload = snap.data()?.payload || {};
const leadsByClient = (payload.leadsByClient || {}) as Record<string, Record<string, unknown>>;
const entries = Object.entries(leadsByClient);
const withLeads = entries.filter(([, d]) => Number(d.totalLeads) > 0);
console.log(`\nclients with lead data: ${entries.length} | with >0 leads: ${withLeads.length}`);
for (const [clientId, d] of withLeads.slice(0, 10)) {
  console.log(` - ${clientId}: "${d.locationName}" leads=${d.totalLeads} qualified=${d.qualifiedLeads} booked=${d.bookedJobs}`);
}
const diamond = leadsByClient["868ef7dcu"];
console.log("\nDiamond Cleaners USA:", diamond ? JSON.stringify(diamond).slice(0, 300) : "no matched GHL location");

process.exit(0);
