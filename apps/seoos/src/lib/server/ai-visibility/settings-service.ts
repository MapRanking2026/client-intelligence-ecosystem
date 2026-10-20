import { nowIso } from "@/src/lib/ids";
import { priceFor } from "@/src/lib/ai-visibility/cost";
import {
  AivAgencySettingsV1,
  AivProviderSettingsV1,
  type ProviderId,
} from "@/src/lib/ai-visibility/types";
import { audit } from "./audit";
import { getAdapter, listAdapters } from "./providers/registry";
import { agencySettings, providerSettings } from "./store";

export async function getProviderSettings(tenantId: string, providerId: ProviderId): Promise<AivProviderSettingsV1> {
  const existing = await providerSettings().get(tenantId, providerId);
  if (existing) return existing;
  const a = getAdapter(providerId);
  return AivProviderSettingsV1.parse({
    schemaVersion: 1,
    tenantId,
    providerId,
    enabled: false,
    model: a.defaultModel || "n/a",
    updatedAt: nowIso(),
  });
}

export interface ProviderStatusRow {
  providerId: ProviderId;
  displayName: string;
  surfaceLabel: string;
  docsUrl: string;
  credential: { state: "configured" | "not_configured" | "unsupported"; detail: string };
  settings: AivProviderSettingsV1;
  priced: boolean;
  /** Usable for scans right now. */
  ready: boolean;
  readyReason: string;
  capabilities: ReturnType<typeof getAdapter>["capabilities"];
}

export async function listProviderStatus(tenantId: string): Promise<ProviderStatusRow[]> {
  return Promise.all(
    listAdapters().map(async (a) => {
      const settings = await getProviderSettings(tenantId, a.id);
      const credential = a.credentialStatus();
      const priced = Boolean(priceFor(a.id, settings.model));
      let readyReason = "Ready";
      if (credential.state === "unsupported") readyReason = `Unsupported — ${credential.detail}`;
      else if (credential.state === "not_configured") readyReason = `Not configured — ${credential.detail}`;
      else if (!settings.enabled) readyReason = "Disabled in settings";
      else if (!priced) readyReason = `No verified price for model ${settings.model}; cost caps cannot be enforced`;
      return {
        providerId: a.id,
        displayName: a.displayName,
        surfaceLabel: a.surfaceLabel,
        docsUrl: a.docsUrl,
        credential,
        settings,
        priced,
        ready: readyReason === "Ready",
        readyReason,
        capabilities: a.capabilities,
      };
    }),
  );
}

export async function saveProviderSettings(
  tenantId: string,
  providerId: ProviderId,
  patch: Partial<Pick<AivProviderSettingsV1, "enabled" | "model" | "maxSearchUses" | "maxOutputTokens" | "timeoutMs" | "requestsPerMinute" | "maxConcurrency">>,
  actor: string,
): Promise<AivProviderSettingsV1> {
  const cur = await getProviderSettings(tenantId, providerId);
  const next = AivProviderSettingsV1.parse({ ...cur, ...patch, updatedAt: nowIso(), updatedBy: actor });
  if (next.enabled && getAdapter(providerId).credentialStatus().state === "unsupported") {
    throw new Error("This provider is not supported yet and cannot be enabled.");
  }
  await providerSettings().set(tenantId, providerId, next);
  await audit(tenantId, actor, "provider.settings.update", { target: providerId, detail: { before: cur, after: next } });
  return next;
}

export async function testProvider(tenantId: string, providerId: ProviderId, actor: string) {
  const a = getAdapter(providerId);
  const settings = await getProviderSettings(tenantId, providerId);
  const result = await a.testConnection(settings.model);
  const next = { ...settings, lastTestAt: nowIso(), lastTestOk: result.ok, lastTestMessage: result.message.slice(0, 500) };
  await providerSettings().set(tenantId, providerId, AivProviderSettingsV1.parse(next));
  await audit(tenantId, actor, "provider.test", { target: providerId, detail: { ok: result.ok, message: result.message } });
  return result;
}

export async function getAgencySettings(tenantId: string): Promise<AivAgencySettingsV1> {
  return (
    (await agencySettings().get(tenantId, "agency")) ??
    AivAgencySettingsV1.parse({ schemaVersion: 1, tenantId, updatedAt: nowIso() })
  );
}

export async function saveAgencySettings(tenantId: string, monthlyAgencyCapUsd: number, actor: string) {
  const cur = await getAgencySettings(tenantId);
  const next = AivAgencySettingsV1.parse({ ...cur, monthlyAgencyCapUsd, updatedAt: nowIso(), updatedBy: actor });
  await agencySettings().set(tenantId, "agency", next);
  await audit(tenantId, actor, "agency.cap.update", { detail: { before: cur.monthlyAgencyCapUsd, after: monthlyAgencyCapUsd } });
  return next;
}
