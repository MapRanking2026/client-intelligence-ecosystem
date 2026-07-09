import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";

import type {
  IntegrationAuthMode,
  IntegrationCategory,
  IntegrationConnectionRecord,
  IntegrationFieldDefinition,
  IntegrationProviderId,
  IntegrationProviderView,
} from "@/src/lib/contracts/integrations";
import type { IntegrationSyncJobRecord } from "@/src/lib/contracts/integration-sync";
import { integrationProviderIds } from "@/src/lib/contracts/integrations";
import type { TenantContext } from "@/src/lib/contracts/mtos";
import {
  integrationConnectionPath,
  integrationSyncJobsCollectionPath,
  integrationsCollectionPath,
} from "@/src/lib/server/firebase/collections";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { getServerEnv } from "@/src/lib/server/env";

type OAuthTransport = "standard_form" | "clickup_query" | "quickbooks_basic_auth";
type RefreshStrategy = "none" | "standard_form" | "quickbooks_basic_auth";

interface ProviderDefinition {
  id: IntegrationProviderId;
  name: string;
  shortName: string;
  category: IntegrationCategory;
  authMode: IntegrationAuthMode;
  description: string;
  highlight: string;
  capabilities: string[];
  defaultApiBaseUrl?: string;
  fields: IntegrationFieldDefinition[];
  oauth?: {
    authUrl: string;
    tokenUrl: string;
    scopes: string[];
    clientIdEnv: string;
    clientSecretEnv: string;
    authUrlEnv?: string;
    redirectUriEnv?: string;
    transport: OAuthTransport;
    refreshStrategy: RefreshStrategy;
    accessType?: "offline";
    prompt?: "consent";
    extraAuthorizeParams?: Record<string, string>;
  };
}

const OAUTH_STATE_AUDIENCE = "mtos-integrations-oauth";
const syncEnabledProviders = new Set<IntegrationProviderId>([
  "clickup",
  "google-calendar",
  "google-business-profile",
  "google-search-console",
  "rank-tracker",
  "map-checkins",
  "gohighlevel",
]);

const rotatingTokenFields: IntegrationFieldDefinition[] = [
  {
    key: "tokenEndpoint",
    label: "Token endpoint",
    placeholder: "https://api.example.com/auth/token",
    helperText: "Endpoint MTOS calls to generate a fresh token after the refresh window expires.",
    required: true,
    type: "url",
  },
  {
    key: "apiBaseUrl",
    label: "API base URL",
    placeholder: "https://api.example.com/v1",
    helperText: "Base endpoint MTOS uses after a new token is issued.",
    required: true,
    type: "url",
  },
  {
    key: "apiKey",
    label: "API key",
    placeholder: "Paste provider API key",
    helperText: "Used to authenticate the token-generation request.",
    required: true,
    secret: true,
    type: "password",
  },
  {
    key: "clientId",
    label: "Client ID",
    placeholder: "Optional client identifier",
    helperText: "Include if the provider requires an additional client identifier.",
    type: "text",
  },
  {
    key: "clientSecret",
    label: "Client secret",
    placeholder: "Optional client secret",
    helperText: "Include if the provider requires an additional secret for token generation.",
    secret: true,
    type: "password",
  },
  {
    key: "syncEndpoint",
    label: "Sync endpoint",
    placeholder: "https://api.example.com/v1/rankings",
    helperText: "Endpoint MTOS calls to retrieve ranking or check-in data after it has a valid token.",
    required: true,
    type: "url",
  },
  {
    key: "refreshWindowMinutes",
    label: "Refresh window (minutes)",
    placeholder: "120",
    helperText: "MTOS marks the connection as expiring when this window is nearly reached.",
    required: true,
    type: "number",
  },
];

