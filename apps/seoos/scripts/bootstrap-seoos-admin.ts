/**
 * Provision a SEOOS login user (default: a tenant_admin) with a HASHED password.
 * The plaintext password is read from an env var and never stored or logged.
 *
 * Usage (from apps/seoos, with Firebase admin env set):
 *   SEOOS_ADMIN_EMAIL="francisco@mapranking.com" \
 *   SEOOS_ADMIN_PASSWORD='...secret...' \
 *   npm run bootstrap:admin -w apps/seoos
 *
 * Optional: SEOOS_ADMIN_USER_ID, SEOOS_ADMIN_NAME, SEOOS_ADMIN_ROLE,
 *           MTOS_PILOT_TENANT_ID.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function fail(msg: string): never {
  console.error(`bootstrap-seoos-admin: ${msg}`);
  process.exit(1);
}

/** Minimal .env loader (no dependency): fills missing vars from local .env files. */
function loadDotEnv(): void {
  const candidates = [
    ".env.local",
    ".env",
    "../../.env.local",
    "../../.env",
    "../mtos/.env.local",
    "../mtos/.env",
  ];
  for (const rel of candidates) {
    const p = resolve(process.cwd(), rel);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let val = m[2];
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  }
}
loadDotEnv();

const email = (process.env.SEOOS_ADMIN_EMAIL || "francisco@mapranking.com").trim().toLowerCase();
const password = process.env.SEOOS_ADMIN_PASSWORD;
const tenantId = process.env.MTOS_PILOT_TENANT_ID || "map-ranking";
const userId = process.env.SEOOS_ADMIN_USER_ID || email.split("@")[0].replace(/[^a-zA-Z0-9_-]/g, "_");
const role = process.env.SEOOS_ADMIN_ROLE || "tenant_admin";
const displayName = process.env.SEOOS_ADMIN_NAME || "Admin";

if (!password) fail("SEOOS_ADMIN_PASSWORD env var is required (do not hard-code it).");
if (password.length < 8) fail("SEOOS_ADMIN_PASSWORD must be at least 8 characters.");

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
if (!projectId || !clientEmail || !privateKey) {
  fail("FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY are required.");
}

async function main() {
  if (!getApps().length) {
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  }
  const db = getFirestore();

  const salt = randomBytes(16).toString("hex");
  const passwordHash = scryptSync(password as string, salt, 64).toString("hex");
  const now = new Date().toISOString();

  const user = {
    schemaVersion: 1 as const,
    tenantId,
    userId,
    email,
    displayName,
    passwordSalt: salt,
    passwordHash,
    roles: [role],
    clientVisibility: "all" as const,
    disabled: false,
    createdAt: now,
    updatedAt: now,
  };

  await db.collection("tenants").doc(tenantId).collection("seoUsers").doc(userId).set(user);
  // Mirror an app membership so authorization is explicit either way.
  await db
    .collection("tenants")
    .doc(tenantId)
    .collection("appMemberships")
    .doc(`seoos__${userId}`)
    .set({
      schemaVersion: 1,
      tenantId,
      userId,
      app: "seoos",
      roles: [role],
      clientVisibility: "all",
      extraPermissions: [],
      createdAt: now,
      updatedAt: now,
    });

  console.log(`Provisioned SEOOS user ${email} (userId "${userId}", role ${role}) in tenant ${tenantId}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`bootstrap-seoos-admin failed: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
