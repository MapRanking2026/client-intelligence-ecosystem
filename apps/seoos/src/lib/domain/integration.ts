import { z } from "zod";
import { zIsoTimestamp, zTenantId, zUserId } from "@cie/contracts";

export const IntegrationAuthMode = z.enum(["api_key", "oauth"]);
export type IntegrationAuthMode = z.infer<typeof IntegrationAuthMode>;

export const IntegrationStatus = z.enum(["not_connected", "connected", "error"]);
export type IntegrationStatus = z.infer<typeof IntegrationStatus>;

export interface IntegrationField {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
}

export interface IntegrationProviderDef {
  id: string;
  name: string;
  category: string;
  authMode: IntegrationAuthMode;
  /** Whether SEOOS can sync data from this provider today. */
  syncable: boolean;
  description: string;
  fields: IntegrationField[];
  dataKinds: string[];
  /** If set, this provider is served by another provider's connection (no own form). */
  poweredBy?: string;
}

/**
 * SEOOS-native integration catalog. API-key providers are connectable now via
 * the connect form; OAuth providers are listed but require an OAuth flow (their
 * connect form is disabled until that lands).
 */
export const SEO_INTEGRATION_CATALOG: IntegrationProviderDef[] = [
  {
    id: "clickup",
    name: "ClickUp",
    category: "operations",
    authMode: "api_key",
    syncable: true,
    description: "Client Book, tasks, and delivery context. Personal API token.",
    fields: [
      { key: "apiToken", label: "API Token", secret: true, required: true, placeholder: "pk_..." },
      { key: "teamId", label: "Team ID (optional)", secret: false, required: false, placeholder: "workspace/team id" },
    ],
    dataKinds: ["tasks", "docs"],
  },
  {
    id: "rank-tracker",
    name: "Rank Tracker (MapRanking)",
    category: "search",
    authMode: "api_key",
    syncable: true,
    description:
      "MapRanking dashboard login. One connection powers Rank Tracker rankings, grids, AND Map Check-Ins. A fresh bearer token is fetched per sync.",
    fields: [
      { key: "clientId", label: "Client ID (login email)", secret: false, required: true, placeholder: "you@agency.com" },
      { key: "clientSecret", label: "Client Secret (password)", secret: true, required: true },
      { key: "apiBaseUrl", label: "API Base URL (optional)", secret: false, required: false, placeholder: "https://dashboardapi.mapranking.com" },
    ],
    dataKinds: ["rankings", "keywords", "grids", "map-checkins"],
  },
  {
    id: "map-checkins",
    name: "Map Check-Ins",
    category: "operations",
    authMode: "api_key",
    syncable: false,
    poweredBy: "rank-tracker",
    description: "Check-in activity and counts. Uses the Rank Tracker (MapRanking) connection.",
    fields: [],
    dataKinds: ["map-checkins"],
  },
  {
    id: "ahrefs",
    name: "Ahrefs",
    category: "search",
    authMode: "api_key",
    syncable: false,
    description: "Backlinks and organic keyword data.",
    fields: [{ key: "apiToken", label: "API Token", secret: true, required: true }],
    dataKinds: ["backlinks", "keywords"],
  },
  {
    id: "gohighlevel",
    name: "GoHighLevel",
    category: "crm",
    authMode: "api_key",
    syncable: false,
    description: "Leads, calls, and conversations. Agency API key.",
    fields: [{ key: "apiKey", label: "API Key", secret: true, required: true }],
    dataKinds: ["leads", "calls"],
  },
  {
    id: "google-business-profile",
    name: "Google Business Profile",
    category: "search",
    authMode: "oauth",
    syncable: false,
    description: "GBP performance and profile data (requires Google OAuth).",
    fields: [],
    dataKinds: ["gbp"],
  },
  {
    id: "google-search-console",
    name: "Google Search Console",
    category: "search",
    authMode: "oauth",
    syncable: false,
    description: "Query and page performance (requires Google OAuth).",
    fields: [],
    dataKinds: ["search-analytics"],
  },
];

export function getProviderDef(id: string): IntegrationProviderDef | undefined {
  return SEO_INTEGRATION_CATALOG.find((p) => p.id === id);
}

export const IntegrationConnectionV1 = z.object({
  schemaVersion: z.literal(1),
  tenantId: zTenantId,
  providerId: z.string().min(1),
  status: IntegrationStatus.default("not_connected"),
  authMode: IntegrationAuthMode,
  /** Encrypted JSON blob of the credential field values. Never returned raw. */
  credentialCiphertext: z.string().optional(),
  /** Non-secret display hints (e.g. which fields are set, teamId). */
  metadata: z.record(z.string(), z.string()).default({}),
  connectedByUserId: zUserId.optional(),
  connectedAt: zIsoTimestamp.optional(),
  updatedAt: zIsoTimestamp,
  errorMessage: z.string().optional(),
});
export type IntegrationConnectionV1 = z.infer<typeof IntegrationConnectionV1>;