const providerDefinitions: ProviderDefinition[] = [
  {
    id: "clickup",
    name: "ClickUp",
    shortName: "ClickUp",
    category: "operations",
    authMode: "oauth",
    description: "Connect ClickUp workspaces so commitments, owners, and due dates stay synchronized with MTOS.",
    highlight: "Task sync for commitments and post-call follow-up actions.",
    capabilities: ["Inbound task sync", "Outbound commitment creation", "Workspace reconnect flow"],
    defaultApiBaseUrl: "https://api.clickup.com/api/v2",
    fields: [],
    oauth: {
      authUrl: "https://app.clickup.com/api",
      tokenUrl: "https://api.clickup.com/api/v2/oauth/token",
      scopes: [],
      clientIdEnv: "CLICKUP_CLIENT_ID",
      clientSecretEnv: "CLICKUP_CLIENT_SECRET",
      redirectUriEnv: "CLICKUP_REDIRECT_URI",
      transport: "clickup_query",
      refreshStrategy: "none",
    },
  },
  {
    id: "google-business-profile",
    name: "Google Business Profile",
    shortName: "GBP",
    category: "search",
    authMode: "oauth",
    description: "Pull profile health, reviews, photos, and listing status into the monthly touch workflow.",
    highlight: "Visibility and review management for local clients.",
    capabilities: ["Listing insights", "Review retrieval", "Profile health checks"],
    defaultApiBaseUrl: "https://mybusiness.googleapis.com",
    fields: [],
    oauth: {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: [
        "https://www.googleapis.com/auth/business.manage",
      ],
      clientIdEnv: "GOOGLE_INTEGRATIONS_CLIENT_ID",
      clientSecretEnv: "GOOGLE_INTEGRATIONS_CLIENT_SECRET",
      transport: "standard_form",
      refreshStrategy: "standard_form",
      accessType: "offline",
      prompt: "consent",
      extraAuthorizeParams: { include_granted_scopes: "true" },
    },
  },
  {
    id: "google-search-console",
    name: "Google Search Console",
    shortName: "Search Console",
    category: "search",
    authMode: "oauth",
    description: "Sync performance and indexing signals so MTOS can explain search movement with evidence.",
    highlight: "Search visibility and page performance evidence.",
    capabilities: ["Performance reporting", "Index coverage context", "Query trend analysis"],
    defaultApiBaseUrl: "https://searchconsole.googleapis.com",
    fields: [],
    oauth: {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
      clientIdEnv: "GOOGLE_INTEGRATIONS_CLIENT_ID",
      clientSecretEnv: "GOOGLE_INTEGRATIONS_CLIENT_SECRET",
      transport: "standard_form",
      refreshStrategy: "standard_form",
      accessType: "offline",
      prompt: "consent",
      extraAuthorizeParams: { include_granted_scopes: "true" },
    },
  },
  {
    id: "google-ads",
    name: "Google Ads",
    shortName: "Google Ads",
    category: "analytics",
    authMode: "oauth",
    description: "Connect paid-search accounts so MTOS can compare spend, conversions, and local lead quality.",
    highlight: "Campaign, spend, and conversion context for local monthly touches.",
    capabilities: ["Campaign reporting", "Spend trend analysis", "Lead source attribution"],
    defaultApiBaseUrl: "https://googleads.googleapis.com",
    fields: [],
    oauth: {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["https://www.googleapis.com/auth/adwords"],
      clientIdEnv: "GOOGLE_INTEGRATIONS_CLIENT_ID",
      clientSecretEnv: "GOOGLE_INTEGRATIONS_CLIENT_SECRET",
      transport: "standard_form",
      refreshStrategy: "standard_form",
      accessType: "offline",
      prompt: "consent",
      extraAuthorizeParams: { include_granted_scopes: "true" },
    },
  },
  {
    id: "meta-ads",
    name: "Meta Ads",
    shortName: "Meta Ads",
    category: "analytics",
    authMode: "oauth",
    description: "Authorize Meta Ads so MTOS can compare paid social efficiency against search and local visibility.",
    highlight: "Paid social performance and creative delivery tracking.",
    capabilities: ["Campaign performance", "Creative delivery context", "Channel comparison"],
    defaultApiBaseUrl: "https://graph.facebook.com/v20.0",
    fields: [],
    oauth: {
      authUrl: "https://www.facebook.com/v20.0/dialog/oauth",
      tokenUrl: "https://graph.facebook.com/v20.0/oauth/access_token",
      scopes: ["ads_management", "ads_read", "business_management"],
      clientIdEnv: "META_ADS_CLIENT_ID",
      clientSecretEnv: "META_ADS_CLIENT_SECRET",
      transport: "standard_form",
      refreshStrategy: "standard_form",
    },
  },
  {
    id: "google-analytics",
    name: "Google Analytics",
    shortName: "GA4",
    category: "analytics",
    authMode: "oauth",
    description: "Bring engagement and conversion metrics into MTOS to connect traffic quality with client outcomes.",
    highlight: "GA4 trends, engagement, and conversion signals.",
    capabilities: ["Engagement metrics", "Conversion reporting", "Campaign quality context"],
    defaultApiBaseUrl: "https://analyticsdata.googleapis.com",
    fields: [],
    oauth: {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
      clientIdEnv: "GOOGLE_INTEGRATIONS_CLIENT_ID",
      clientSecretEnv: "GOOGLE_INTEGRATIONS_CLIENT_SECRET",
      transport: "standard_form",
      refreshStrategy: "standard_form",
      accessType: "offline",
      prompt: "consent",
      extraAuthorizeParams: { include_granted_scopes: "true" },
    },
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    shortName: "Calendar",
    category: "communications",
    authMode: "oauth",
    description: "Bring upcoming meetings, attendees, and agenda context into MTOS so prep and follow-up are grounded in the calendar schedule.",
    highlight: "Calendar-based meeting context and timeline awareness.",
    capabilities: ["Upcoming meetings", "Attendee context", "Meeting timeline"],
    defaultApiBaseUrl: "https://www.googleapis.com/calendar/v3",
    fields: [],
    oauth: {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
      clientIdEnv: "GOOGLE_INTEGRATIONS_CLIENT_ID",
      clientSecretEnv: "GOOGLE_INTEGRATIONS_CLIENT_SECRET",
      transport: "standard_form",
      refreshStrategy: "standard_form",
      accessType: "offline",
      prompt: "consent",
      extraAuthorizeParams: { include_granted_scopes: "true" },
    },
  },
  {
    id: "google-meet",
    name: "Google Meet",
    shortName: "Meet",
    category: "communications",
    authMode: "oauth",
    description: "Authorize access to meeting link and schedule context so MTOS can surface Google Meet details alongside touch prep workflows.",
    highlight: "Meeting link visibility tied to scheduled calendar events.",
    capabilities: ["Meet link visibility", "Scheduled touch context", "Meeting timeline"],
    defaultApiBaseUrl: "https://meet.googleapis.com",
    fields: [],
    oauth: {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
      clientIdEnv: "GOOGLE_INTEGRATIONS_CLIENT_ID",
      clientSecretEnv: "GOOGLE_INTEGRATIONS_CLIENT_SECRET",
      transport: "standard_form",
      refreshStrategy: "standard_form",
      accessType: "offline",
      prompt: "consent",
      extraAuthorizeParams: { include_granted_scopes: "true" },
    },
  },
  {
    id: "gohighlevel",
    name: "GoHighLevel",
    shortName: "GoHighLevel",
    category: "crm",
    authMode: "oauth",
    description: "Connect CRM and pipeline data to give AMs shared visibility into lead, pipeline, and follow-up state.",
    highlight: "CRM, pipeline, and messaging activity from client accounts.",
    capabilities: ["Contact sync", "Opportunity context", "Workflow state review"],
    defaultApiBaseUrl: "https://services.leadconnectorhq.com",
    fields: [],
    oauth: {
      authUrl: "https://marketplace.gohighlevel.com/oauth/chooselocation",
      tokenUrl: "https://services.leadconnectorhq.com/oauth/token",
      scopes: [
        "contacts.readonly",
        "contacts.write",
        "opportunities.readonly",
        "opportunities.write",
        "locations.readonly",
      ],
      clientIdEnv: "GOHIGHLEVEL_CLIENT_ID",
      clientSecretEnv: "GOHIGHLEVEL_CLIENT_SECRET",
      authUrlEnv: "GOHIGHLEVEL_AUTH_URL",
      transport: "standard_form",
      refreshStrategy: "standard_form",
    },
  },
  {
    id: "google-drive",
    name: "Google Drive",
    shortName: "Drive",
    category: "data",
    authMode: "oauth",
    description: "Access decks, briefs, screenshots, and support files that should appear in prep and post-call workflows.",
    highlight: "Shared file access for briefs and supporting client evidence.",
    capabilities: ["Document retrieval", "Reference asset access", "Workspace file linking"],
    defaultApiBaseUrl: "https://www.googleapis.com/drive/v3",
    fields: [],
    oauth: {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["https://www.googleapis.com/auth/drive.readonly"],
      clientIdEnv: "GOOGLE_INTEGRATIONS_CLIENT_ID",
      clientSecretEnv: "GOOGLE_INTEGRATIONS_CLIENT_SECRET",
      transport: "standard_form",
      refreshStrategy: "standard_form",
      accessType: "offline",
      prompt: "consent",
      extraAuthorizeParams: { include_granted_scopes: "true" },
    },
  },
  {
    id: "gmail",
    name: "Gmail",
    shortName: "Gmail",
    category: "communications",
    authMode: "oauth",
    description: "Authorize inbox access so MTOS can reference client communications when preparing and closing touches.",
    highlight: "Email conversation context tied to clients and follow-ups.",
    capabilities: ["Inbox retrieval", "Conversation context", "Thread history reference"],
    defaultApiBaseUrl: "https://gmail.googleapis.com",
    fields: [],
    oauth: {
      authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      clientIdEnv: "GOOGLE_INTEGRATIONS_CLIENT_ID",
      clientSecretEnv: "GOOGLE_INTEGRATIONS_CLIENT_SECRET",
      transport: "standard_form",
      refreshStrategy: "standard_form",
      accessType: "offline",
      prompt: "consent",
      extraAuthorizeParams: { include_granted_scopes: "true" },
    },
  },
  {
    id: "ahrefs",
    name: "Ahrefs",
    shortName: "Ahrefs",
    category: "search",
    authMode: "api_key",
    description: "Store an Ahrefs API token and base endpoint so MTOS can pull backlink and keyword signals that support SEO recommendations.",
    highlight: "Backlink and keyword visibility through a direct API connection.",
    capabilities: ["Backlink overview", "Keyword metrics", "SEO visibility context"],
    defaultApiBaseUrl: "https://apiv2.ahrefs.com",
    fields: [
      {
        key: "apiBaseUrl",
        label: "API base URL",
        placeholder: "https://apiv2.ahrefs.com",
        helperText: "Base endpoint for Ahrefs API requests.",
        required: true,
        type: "url",
      },
      {
        key: "apiKey",
        label: "API token",
        placeholder: "Paste Ahrefs API token",
        helperText: "Stored securely and used in server-side requests only.",
        required: true,
        secret: true,
        type: "password",
      },
    ],
  },
  {
    id: "rank-tracker",
    name: "Rank Tracker",
    shortName: "Rank Tracker",
    category: "search",
    authMode: "rotating_token",
    description: "Use a token-generation endpoint to keep ranking data accessible without forcing the user to reconnect manually.",
    highlight: "Refreshable token flow for recurring ranking snapshots.",
    capabilities: ["Timed token renewal", "Endpoint-based token generation", "Ranking data retrieval"],
    fields: rotatingTokenFields,
  },
  {
    id: "geogrid",
    name: "GeoGrid",
    shortName: "GeoGrid",
    category: "search",
    authMode: "api_key",
    description: "Store a stable API key and base endpoint for geo-grid visibility pulls used by local SEO reviews.",
    highlight: "Geo-grid visibility retrieval through a direct API integration.",
    capabilities: ["Geo-grid pull", "Location comparison", "Grid snapshot ingestion"],
    fields: [
      {
        key: "apiBaseUrl",
        label: "API base URL",
        placeholder: "https://api.example.com/v1",
        helperText: "Base endpoint for GeoGrid requests.",
        required: true,
        type: "url",
      },
      {
        key: "apiKey",
        label: "API key",
        placeholder: "Paste provider API key",
        helperText: "Stored securely and used in server-side requests only.",
        required: true,
        secret: true,
        type: "password",
      },
    ],
  },
  {
    id: "map-checkins",
    name: "Map Check-Ins",
    shortName: "Map Check-Ins",
    category: "search",
    authMode: "rotating_token",
    description: "Connect a provider that issues short-lived tokens from an endpoint so MTOS can continue pulling check-in activity safely.",
    highlight: "Endpoint-issued token rotation for check-in activity data.",
    capabilities: ["Timed token renewal", "Endpoint-driven auth", "Check-in activity retrieval"],
    fields: rotatingTokenFields,
  },
  {
    id: "stripe",
    name: "Stripe",
    shortName: "Stripe",
    category: "finance",
    authMode: "api_key",
    description: "Store a server-side key so MTOS can link billing, subscription, and payment status to client health.",
    highlight: "Billing and subscription visibility through a secure API key connection.",
    capabilities: ["Subscription status", "Invoice state", "Payment context"],
    defaultApiBaseUrl: "https://api.stripe.com/v1",
    fields: [
      {
        key: "apiKey",
        label: "Secret key",
        placeholder: "sk_live_...",
        helperText: "Use a restricted secret key for server-side Stripe API access.",
        required: true,
        secret: true,
        type: "password",
      },
    ],
  },
  {
    id: "quickbooks",
    name: "QuickBooks",
    shortName: "QuickBooks",
    category: "finance",
    authMode: "oauth",
    description: "Connect QuickBooks Online so financial status can be referenced alongside account-manager work.",
    highlight: "Accounting data with token refresh for long-lived connections.",
    capabilities: ["Realm-aware auth", "Financial context", "Invoice and payment visibility"],
    defaultApiBaseUrl: "https://quickbooks.api.intuit.com/v3/company",
    fields: [],
    oauth: {
      authUrl: "https://appcenter.intuit.com/connect/oauth2",
      tokenUrl: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
      scopes: ["com.intuit.quickbooks.accounting"],
      clientIdEnv: "QUICKBOOKS_CLIENT_ID",
      clientSecretEnv: "QUICKBOOKS_CLIENT_SECRET",
      transport: "quickbooks_basic_auth",
      refreshStrategy: "quickbooks_basic_auth",
    },
  },
  {
    id: "internal-database",
    name: "Internal Database",
    shortName: "Internal DB",
    category: "data",
    authMode: "api_key",
    description: "Register internal API or warehouse endpoints so MTOS can fetch source-of-truth records through a controlled server connection.",
    highlight: "Internal endpoints and service tokens for tenant-safe data pulls.",
    capabilities: ["Warehouse access", "Internal API bridge", "Controlled server-side retrieval"],
    fields: [
      {
        key: "endpointUrl",
        label: "Endpoint URL",
        placeholder: "https://internal.example.com/mtos",
        helperText: "Root endpoint MTOS should use when querying the internal system.",
        required: true,
        type: "url",
      },
      {
        key: "apiKey",
        label: "Service token",
        placeholder: "Paste service token",
        helperText: "Server-side service token used for internal endpoint authentication.",
        required: true,
        secret: true,
        type: "password",
      },
    ],
  },
];

