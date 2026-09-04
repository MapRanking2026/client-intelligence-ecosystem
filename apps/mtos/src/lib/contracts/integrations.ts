export const integrationProviderIds = [
  "clickup",
  "google-business-profile",
  "google-search-console",
  "google-ads",
  "meta-ads",
  "google-analytics",
  "google-calendar",
  "google-meet",
  "gohighlevel",
  "google-drive",
  "gmail",
  "ahrefs",
  "rank-tracker",
  "geogrid",
  "map-checkins",
  "stripe",
  "quickbooks",
  "internal-database",
] as const;

export type IntegrationProviderId = (typeof integrationProviderIds)[number];

export type IntegrationAuthMode = "oauth" | "api_key" | "rotating_token";

export type IntegrationStatus =
  | "not_connected"
  | "connected"
  | "action_required"
  | "expiring"
  | "error";

export type IntegrationCategory =
  | "operations"
  | "search"
  | "analytics"
  | "crm"
  | "communications"
  | "finance"
  | "data";

export interface IntegrationFieldDefinition {
  key: string;
  label: string;
  placeholder: string;
  helperText?: string;
  required?: boolean;
  secret?: boolean;
  type?: "text" | "url" | "password" | "number";
}

export interface IntegrationConnectionRecord {
  providerId: IntegrationProviderId;
  providerName: string;
  tenantId: string;
  authMode: IntegrationAuthMode;
  status: IntegrationStatus;
  category: IntegrationCategory;
  connectedBy: string;
  connectedAt: string;
  updatedAt: string;
  lastValidatedAt?: string;
  lastRefreshAt?: string;
  tokenExpiresAt?: string;
  refreshWindowMinutes?: number;
  endpointUrl?: string;
  apiBaseUrl?: string;
  displayLabel?: string;
  externalAccountId?: string;
  scopes?: string[];
  errorMessage?: string;
  metadata?: Record<string, string>;
  credentialCiphertext?: string;
}

export interface IntegrationProviderView {
  id: IntegrationProviderId;
  name: string;
  shortName: string;
  category: IntegrationCategory;
  authMode: IntegrationAuthMode;
  description: string;
  highlight: string;
  connectionLabel: string;
  status: IntegrationStatus;
  statusDetail: string;
  isConfigured: boolean;
  isConnected: boolean;
  allowsOAuth: boolean;
  supportsRefresh: boolean;
  supportsSync: boolean;
  /** True when this connection is shared by the whole team; false when each user connects their own. */
  isShared: boolean;
  connectedAt?: string;
  lastRefreshAt?: string;
  lastSyncAt?: string;
  lastSyncStatus?: "idle" | "running" | "completed" | "failed";
  lastSyncSummary?: string;
  lastSyncCount?: number;
  tokenExpiresAt?: string;
  apiBaseUrl?: string;
  endpointUrl?: string;
  displayLabel?: string;
  fields: IntegrationFieldDefinition[];
  capabilities: string[];
}
