/**
 * Is the GoHighLevel connection an AGENCY install, or one sub-account?
 *
 * The owner reported (9 November 2026) being told the connection was scoped to a single account
 * rather than the agency, and that this was why information would not pull. That question has a
 * definite answer sitting in Firestore and in the token itself, so this script reads it rather
 * than reasoning about it.
 *
 * ## What decides it
 *
 * GoHighLevel issues two classes of OAuth token from the same marketplace app. Which one you get
 * depends on what was chosen on the consent screen, not on anything in this codebase:
 *
 *  - **Company** (agency). `userType: "Company"` on the token response, `authClass: "Company"`
 *    inside the JWT. It can list every sub-account and mint a short-lived location token for each,
 *    which is what `syncGoHighLevelAgency` does. One connection covers the whole book.
 *  - **Location** (one sub-account). `userType: "Location"`, `authClass: "Location"`. It can read
 *    exactly one client and cannot see or mint for any other. `syncGoHighLevel` falls through to a
 *    single-location read, so everything else in the book stays empty.
 *
 * So this prints, per tenant and per user, which class the stored credential actually is, and then
 * asks GoHighLevel how many sub-accounts that credential can see -- the only answer that cannot be
 * argued with.
 *
 * ## Read-only, and deliberately not self-healing
 *
 * It refreshes nothing, re-saves nothing and rotates nothing: a diagnostic that repairs its own
 * subject destroys the evidence. If the credential is scoped wrong, only a person reconnecting on
 * the consent screen can fix it, and this script's job is to say so plainly. It prints no secret --
 * tokens are reported as held/absent, and the only thing taken out of the JWT is the auth class
 * and the company id.
 *
 *   npx tsx scripts/verify-ghl-connection.ts
 *   npx tsx scripts/verify-ghl-connection.ts --tenant map-ranking
 *   npx tsx scripts/verify-ghl-connection.ts --no-live   (skip the GoHighLevel calls)
 */
import { loadEnvConfig } from "@next/env";

import {
  integrationsCollectionPath,
  tenantUsersCollectionPath,
  userIntegrationsCollectionPath,
} from "@/src/lib/server/firebase/collections";
import { getIntegrationCredentials } from "@/src/lib/server/integrations";
import type { IntegrationConnectionRecord } from "@/src/lib/contracts/integrations";