type StoredCredentials = Record<string, string>;

function getProviderDefinition(providerId: IntegrationProviderId) {
  const provider = providerDefinitions.find((item) => item.id === providerId);
  if (!provider) {
    throw new Error(`Unknown integration provider: ${providerId}`);
  }
  return provider;
}

function getNowIso() {
  return new Date().toISOString();
}

function addMinutes(isoDate: string, minutes: number) {
  const date = new Date(isoDate);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function getOptionalEnv(name: string) {
  return process.env[name] || "";
}

function getCallbackBaseUrl(origin?: string) {
  const env = getServerEnv();
  return env.appUrl || origin || "";
}

function getOAuthRedirectUri(provider: ProviderDefinition, origin?: string) {
  if (!provider.oauth) {
    return "";
  }

  const configuredRedirect = provider.oauth.redirectUriEnv
    ? getOptionalEnv(provider.oauth.redirectUriEnv)
    : "";
  if (configuredRedirect) {
    return configuredRedirect;
  }

  const baseUrl = getCallbackBaseUrl(origin);
  if (!baseUrl) {
    return "";
  }

  return `${baseUrl}/api/integrations/oauth/callback`;
}

function getOAuthAuthorizeUrl(provider: ProviderDefinition) {
  if (!provider.oauth) {
    return "";
  }

  const configuredAuthUrl = provider.oauth.authUrlEnv
    ? getOptionalEnv(provider.oauth.authUrlEnv)
    : "";

  return configuredAuthUrl || provider.oauth.authUrl;
}

function getOAuthClientConfig(provider: ProviderDefinition, origin?: string) {
  if (!provider.oauth) {
    return null;
  }

  const clientId = getOptionalEnv(provider.oauth.clientIdEnv);
  const clientSecret = getOptionalEnv(provider.oauth.clientSecretEnv);
  const redirectUri = getOAuthRedirectUri(provider, origin);

  return {
    clientId,
    clientSecret,
    redirectUri,
    configured: Boolean(clientId && clientSecret && redirectUri),
  };
}

function getEncryptionKey() {
  const env = getServerEnv();
  if (!env.integrationsEncryptionSecret) {
    throw new Error("MTOS integration encryption secret is not configured");
  }

  return createHash("sha256").update(env.integrationsEncryptionSecret).digest();
}

function sealCredentials(credentials: StoredCredentials) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

function unsealCredentials(ciphertext?: string): StoredCredentials {
  if (!ciphertext) {
    return {};
  }

  const buffer = Buffer.from(ciphertext, "base64url");
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const payload = buffer.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(decrypted) as Record<string, unknown>;

  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, value == null ? "" : String(value)]),
  );
}

