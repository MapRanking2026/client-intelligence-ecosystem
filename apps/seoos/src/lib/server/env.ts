/**
 * SEOOS server environment. Mirrors the MTOS accessor and REUSES the same
 * variable names (SESSION_COOKIE_SECRET, FIREBASE_*, MTOS_INTEGRATIONS_SECRET,
 * MTOS_USE_SEED_DATA, MTOS_PILOT_TENANT_ID) so the shared session, Firestore,
 * and encrypted integration credentials work across both apps without a second
 * onboarding. SEOOS-specific flags are additive and default to preserving MTOS.
 */
function normalizePrivateKey(privateKey?: string) {
  return privateKey?.replace(/\\n/g, "\n");
}

function boolEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return defaultValue;
  return raw.toLowerCase() === "true" || raw === "1";
}

export function getServerEnv() {
  return {
    appEnv: process.env.NEXT_PUBLIC_APP_ENV || "development",
    appUrl: process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "",
    // Shared with MTOS: seed mode lets the app run without Firebase creds.
    useSeedData: process.env.MTOS_USE_SEED_DATA === "true",
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID || "",
    firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL || "",
    firebasePrivateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
    // SAME cookie name/secret as MTOS so a session issued by either app verifies.
    sessionCookieName: process.env.SESSION_COOKIE_NAME || "mtos_session",
    sessionCookieSecret: process.env.SESSION_COOKIE_SECRET || "",
    integrationsEncryptionSecret:
      process.env.MTOS_INTEGRATIONS_SECRET || process.env.SESSION_COOKIE_SECRET || "",
    pilotTenantId: process.env.MTOS_PILOT_TENANT_ID || "map-ranking",
    // Optional gate for self-service sign-up. When set, sign-up requires this
    // code. The first user in a tenant always becomes tenant_admin.
    signupCode: process.env.SEOOS_SIGNUP_CODE || "",
    // URL of the MTOS integration gateway SEOOS calls for shared connections.
    integrationGatewayUrl: process.env.MTOS_GATEWAY_URL || "",
    serviceToServiceSecret: process.env.CIE_SERVICE_SECRET || "",
    // SEOOS feature flags (server-evaluated; env is the initial source).
    seoosEnabled: boolEnv("SEOOS_ENABLED", true),
    seoosRequestsEnabled: boolEnv("SEOOS_REQUESTS_ENABLED", true),
    seoosAutoRequestMonthlyTouch: boolEnv("SEOOS_AUTO_REQUEST_MONTHLY_TOUCH", false),
    seoosProactivePackagesEnabled: boolEnv("SEOOS_PROACTIVE_PACKAGES_ENABLED", false),
    seoosShadowMode: boolEnv("SEOOS_SHADOW_MODE", false),
    seoosReadMode: (process.env.SEOOS_READ_MODE || "legacy") as
      | "legacy"
      | "shadow"
      | "seoos",
  };
}

export function hasFirebaseAdminConfig() {
  const env = getServerEnv();
  return Boolean(
    env.firebaseProjectId && env.firebaseClientEmail && env.firebasePrivateKey,
  );
}