function flagValue(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

const LIVE = !process.argv.includes("--no-live");

/** Present/absent only. A diagnostic must never be the place a token leaks. */
function held(value: unknown): string {
  return value ? "held" : "absent";
}

function ago(iso: unknown): string {
  if (typeof iso !== "string" || !iso.trim()) return "never";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return String(iso);
  const hours = (Date.now() - then) / 3_600_000;
  if (hours < 48) return `${iso} (${Math.round(hours)}h ago)`;
  return `${iso} (${Math.round(hours / 24)}d ago)`;
}

/**
 * The auth class and company id out of the token, and nothing else.
 *
 * A GoHighLevel access token is an unsigned-to-us JWT whose payload says what it is allowed to be.
 * Reading it locally answers the agency question without spending an API call -- and without
 * trusting `metadata.userType`, which is what the token response said at connect time rather than
 * what the credential in the database is now.
 */
function readTokenClass(token: string | undefined): { authClass?: string; companyId?: string; locationId?: string } {
  if (!token) return {};
  try {
    const segments = token.split(".");
    if (segments.length < 2) return {};
    const payload = JSON.parse(Buffer.from(segments[1], "base64").toString("utf8")) as Record<string, unknown>;
    const authClass = typeof payload.authClass === "string" ? payload.authClass : undefined;
    const authClassId = typeof payload.authClassId === "string" ? payload.authClassId : undefined;
    return {
      authClass,
      companyId:
        (typeof payload.companyId === "string" ? payload.companyId : undefined) ||
        ((authClass || "").toLowerCase() === "company" ? authClassId : undefined),
      locationId:
        (typeof payload.locationId === "string" ? payload.locationId : undefined) ||
        ((authClass || "").toLowerCase() === "location" ? authClassId : undefined),
    };
  } catch {
    return {};
  }
}

/** How many sub-accounts this credential can actually see. The question, answered by GHL. */
async function countReachableLocations(token: string): Promise<{ count: number | null; note: string }> {
  try {
    const response = await fetch("https://services.leadconnectorhq.com/locations/search?limit=500", {
      headers: { Authorization: `Bearer ${token}`, Version: "2021-07-28" },
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const message =
        typeof body.message === "string"
          ? body.message
          : Array.isArray(body.message)
            ? body.message.join("; ")
            : `HTTP ${response.status}`;
      return { count: null, note: `locations/search refused: ${message}` };
    }
    const locations = Array.isArray(body.locations) ? body.locations : [];
    return {
      count: locations.length,
      note: locations.length
        ? `names: ${locations
            .slice(0, 6)
            .map((item) => String((item as Record<string, unknown>).name || "unnamed"))
            .join(", ")}${locations.length > 6 ? `, +${locations.length - 6} more` : ""}`
        : "the call succeeded and returned an empty list",
    };
  } catch (error) {
    return { count: null, note: `locations/search failed: ${error instanceof Error ? error.message : "unknown"}` };
  }
}

/** Whether the credential can mint a location token, which is how every per-client read is made. */
async function canMintLocationToken(
  token: string,
  companyId: string,
  locationId: string,
): Promise<{ ok: boolean; note: string }> {
  try {
    const response = await fetch("https://services.leadconnectorhq.com/oauth/locationToken", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: "2021-07-28",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ companyId, locationId }).toString(),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const message = typeof body.message === "string" ? body.message : `HTTP ${response.status}`;
      return { ok: false, note: `refused: ${message}` };
    }
    const scopes = typeof body.scope === "string" ? body.scope : "";
    return {
      ok: typeof body.access_token === "string",
      note: scopes ? `minted, carrying: ${scopes}` : "minted",
    };
  } catch (error) {
    return { ok: false, note: `failed: ${error instanceof Error ? error.message : "unknown"}` };
  }
}

interface Found {
  where: string;
  record: IntegrationConnectionRecord;
}