function maskSecret(value?: string) {
  if (!value) {
    return "";
  }

  if (value.length <= 6) {
    return `${"*".repeat(Math.max(value.length - 2, 0))}${value.slice(-2)}`;
  }

  return `${value.slice(0, 3)}...${value.slice(-4)}`;
}

function parseStoredConnection(payload: Record<string, unknown>): IntegrationConnectionRecord {
  return {
    providerId: String(payload.providerId) as IntegrationProviderId,
    providerName: String(payload.providerName || ""),
    tenantId: String(payload.tenantId || ""),
    authMode: String(payload.authMode) as IntegrationAuthMode,
    status: String(payload.status) as IntegrationConnectionRecord["status"],
    category: String(payload.category) as IntegrationCategory,
    connectedBy: String(payload.connectedBy || ""),
    connectedAt: String(payload.connectedAt || ""),
    updatedAt: String(payload.updatedAt || ""),
    lastValidatedAt: payload.lastValidatedAt ? String(payload.lastValidatedAt) : undefined,
    lastRefreshAt: payload.lastRefreshAt ? String(payload.lastRefreshAt) : undefined,
    tokenExpiresAt: payload.tokenExpiresAt ? String(payload.tokenExpiresAt) : undefined,
    refreshWindowMinutes:
      typeof payload.refreshWindowMinutes === "number"
        ? payload.refreshWindowMinutes
        : payload.refreshWindowMinutes
          ? Number(payload.refreshWindowMinutes)
          : undefined,
    endpointUrl: payload.endpointUrl ? String(payload.endpointUrl) : undefined,
    apiBaseUrl: payload.apiBaseUrl ? String(payload.apiBaseUrl) : undefined,
    displayLabel: payload.displayLabel ? String(payload.displayLabel) : undefined,
    externalAccountId: payload.externalAccountId ? String(payload.externalAccountId) : undefined,
    scopes: Array.isArray(payload.scopes)
      ? payload.scopes.map((value) => String(value))
      : undefined,
    errorMessage: payload.errorMessage ? String(payload.errorMessage) : undefined,
    metadata:
      payload.metadata && typeof payload.metadata === "object"
        ? Object.fromEntries(
            Object.entries(payload.metadata as Record<string, unknown>).map(([key, value]) => [
              key,
              value == null ? "" : String(value),
            ]),
          )
        : undefined,
    credentialCiphertext: payload.credentialCiphertext
      ? String(payload.credentialCiphertext)
      : undefined,
  };
}

