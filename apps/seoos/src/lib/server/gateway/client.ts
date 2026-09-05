import {
  CanonicalClientV1,
  GatewayRequestV1,
  GatewayResponseV1,
  MapCheckinActivityV1,
  ProviderHealthV1,
  type CanonicalClientV1 as CanonicalClient,
  type DataGapV1,
  type GatewayResource,
  type MapCheckinActivityV1 as MapCheckinActivity,
  type OutboxEventV1,
} from "@cie/contracts";
import { z } from "zod";
import { signGatewayRequest } from "@cie/core";

import { getServerEnv } from "@/src/lib/server/env";
import { newId, nowIso } from "@/src/lib/ids";

/**
 * SEOOS-side Integration Gateway client. Signs every request (HMAC S2S) and
 * calls the MTOS gateway to consume the shared connections. When the gateway
 * is not configured (no URL/secret) it returns a structured "not configured"
 * result — an honest data gap, never fabricated data.
 */
export interface GatewayCallResult {
  configured: boolean;
  ok: boolean;
  data?: unknown;
  dataGaps: DataGapV1[];
  freshness: string;
  error?: string;
}

async function callGateway(
  resource: GatewayResource,
  tenantId: string,
  params: Record<string, unknown> = {},
): Promise<GatewayCallResult> {
  const env = getServerEnv();
  if (!env.integrationGatewayUrl || !env.serviceToServiceSecret) {
    return {
      configured: false,
      ok: false,
      dataGaps: [],
      freshness: "unknown",
      error: "gateway_not_configured",
    };
  }

  const request = GatewayRequestV1.parse({
    schemaVersion: 1,
    resource,
    tenantId,
    params,
    correlationId: newId("corr"),
    issuedAt: nowIso(),
  });
  const body = JSON.stringify(request);
  const headers = await signGatewayRequest(env.serviceToServiceSecret, {
    tenantId,
    body,
    timestamp: Date.now(),
    nonce: newId("nonce"),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${env.integrationGatewayUrl}/api/gateway/data`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body,
      signal: controller.signal,
      cache: "no-store",
    });
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      // Surface the MTOS-side reason (e.g. bad_signature / stale / tenant_mismatch).
      const detail =
        json && typeof json === "object"
          ? ((json as Record<string, unknown>).reason ?? (json as Record<string, unknown>).error)
          : null;
      return {
        configured: true,
        ok: false,
        dataGaps: [],
        freshness: "unknown",
        error: detail ? `gateway_http_${res.status}: ${String(detail)}` : `gateway_http_${res.status}`,
      };
    }
    const parsed = GatewayResponseV1.safeParse(json);
    if (!parsed.success) {
      return { configured: true, ok: false, dataGaps: [], freshness: "unknown", error: "invalid_gateway_payload" };
    }
    return {
      configured: true,
      ok: parsed.data.ok,
      data: parsed.data.data,
      dataGaps: parsed.data.dataGaps,
      freshness: parsed.data.freshness,
      error: parsed.data.error,
    };
  } catch (e) {
    return {
      configured: true,
      ok: false,
      dataGaps: [],
      freshness: "unknown",
      error: e instanceof Error ? e.message : "gateway_unreachable",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export interface IntegrationHealthResult {
  configured: boolean;
  ok: boolean;
  providers: ProviderHealthV1[];
  error?: string;
}

/** Fetch secret-free provider health from the shared MTOS connections. */
export async function getIntegrationHealth(
  tenantId: string,
): Promise<IntegrationHealthResult> {
  const result = await callGateway("integration-health", tenantId);
  if (!result.ok) {
    return { configured: result.configured, ok: false, providers: [], error: result.error };
  }
  const providers = z.array(ProviderHealthV1).safeParse(result.data);
  return {
    configured: true,
    ok: providers.success,
    providers: providers.success ? providers.data : [],
    error: providers.success ? undefined : "invalid_gateway_payload",
  };
}

/** Deliver an outbox event (e.g. SeoPackageReady) to the MTOS receiver. */
export async function deliverToMtos(
  event: OutboxEventV1,
): Promise<{ ok: boolean; error?: string }> {
  const env = getServerEnv();
  if (!env.integrationGatewayUrl || !env.serviceToServiceSecret) {
    return { ok: false, error: "gateway_not_configured" };
  }
  const body = JSON.stringify(event);
  const headers = await signGatewayRequest(env.serviceToServiceSecret, {
    tenantId: event.tenantId,
    body,
    timestamp: Date.now(),
    nonce: newId("nonce"),
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${env.integrationGatewayUrl}/api/gateway/deliver`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: `deliver_http_${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "deliver_unreachable" };
  } finally {
    clearTimeout(timeout);
  }
}

export interface ClientsResult {
  configured: boolean;
  ok: boolean;
  clients: CanonicalClient[];
  error?: string;
}

/** The canonical client roster from MTOS (source of client truth). */
export async function getMtosClients(tenantId: string): Promise<ClientsResult> {
  const result = await callGateway("clients.list", tenantId);
  if (!result.ok) {
    return { configured: result.configured, ok: false, clients: [], error: result.error };
  }
  const parsed = z.array(CanonicalClientV1).safeParse(result.data);
  return {
    configured: true,
    ok: parsed.success,
    clients: parsed.success ? parsed.data : [],
    error: parsed.success ? undefined : "invalid_gateway_payload",
  };
}

export interface MapCheckinResult {
  configured: boolean;
  ok: boolean;
  activity: MapCheckinActivity | null;
  dataGaps: DataGapV1[];
  error?: string;
}

/** Map Check-In activity from the shared tenant-wide MTOS connection. */
export async function getMapCheckinActivity(
  tenantId: string,
): Promise<MapCheckinResult> {
  const result = await callGateway("map-checkins.activity", tenantId);
  if (!result.ok) {
    return {
      configured: result.configured,
      ok: false,
      activity: null,
      dataGaps: result.dataGaps,
      error: result.error,
    };
  }
  const parsed = MapCheckinActivityV1.safeParse(result.data);
  return {
    configured: true,
    ok: parsed.success,
    activity: parsed.success ? parsed.data : null,
    dataGaps: result.dataGaps,
    error: parsed.success ? undefined : "invalid_gateway_payload",
  };
}