async function main() {
  loadEnvConfig(process.cwd());
  const { getFirebaseAdminDb } = await import("@/src/lib/server/firebase/admin");
  const db = getFirebaseAdminDb();
  if (!db) {
    console.log("No Firestore admin credentials in this environment — nothing to read.");
    process.exit(1);
  }

  const onlyTenant = flagValue("--tenant");
  const tenants = await db.collection("tenants").get();
  const found: Found[] = [];

  for (const tenant of tenants.docs) {
    if (onlyTenant && tenant.id !== onlyTenant) continue;
    console.log(`\n================ tenant ${tenant.id} ================`);

    const tenantLevel = await db.collection(integrationsCollectionPath(tenant.id)).get();
    for (const doc of tenantLevel.docs) {
      if (doc.id !== "gohighlevel") continue;
      found.push({ where: `tenant-level (${tenant.id})`, record: doc.data() as IntegrationConnectionRecord });
    }

    const users = await db.collection(tenantUsersCollectionPath(tenant.id)).get();
    for (const user of users.docs) {
      const perUser = await db.collection(userIntegrationsCollectionPath(tenant.id, user.id)).get();
      for (const doc of perUser.docs) {
        if (doc.id !== "gohighlevel") continue;
        const data = user.data() as Record<string, unknown>;
        const who = (typeof data.email === "string" && data.email) || (typeof data.name === "string" && data.name) || user.id;
        found.push({ where: `user ${who}`, record: doc.data() as IntegrationConnectionRecord });
      }
    }
  }

  if (!found.length) {
    console.log("\nNo GoHighLevel connection record exists anywhere. Nobody has connected it.");
    return;
  }

  let agencyScoped = 0;
  let locationScoped = 0;

  for (const { where, record } of found) {
    const metadata = (record.metadata || {}) as Record<string, unknown>;
    const credentials = getIntegrationCredentials(record);
    const fromToken = readTokenClass(credentials.accessToken);

    const declared = String(metadata.userType || credentials.userType || "").toLowerCase();
    const actual = (fromToken.authClass || "").toLowerCase();
    const isAgency = actual === "company" || (!actual && declared === "company");

    console.log(`\n--- ${where} ---`);
    console.log(`  status:            ${record.status}${record.errorMessage ? ` — last error: ${record.errorMessage}` : ""}`);
    console.log(`  label:             ${record.displayLabel || "(none)"}`);
    console.log(`  external account:  ${record.externalAccountId || "(none)"}`);
    console.log(`  access token:      ${held(credentials.accessToken)}  ·  refresh token: ${held(credentials.refreshToken)}`);
    console.log(`  token expires:     ${ago(record.tokenExpiresAt)}`);
    console.log(`  last validated:    ${ago(record.lastValidatedAt)}`);
    console.log(`  scopes granted:    ${(record.scopes || []).join(", ") || "(none recorded)"}`);
    console.log(`  userType recorded: ${metadata.userType || credentials.userType || "(none)"}`);
    console.log(`  token says:        authClass ${fromToken.authClass || "(unreadable)"}${
      fromToken.companyId ? `, company ${fromToken.companyId}` : ""
    }${fromToken.locationId ? `, location ${fromToken.locationId}` : ""}`);
    console.log(
      `  >> SCOPE:          ${
        isAgency
          ? "AGENCY — this one credential can reach every sub-account"
          : "ONE SUB-ACCOUNT — it can read a single client and no other"
      }`,
    );

    if (isAgency) agencyScoped += 1;
    else locationScoped += 1;

    if (!LIVE || !credentials.accessToken) continue;

    const reachable = await countReachableLocations(credentials.accessToken);
    console.log(
      `  sub-accounts seen: ${reachable.count === null ? "could not ask" : reachable.count} — ${reachable.note}`,
    );

    const companyId = fromToken.companyId || (typeof metadata.companyId === "string" ? metadata.companyId : undefined);
    const locationId =
      fromToken.locationId || (typeof metadata.locationId === "string" ? metadata.locationId : undefined);
    if (companyId && locationId) {
      const mint = await canMintLocationToken(credentials.accessToken, companyId, locationId);
      console.log(`  location token:    ${mint.ok ? "yes" : "no"} — ${mint.note}`);
    } else if (companyId) {
      console.log("  location token:    not tried — no location id to mint one for from this record alone");
    }
  }

  const envAgencyKey = Boolean(process.env.GOHIGHLEVEL_AGENCY_API_KEY);
  console.log(`\n==================== the answer ====================`);
  console.log(`GoHighLevel connections found:   ${found.length}`);
  console.log(`  agency-scoped (Company):       ${agencyScoped}`);
  console.log(`  single sub-account (Location): ${locationScoped}`);
  console.log(`GOHIGHLEVEL_AGENCY_API_KEY set:  ${envAgencyKey ? "yes — used as a fallback agency key" : "no"}`);

  if (agencyScoped === 0 && !envAgencyKey) {
    console.log(
      [
        "",
        "Every stored credential is scoped to ONE sub-account, and there is no agency API key to fall",
        "back on. Only a person can fix this, and only on GoHighLevel's own consent screen: the scope",
        "is decided there, not by anything in this codebase. Reconnect GoHighLevel and, on the screen",
        'that asks which account to grant, choose the AGENCY rather than a single location.',
      ].join("\n"),
    );
  }

  console.log(
    [
      "",
      "Not covered by this check: whether each sub-account is MAPPED to a client in MTOS (a reachable",
      "location nobody has matched to a client still pulls nothing into a brief), whether the scopes",
      "granted cover every read the app makes, and whether the data inside each sub-account is",
      "actually there -- an empty client in GoHighLevel reads identically to a permission problem.",
    ].join("\n"),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