async function listStoredConnections(tenantId: string) {
  const db = getFirebaseAdminDb();
  if (!db) {
    return new Map<IntegrationProviderId, IntegrationConnectionRecord>();
  }

  const snapshot = await db.collection(integrationsCollectionPath(tenantId)).get();
  return new Map<IntegrationProviderId, IntegrationConnectionRecord>(
    snapshot.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return [doc.id as IntegrationProviderId, parseStoredConnection(data)];
    }),
  );
}

async function getStoredConnection(tenantId: string, providerId: IntegrationProviderId) {
  const db = getFirebaseAdminDb();
  if (!db) {
    return undefined;
  }

  const snapshot = await db.doc(integrationConnectionPath(tenantId, providerId)).get();
  if (!snapshot.exists) {
    return undefined;
  }

  return parseStoredConnection(snapshot.data() as Record<string, unknown>);
}

async function saveStoredConnection(record: IntegrationConnectionRecord) {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firebase Admin must be configured before integrations can be stored");
  }

  const sanitizedRecord = Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as Record<string, unknown>;

  await db.doc(integrationConnectionPath(record.tenantId, record.providerId)).set(sanitizedRecord);
}

async function listLatestSyncJobs(tenantId: string) {
  const db = getFirebaseAdminDb();
  if (!db) {
    return new Map<IntegrationProviderId, IntegrationSyncJobRecord>();
  }

  const snapshot = await db
    .collection(integrationSyncJobsCollectionPath(tenantId))
    .orderBy("startedAt", "desc")
    .limit(50)
    .get();

  const latestJobs = new Map<IntegrationProviderId, IntegrationSyncJobRecord>();
  for (const doc of snapshot.docs) {
    const job = doc.data() as IntegrationSyncJobRecord;
    if (!latestJobs.has(job.providerId)) {
      latestJobs.set(job.providerId, job);
    }
  }

  return latestJobs;
}

async function deleteStoredConnection(tenantId: string, providerId: IntegrationProviderId) {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firebase Admin must be configured before integrations can be removed");
  }

  await db.doc(integrationConnectionPath(tenantId, providerId)).delete();
}

function getStatusDetail(provider: ProviderDefinition, record?: IntegrationConnectionRecord) {
  if (!record) {
    if (provider.authMode === "oauth") {
      const config = getOAuthClientConfig(provider);
      return config?.configured
        ? "Ready to connect with the provider authorization flow."
        : "Provider credentials are not configured in the environment yet.";
    }
    if (provider.authMode === "rotating_token") {
      return "Needs a token-generation endpoint and refresh window before data can sync.";
    }
    return "Needs a server-side API credential before data can sync.";
  }

  if (record.errorMessage) {
    return record.errorMessage;
  }

  if (record.status === "expiring" && record.tokenExpiresAt) {
    return `Token rotation due by ${new Date(record.tokenExpiresAt).toLocaleString("en-US")}.`;
  }

  if (record.status === "connected") {
    return record.displayLabel
      ? `Connected as ${record.displayLabel}.`
      : "Connected and ready for secure server-side requests.";
  }

  if (record.status === "action_required") {
    return "Connection needs attention before MTOS can sync data.";
  }

  return "Connection is configured but not yet active.";
}

function deriveConnectionStatus(record?: IntegrationConnectionRecord): IntegrationProviderView["status"] {
  if (!record) {
    return "not_connected";
  }

  if (record.tokenExpiresAt) {
    const expiry = new Date(record.tokenExpiresAt).getTime();
    const minutesUntilExpiry = Math.round((expiry - Date.now()) / 60000);
    if (Number.isFinite(minutesUntilExpiry) && minutesUntilExpiry <= 15 && record.status === "connected") {
      return "expiring";
    }
  }

  return record.status;
}

