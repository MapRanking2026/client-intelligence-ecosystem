import fs from "node:fs";
import { createDecipheriv, createHash } from "node:crypto";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const envText = fs.readFileSync(new URL("../.env", import.meta.url), "utf8");
const env = {};
for (const line of envText.split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq === -1) continue;
  const k = t.slice(0, eq).trim();
  let v = t.slice(eq + 1).trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  if (!(k in env)) env[k] = v;
}

function keyOf() { return createHash("sha256").update(env.MTOS_INTEGRATIONS_SECRET).digest(); }
function unseal(ct) {
  const b = Buffer.from(ct, "base64url");
  const d = createDecipheriv("aes-256-gcm", keyOf(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"));
}

const app = initializeApp({
  credential: cert({ projectId: env.FIREBASE_PROJECT_ID, clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") }),
});
const db = getFirestore(app);
const ghlDoc = await db.doc("tenants/map-ranking/integrations/gohighlevel").get();
const ghlCreds = unseal(ghlDoc.data().credentialCiphertext);
const GH = { authorization: `Bearer ${ghlCreds.accessToken}`, accept: "application/json", Version: "2021-07-28" };

const companyId = "fzaqV0wzYwYXOCtgq0Kp"; // from location payload
const agencyIdFromEnv = env.GOHIGHLEVEL_AGENCY_ID;
console.log(`agency id in .env: ${agencyIdFromEnv}`);

for (const cid of [companyId, agencyIdFromEnv]) {
  if (!cid) continue;
  const r = await fetch(`https://services.leadconnectorhq.com/locations/search?companyId=${encodeURIComponent(cid)}&limit=5`, { headers: GH });
  console.log(`GET /locations/search?companyId=${cid} -> ${r.status} :: ${(await r.text()).slice(0, 300).replace(/\s+/g, " ")}`);
}

const r2 = await fetch(`https://services.leadconnectorhq.com/companies/${companyId}`, { headers: GH });
console.log(`GET /companies/${companyId} -> ${r2.status} :: ${(await r2.text()).slice(0, 300).replace(/\s+/g, " ")}`);

// try minting a location token (agency-token-only endpoint) to confirm token class
const r3 = await fetch("https://services.leadconnectorhq.com/oauth/locationToken", {
  method: "POST",
  headers: { ...GH, "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ companyId, locationId: "b9UcRcVjQCZgFruVOeOC" }).toString(),
});
console.log(`POST /oauth/locationToken -> ${r3.status} :: ${(await r3.text()).slice(0, 300).replace(/\s+/g, " ")}`);

process.exit(0);
