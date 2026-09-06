import {
  IntegrationConnectionV1,
  SEO_INTEGRATION_CATALOG,
  getProviderDef,
  type IntegrationField,
} from "@/src/lib/domain/integration";
import { decryptJson, encryptJson } from "@/src/lib/server/crypto";
import { nowIso } from "@/src/lib/ids";
import { getIntegrationRepo } from "@/src/lib/server/repositories/integration-repo";
import { validateIntegration } from "@/src/lib/server/integrations-validate";

/** Secret-free view for the Integrations UI. */
export interface IntegrationView {
  id: string;
  name: string;
  category: string;
  authMode: "api_key" | "oauth";
  syncable: boolean;
  connectable: boolean;
  poweredBy?: string;
  description: string;
  fields: IntegrationField[];
  status: "not_connected" | "connected" | "error";
  connectedAt?: string;
  metadata: Record<string, string>;
  errorMessage?: string;
}

export async function listIntegrations(tenantId: string): Promise<IntegrationView[]> {
  const connections = await getIntegrationRepo().list(tenantId);
  const byId = new Map(connections.map((c) => [c.providerId, c]));
  return SEO_INTEGRATION_CATALOG.map((def) => {
    const conn = byId.get(def.id);
    let status = conn?.status ?? "not_connected";
    let connectedAt = conn?.connectedAt;
    // A "powered by" provider (e.g. Map Check-Ins) has no connection of its own —
    // it inherits the status of the provider that powers it (e.g. Rank Tracker).
    if (def.poweredBy && status !== "connected") {
      const powering = byId.get(def.poweredBy);
      if (powering?.status === "connected") {
        status = "connected";
        connectedAt = powering.connectedAt;
      }
    }
    return {
      id: def.id,
      name: def.name,
      category: def.category,
      authMode: def.authMode,
      syncable: def.syncable,
      connectable: def.authMode === "api_key" && !def.poweredBy,
      poweredBy: def.poweredBy,
      description: def.description,
      fields: def.fields,
      status,
      connectedAt,
      metadata: conn?.metadata ?? {},
      errorMessage: conn?.errorMessage,
    };
  });
}

export class ConnectError extends Error {}

export async function connectIntegration(
  tenantId: string,
  providerId: string,
  values: Record<string, string>,
  userId: string,
): Promise<IntegrationConnectionV1> {
  const def = getProviderDef(providerId);
  if (!def) throw new ConnectError(`Unknown provider: ${providerId}`);
  if (def.poweredBy) {
    throw new ConnectError(`${def.name} is powered by the ${def.poweredBy} connection.`);
  }
  if (def.authMode !== "api_key") {
    throw new ConnectError(`${def.name} requires OAuth; the credential form is not available.`);
  }

  const credentials: Record<string, string> = {};
  const metadata: Record<string, string> = {};
  for (const field of def.fields) {
    const raw = (values[field.key] ?? "").trim();
    if (field.required && !raw) {
      throw new ConnectError(`${field.label} is required.`);
    }
    if (!raw) continue;
    credentials[field.key] = raw;
    metadata[field.key] = field.secret ? "•••• set" : raw;
  }

  // Verify the credential before saving — a definitive auth rejection blocks it.
  const validation = await validateIntegration(providerId, credentials);
  if (validation.blocked) {
    throw new ConnectError(validation.message ?? `${def.name} rejected the credentials.`);
  }
  if (validation.message) metadata.validation = validation.message;

  const now = nowIso();
  const conn = IntegrationConnectionV1.parse({
    schemaVersion: 1,
    tenantId,
    providerId,
    status: "connected",
    authMode: def.authMode,
    credentialCiphertext: encryptJson(credentials),
    metadata,
    connectedByUserId: userId,
    connectedAt: now,
    updatedAt: now,
  });
  return getIntegrationRepo().save(conn);
}

export async function disconnectIntegration(tenantId: string, providerId: string): Promise<void> {
  await getIntegrationRepo().remove(tenantId, providerId);
}

/** Server-only: decrypt a connected provider's credentials for an adapter. */
export async function getIntegrationCredentials(
  tenantId: string,
  providerId: string,
): Promise<Record<string, string> | null> {
  const conn = await getIntegrationRepo().get(tenantId, providerId);
  if (!conn || conn.status !== "connected" || !conn.credentialCiphertext) return null;
  try {
    return decryptJson<Record<string, string>>(conn.credentialCiphertext);
  } catch {
    return null;
  }
}
