function normalizePrivateKey(privateKey?: string) {
  return privateKey?.replace(/\\n/g, "\n");
}

export function getServerEnv() {
  return {
    appEnv: process.env.NEXT_PUBLIC_APP_ENV || "development",
    appUrl: process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "",
    useSeedData: process.env.MTOS_USE_SEED_DATA === "true",
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID || "",
    firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL || "",
    firebasePrivateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY),
    sessionCookieName: process.env.SESSION_COOKIE_NAME || "mtos_session",
    sessionCookieSecret: process.env.SESSION_COOKIE_SECRET || "",
    integrationsEncryptionSecret:
      process.env.MTOS_INTEGRATIONS_SECRET || process.env.SESSION_COOKIE_SECRET || "",
    pilotLoginCode: process.env.PILOT_LOGIN_CODE || "",
    pilotTenantId: process.env.MTOS_PILOT_TENANT_ID || "map-ranking",
    managerSignupCode: process.env.MTOS_MANAGER_SIGNUP_CODE || "",
    adminSignupCode: process.env.MTOS_ADMIN_SIGNUP_CODE || "",
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
    anthropicModel: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
    gohighlevelAgencyApiKey: process.env.GOHIGHLEVEL_AGENCY_API_KEY || "",
  };
}

export function hasFirebaseAdminConfig() {
  const env = getServerEnv();

  return Boolean(
    env.firebaseProjectId &&
      env.firebaseClientEmail &&
      env.firebasePrivateKey,
  );
}