function toProviderView(
  provider: ProviderDefinition,
  record?: IntegrationConnectionRecord,
  latestSyncJob?: IntegrationSyncJobRecord,
): IntegrationProviderView {
  const oauthConfig = provider.authMode === "oauth" ? getOAuthClientConfig(provider) : null;
  const status = deriveConnectionStatus(record);

  return {
    id: provider.id,
    name: provider.name,
    shortName: provider.shortName,
    category: provider.category,
    authMode: provider.authMode,
    description: provider.description,
    highlight: provider.highlight,
    connectionLabel:
      record?.displayLabel ||
      (record?.credentialCiphertext
        ? `Credential ${maskSecret(unsealCredentials(record.credentialCiphertext).apiKey)}`
        : "No active connection"),
    status,
    statusDetail: getStatusDetail(provider, record ? { ...record, status } : undefined),
    isConfigured: provider.authMode === "oauth" ? Boolean(oauthConfig?.configured) : true,
    isConnected: Boolean(record && record.status === "connected"),
    allowsOAuth: provider.authMode === "oauth",
    supportsRefresh: provider.authMode === "rotating_token" || provider.oauth?.refreshStrategy !== "none",
    supportsSync: syncEnabledProviders.has(provider.id),
    connectedAt: record?.connectedAt,
    lastRefreshAt: record?.lastRefreshAt,
    lastSyncAt: latestSyncJob?.finishedAt || latestSyncJob?.startedAt,
    lastSyncStatus: latestSyncJob?.status || "idle",
    lastSyncSummary: latestSyncJob?.summary,
    lastSyncCount: latestSyncJob?.counts.fetched,
    tokenExpiresAt: record?.tokenExpiresAt,
    apiBaseUrl: record?.apiBaseUrl || provider.defaultApiBaseUrl,
    endpointUrl: record?.endpointUrl,
    displayLabel: record?.displayLabel,
    fields: provider.fields,
    capabilities: provider.capabilities,
  };
}

function getStringFromPayload(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value) {
      return value;
    }
  }

  return "";
}

function getNumberFromPayload(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
}

