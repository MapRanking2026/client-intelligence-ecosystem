import {
  GatewayRequestV1,
  GatewayResponseV1,
  ProviderHealthV1,
  type DataGapV1,
  type GatewayResource,
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
    const json = await res.json().catch(() => null);
    const parsed = GatewayResponseV1.safeParse(json);
    if (!res.ok || !parsed.success) {
      return {
        configured: true,
        ok: false,
        dataGaps: [],
        freshness: "unknown",
        error: parsed.success ? parsed.data.error : `gateway_http_${res.status}`,
      };
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
