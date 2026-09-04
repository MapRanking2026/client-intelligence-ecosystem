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
    // Fallback LLM providers. Model defaults are conservative and overridable via
    // env so the exact model can be set without a code change.
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    openaiModel: process.env.OPENAI_MODEL || "gpt-4o",
    openaiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
    geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
    geminiModel: process.env.GEMINI_MODEL || "gemini-1.5-pro",
    geminiEmbeddingModel: process.env.GEMINI_EMBEDDING_MODEL || "text-embedding-004",
    // Embedding provider order for the knowledge base (RAG). Claude has no
    // embeddings API, so only openai/gemini are eligible.
    embeddingProviderOrder: process.env.EMBEDDING_PROVIDER_ORDER || "openai,gemini",
    // Default failover order for the LLM layer; a comma-separated list of
    // provider ids ("claude", "openai", "gemini"). Unknown ids are ignored.
    llmProviderOrder: process.env.LLM_PROVIDER_ORDER || "claude,openai,gemini",
    gohighlevelAgencyApiKey: (process.env.GOHIGHLEVEL_AGENCY_API_KEY || "").replace(/^Bearer\s+/i, "").trim(),
    // Shared secret for the Client Intelligence Ecosystem integration gateway
    // (signed service-to-service requests from SEOOS). Empty disables the gateway.
    serviceToServiceSecret: process.env.CIE_SERVICE_SECRET || "",
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
