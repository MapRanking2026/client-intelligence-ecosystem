/**
 * Service-to-service request signing for the Integration Gateway.
 *
 * HMAC-SHA256 over (timestamp · nonce · tenantId · rawBody), with a bounded
 * timestamp skew for replay protection. Pure: the secret and clock are passed
 * in, so this is deterministic and testable. Uses Web Crypto (available in Node
 * 20 and edge runtimes) — no node:crypto dependency, safe for any runtime.
 */

export const S2S_HEADERS = {
  timestamp: "x-cie-timestamp",
  nonce: "x-cie-nonce",
  tenant: "x-cie-tenant",
  signature: "x-cie-signature",
} as const;

/** Default replay window: reject requests whose timestamp skews > 5 minutes. */
export const DEFAULT_MAX_SKEW_MS = 5 * 60 * 1000;

function enc(s: string): Uint8Array<ArrayBuffer> {
  // Copy into a fresh ArrayBuffer-backed view so the type is BufferSource
  // (crypto.subtle rejects the generic Uint8Array<ArrayBufferLike>).
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out;
}

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function canonicalMessage(parts: {
  timestamp: string;
  nonce: string;
  tenantId: string;
  body: string;
}): string {
  return `${parts.timestamp}.${parts.nonce}.${parts.tenantId}.${parts.body}`;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc(message));
  return toHex(sig);
}

/** Length-safe constant-time comparison of two hex strings. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export interface SignedHeaders {
  [S2S_HEADERS.timestamp]: string;
  [S2S_HEADERS.nonce]: string;
  [S2S_HEADERS.tenant]: string;
  [S2S_HEADERS.signature]: string;
}

/** Sign a gateway request. Caller supplies timestamp/nonce (kept deterministic). */
export async function signGatewayRequest(
  secret: string,
  input: { tenantId: string; body: string; timestamp: number; nonce: string },
): Promise<SignedHeaders> {
  const timestamp = String(input.timestamp);
  const signature = await hmacHex(
    secret,
    canonicalMessage({ timestamp, nonce: input.nonce, tenantId: input.tenantId, body: input.body }),
  );
  return {
    [S2S_HEADERS.timestamp]: timestamp,
    [S2S_HEADERS.nonce]: input.nonce,
    [S2S_HEADERS.tenant]: input.tenantId,
    [S2S_HEADERS.signature]: signature,
  };
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "stale" | "tenant_mismatch" | "bad_signature" };

/** Verify an incoming gateway request against the shared secret. */
export async function verifyGatewayRequest(
  secret: string,
  input: {
    timestamp: string | null;
    nonce: string | null;
    tenantHeader: string | null;
    signature: string | null;
    body: string;
    expectedTenantId: string;
    nowMs: number;
    maxSkewMs?: number;
  },
): Promise<VerifyResult> {
  const { timestamp, nonce, tenantHeader, signature } = input;
  if (!timestamp || !nonce || !tenantHeader || !signature) {
    return { ok: false, reason: "missing" };
  }
  const ts = Number.parseInt(timestamp, 10);
  const skew = input.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
  if (Number.isNaN(ts) || Math.abs(input.nowMs - ts) > skew) {
    return { ok: false, reason: "stale" };
  }
  if (tenantHeader !== input.expectedTenantId) {
    return { ok: false, reason: "tenant_mismatch" };
  }
  const expected = await hmacHex(
    secret,
    canonicalMessage({ timestamp, nonce, tenantId: tenantHeader, body: input.body }),
  );
  return timingSafeEqualHex(expected, signature)
    ? { ok: true }
    : { ok: false, reason: "bad_signature" };
}
