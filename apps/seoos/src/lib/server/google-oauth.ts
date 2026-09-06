import { createHmac, timingSafeEqual } from "node:crypto";

import { getServerEnv } from "@/src/lib/server/env";

/** Google OAuth for the two Google integrations. One app, per-provider scopes. */
export const GOOGLE_SCOPES: Record<string, string> = {
  "google-business-profile": "https://www.googleapis.com/auth/business.manage",
  "google-search-console": "https://www.googleapis.com/auth/webmasters.readonly",
  "google-drive": "https://www.googleapis.com/auth/drive.readonly",
};

export function isGoogleOAuthProvider(providerId: string): boolean {
  return providerId in GOOGLE_SCOPES;
}

export function redirectUri(): string {
  const base = getServerEnv().appUrl.replace(/\/$/, "");
  return `${base}/api/seo/integrations/google/callback`;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** Sign the OAuth state (provider + timestamp) so the callback can trust it. */
export function signState(providerId: string): string {
  const secret = getServerEnv().sessionCookieSecret;
  const payload = b64url(JSON.stringify({ p: providerId, t: Date.now() }));
  const sig = b64url(createHmac("sha256", secret).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyState(state: string): { providerId: string } | null {
  const secret = getServerEnv().sessionCookieSecret;
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const expected = b64url(createHmac("sha256", secret).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { p, t } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { p: string; t: number };
    if (!isGoogleOAuthProvider(p)) return null;
    if (Date.now() - t > 10 * 60 * 1000) return null; // 10-minute window
    return { providerId: p };
  } catch {
    return null;
  }
}

export function buildAuthUrl(providerId: string): string {
  const env = getServerEnv();
  const params = new URLSearchParams({
    client_id: env.googleOAuthClientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: `openid email ${GOOGLE_SCOPES[providerId]}`,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: signState(providerId),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface GoogleTokens {
  refreshToken?: string;
  accessToken: string;
  scope?: string;
  expiresAt?: string;
}

/** Exchange a stored refresh token for a fresh access token. */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const env = getServerEnv();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.googleOAuthClientId,
      client_secret: env.googleOAuthClientSecret,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || `refresh_failed_${res.status}`);
  }
  return body.access_token;
}

export async function exchangeCode(code: string): Promise<GoogleTokens> {
  const env = getServerEnv();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.googleOAuthClientId,
      client_secret: env.googleOAuthClientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || `token_exchange_failed_${res.status}`);
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    scope: body.scope,
    expiresAt: body.expires_in
      ? new Date(Date.now() + body.expires_in * 1000).toISOString()
      : undefined,
  };
}