async function createOAuthState(context: TenantContext, providerId: IntegrationProviderId) {
  const secret = new TextEncoder().encode(getServerEnv().sessionCookieSecret);
  if (!secret.length) {
    throw new Error("SESSION_COOKIE_SECRET must be configured before OAuth can start");
  }

  return new SignJWT({
    providerId,
    tenantId: context.tenantId,
    userId: context.userId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(OAUTH_STATE_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(secret);
}

async function verifyOAuthState(stateToken: string) {
  const secret = new TextEncoder().encode(getServerEnv().sessionCookieSecret);
  if (!secret.length) {
    throw new Error("SESSION_COOKIE_SECRET must be configured before OAuth can complete");
  }

  const verified = await jwtVerify(stateToken, secret, {
    audience: OAUTH_STATE_AUDIENCE,
  });

  const payload = verified.payload as {
    providerId?: string;
    tenantId?: string;
    userId?: string;
  };

  if (!payload.providerId || !payload.tenantId || !payload.userId) {
    throw new Error("OAuth callback state is missing required context");
  }

  return {
    providerId: payload.providerId as IntegrationProviderId,
    tenantId: payload.tenantId,
    userId: payload.userId,
  };
}

async function exchangeOAuthToken(
  provider: ProviderDefinition,
  params: { code?: string; refreshToken?: string },
  origin?: string,
) {
  if (!provider.oauth) {
    throw new Error("Selected provider does not support OAuth");
  }

  const clientConfig = getOAuthClientConfig(provider, origin);
  if (!clientConfig?.configured) {
    throw new Error(`${provider.name} OAuth credentials are not configured`);
  }

  const grantType = params.code ? "authorization_code" : "refresh_token";
  const tokenParams = new URLSearchParams({
    redirect_uri: clientConfig.redirectUri,
    grant_type: grantType,
  });

  if (params.code) {
    tokenParams.set("code", params.code);
  }
  if (params.refreshToken) {
    tokenParams.set("refresh_token", params.refreshToken);
  }

  let response: Response;

  if (provider.oauth.transport === "clickup_query") {
    const url = new URL(provider.oauth.tokenUrl);
    url.searchParams.set("client_id", clientConfig.clientId);
    url.searchParams.set("client_secret", clientConfig.clientSecret);
    if (params.code) {
      url.searchParams.set("code", params.code);
    }
    url.searchParams.set("redirect_uri", clientConfig.redirectUri);
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
    });
  } else if (provider.oauth.transport === "quickbooks_basic_auth") {
    const basicAuth = Buffer.from(`${clientConfig.clientId}:${clientConfig.clientSecret}`).toString("base64");
    response = await fetch(provider.oauth.tokenUrl, {
      method: "POST",
      headers: {
        authorization: `Basic ${basicAuth}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: tokenParams.toString(),
    });
  } else {
    tokenParams.set("client_id", clientConfig.clientId);
    tokenParams.set("client_secret", clientConfig.clientSecret);
    response = await fetch(provider.oauth.tokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: tokenParams.toString(),
    });
  }

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const errorMessage =
      getStringFromPayload(payload, ["error_description", "error", "message"]) ||
      `Token exchange failed with status ${response.status}`;
    throw new Error(errorMessage);
  }

  return payload;
}

function buildAuthorizationUrl(provider: ProviderDefinition, context: TenantContext, origin?: string) {
  if (!provider.oauth) {
    throw new Error(`${provider.name} does not support OAuth`);
  }

  const clientConfig = getOAuthClientConfig(provider, origin);
  if (!clientConfig?.configured) {
    throw new Error(`${provider.name} OAuth credentials are not configured`);
  }

  return createOAuthState(context, provider.id).then((state) => {
    const authUrl = new URL(getOAuthAuthorizeUrl(provider));
    authUrl.searchParams.set("client_id", clientConfig.clientId);
    authUrl.searchParams.set("redirect_uri", clientConfig.redirectUri);
    authUrl.searchParams.set("state", state);

    if (provider.id !== "clickup") {
      authUrl.searchParams.set("response_type", "code");
    }

    if (provider.oauth!.scopes.length > 0) {
      authUrl.searchParams.set("scope", provider.oauth!.scopes.join(" "));
    }

    if (provider.oauth!.accessType) {
      authUrl.searchParams.set("access_type", provider.oauth!.accessType);
    }

    if (provider.oauth!.prompt) {
      authUrl.searchParams.set("prompt", provider.oauth!.prompt);
    }

    for (const [key, value] of Object.entries(provider.oauth!.extraAuthorizeParams || {})) {
      authUrl.searchParams.set(key, value);
    }

    return authUrl.toString();
  });
}

function buildStoredRecord(
  provider: ProviderDefinition,
  context: TenantContext,
  partial: Partial<IntegrationConnectionRecord> & { status: IntegrationConnectionRecord["status"] },
  credentials?: StoredCredentials,
) {
  const now = getNowIso();
  return {
    providerId: provider.id,
    providerName: provider.name,
    tenantId: context.tenantId,
    authMode: provider.authMode,
    category: provider.category,
    connectedBy: partial.connectedBy || context.userId,
    connectedAt: partial.connectedAt || now,
    updatedAt: now,
    status: partial.status,
    apiBaseUrl: partial.apiBaseUrl || provider.defaultApiBaseUrl,
    endpointUrl: partial.endpointUrl,
    displayLabel: partial.displayLabel,
    externalAccountId: partial.externalAccountId,
    scopes: partial.scopes,
    lastValidatedAt: partial.lastValidatedAt,
    lastRefreshAt: partial.lastRefreshAt,
    tokenExpiresAt: partial.tokenExpiresAt,
    refreshWindowMinutes: partial.refreshWindowMinutes,
    errorMessage: partial.errorMessage,
    metadata: partial.metadata,
    credentialCiphertext: credentials ? sealCredentials(credentials) : partial.credentialCiphertext,
  } satisfies IntegrationConnectionRecord;
}

function assertRequiredFields(provider: ProviderDefinition, credentials: StoredCredentials) {
  const missingFields = provider.fields
    .filter((field) => field.required)
    .filter((field) => !credentials[field.key])
    .map((field) => field.label);

  if (missingFields.length > 0) {
    throw new Error(`Missing required fields for ${provider.name}: ${missingFields.join(", ")}`);
  }
}

export async function listIntegrationViews(context: TenantContext) {
  const storedConnections = await listStoredConnections(context.tenantId);
  const latestJobs = await listLatestSyncJobs(context.tenantId);
  return providerDefinitions.map((provider) =>
    toProviderView(provider, storedConnections.get(provider.id), latestJobs.get(provider.id)),
  );
}

export async function connectIntegration(
  context: TenantContext,
  providerId: IntegrationProviderId,
  credentials: StoredCredentials,
  origin?: string,
) {
  const provider = getProviderDefinition(providerId);

  if (provider.authMode === "oauth") {
    return {
      redirectUrl: await buildAuthorizationUrl(provider, context, origin),
      provider: toProviderView(provider),
    };
  }

  assertRequiredFields(provider, credentials);

  const refreshWindowMinutes =
    provider.authMode === "rotating_token"
      ? Number(credentials.refreshWindowMinutes || "120")
      : undefined;
  const now = getNowIso();
  const displayValue =
    provider.authMode === "api_key"
      ? maskSecret(credentials.apiKey)
      : `${Math.max(refreshWindowMinutes || 0, 1)} minute refresh window`;

  const record = buildStoredRecord(
    provider,
    context,
    {
      status: "connected",
      displayLabel: displayValue,
      endpointUrl: credentials.syncEndpoint || credentials.endpointUrl,
      apiBaseUrl: credentials.apiBaseUrl || provider.defaultApiBaseUrl,
      tokenExpiresAt:
        provider.authMode === "rotating_token" && refreshWindowMinutes
          ? addMinutes(now, refreshWindowMinutes)
          : undefined,
      refreshWindowMinutes,
      lastValidatedAt: now,
    },
    credentials,
  );

  await saveStoredConnection(record);

  return {
    provider: toProviderView(provider, record),
  };
}

export async function disconnectIntegration(context: TenantContext, providerId: IntegrationProviderId) {
  getProviderDefinition(providerId);
  await deleteStoredConnection(context.tenantId, providerId);
}

export async function refreshIntegration(context: TenantContext, providerId: IntegrationProviderId, origin?: string) {
  const provider = getProviderDefinition(providerId);
  const existing = await getStoredConnection(context.tenantId, providerId);
  if (!existing) {
    throw new Error(`${provider.name} is not connected yet`);
  }

  const credentials = unsealCredentials(existing.credentialCiphertext);
  const now = getNowIso();

  if (provider.authMode === "rotating_token") {
    const tokenEndpoint = credentials.tokenEndpoint;
    if (!tokenEndpoint) {
      throw new Error(`${provider.name} is missing a token-generation endpoint`);
    }

    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: credentials.apiKey ? `Bearer ${credentials.apiKey}` : "",
        "x-api-key": credentials.apiKey || "",
      },
      body: JSON.stringify({
        type: "email",
        email: credentials.clientId,
        password: credentials.clientSecret,
        apiKey: credentials.apiKey,
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        currentToken: credentials.accessToken,
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(
        getStringFromPayload(payload, ["error", "message"]) ||
          `Token refresh failed with status ${response.status}`,
      );
    }

    const nestedPayload =
      payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : {};
    const nextToken =
      getStringFromPayload(payload, ["access_token", "token", "accessToken"]) ||
      getStringFromPayload(nestedPayload, ["access_token", "token", "accessToken"]) ||
      credentials.accessToken;
    const expiresInSeconds = getNumberFromPayload(payload, ["expires_in", "expiresIn"]);
    const refreshWindowMinutes =
      Number(credentials.refreshWindowMinutes || existing.refreshWindowMinutes || "120") || 120;
    const refreshedCredentials = {
      ...credentials,
      accessToken: nextToken,
    };

    const refreshedRecord = buildStoredRecord(
      provider,
      context,
      {
        status: "connected",
        connectedAt: existing.connectedAt,
        displayLabel: existing.displayLabel,
        endpointUrl: existing.endpointUrl,
        apiBaseUrl: existing.apiBaseUrl,
        lastValidatedAt: now,
        lastRefreshAt: now,
        refreshWindowMinutes,
        tokenExpiresAt: expiresInSeconds
          ? addMinutes(now, Math.max(Math.round(expiresInSeconds / 60), 1))
          : addMinutes(now, refreshWindowMinutes),
      },
      refreshedCredentials,
    );

    await saveStoredConnection(refreshedRecord);
    return toProviderView(provider, refreshedRecord);
  }

  if (provider.authMode === "oauth") {
    if (!provider.oauth || provider.oauth.refreshStrategy === "none") {
      const updatedRecord = buildStoredRecord(
        provider,
        context,
        {
          ...existing,
          status: "connected",
          connectedAt: existing.connectedAt,
          lastValidatedAt: now,
        },
      );
      await saveStoredConnection(updatedRecord);
      return toProviderView(provider, updatedRecord);
    }

    if (!credentials.refreshToken) {
      throw new Error(`${provider.name} does not have a refresh token saved`);
    }

    const payload = await exchangeOAuthToken(
      provider,
      { refreshToken: credentials.refreshToken },
      origin,
    );

    const accessToken = getStringFromPayload(payload, ["access_token", "accessToken"]);
    const refreshToken =
      getStringFromPayload(payload, ["refresh_token", "refreshToken"]) || credentials.refreshToken;
    const expiresInSeconds = getNumberFromPayload(payload, ["expires_in", "expiresIn"]);
    const updatedRecord = buildStoredRecord(
      provider,
      context,
      {
        status: "connected",
        connectedAt: existing.connectedAt,
        displayLabel: existing.displayLabel,
        externalAccountId: existing.externalAccountId,
        endpointUrl: existing.endpointUrl,
        apiBaseUrl: existing.apiBaseUrl,
        scopes: existing.scopes,
        metadata: existing.metadata,
        lastValidatedAt: now,
        lastRefreshAt: now,
        tokenExpiresAt: expiresInSeconds
          ? addMinutes(now, Math.max(Math.round(expiresInSeconds / 60), 1))
          : existing.tokenExpiresAt,
      },
      {
        ...credentials,
        accessToken,
        refreshToken,
      },
    );
    await saveStoredConnection(updatedRecord);
    return toProviderView(provider, updatedRecord);
  }

  const updatedRecord = buildStoredRecord(
    provider,
    context,
    {
      ...existing,
      status: "connected",
      connectedAt: existing.connectedAt,
      lastValidatedAt: now,
    },
    credentials,
  );
  await saveStoredConnection(updatedRecord);
  return toProviderView(provider, updatedRecord);
}

export async function completeOAuthConnection(
  callbackUrl: URL,
  params: { code: string; state: string },
  origin?: string,
) {
  const state = await verifyOAuthState(params.state);
  const provider = getProviderDefinition(state.providerId);
  if (!provider.oauth) {
    throw new Error(`${provider.name} does not support OAuth`);
  }

  const payload = await exchangeOAuthToken(provider, { code: params.code }, origin);
  const now = getNowIso();
  const accessToken = getStringFromPayload(payload, ["access_token", "accessToken"]);
  const refreshToken = getStringFromPayload(payload, ["refresh_token", "refreshToken"]);
  const expiresInSeconds = getNumberFromPayload(payload, ["expires_in", "expiresIn"]);
  const realmId = callbackUrl.searchParams.get("realmId") || undefined;
  const workspaceId = callbackUrl.searchParams.get("workspace_id") || undefined;
  const locationId = getStringFromPayload(payload, ["locationId", "location_id"]) || undefined;

  const record = buildStoredRecord(
    provider,
    {
      tenantId: state.tenantId,
      userId: state.userId,
      role: "tenant_admin",
    },
    {
      status: "connected",
      displayLabel: realmId || workspaceId || locationId || "Authorized account",
      externalAccountId: realmId || workspaceId || locationId,
      scopes: provider.oauth.scopes,
      metadata: {
        ...(realmId ? { realmId } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        ...(locationId ? { locationId } : {}),
      },
      lastValidatedAt: now,
      lastRefreshAt: now,
      tokenExpiresAt: expiresInSeconds
        ? addMinutes(now, Math.max(Math.round(expiresInSeconds / 60), 1))
        : undefined,
    },
    {
      accessToken,
      refreshToken,
      ...(locationId ? { locationId } : {}),
    },
  );

  await saveStoredConnection(record);
  return provider.id;
}

export function getIntegrationProviderIds() {
  return integrationProviderIds;
}

export async function getIntegrationConnection(
  context: TenantContext,
  providerId: IntegrationProviderId,
) {
  getProviderDefinition(providerId);
  return getStoredConnection(context.tenantId, providerId);
}

export function getIntegrationCredentials(record?: IntegrationConnectionRecord) {
  return unsealCredentials(record?.credentialCiphertext);
}

export function getIntegrationDefinition(providerId: IntegrationProviderId) {
  return getProviderDefinition(providerId);
}
