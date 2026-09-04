import { jwtVerify } from "jose";

import { getServerEnv } from "@/src/lib/server/env";

/**
 * Session verification, identical to MTOS: a JWT signed with the shared
 * SESSION_COOKIE_SECRET carrying { tenantId, userId, role }. SEOOS only VERIFIES
 * (MTOS issues the session at sign-in); the same token validates in both apps.
 */
export interface SessionPayload {
  tenantId: string;
  userId: string;
  role: string;
}

function getCookieValue(cookieHeader: string, cookieName: string) {
  const parts = cookieHeader.split(";").map((part) => part.trim());
  const raw = parts.find((part) => part.startsWith(`${cookieName}=`));
  return raw ? raw.slice(cookieName.length + 1) : null;
}

export async function tryGetSessionFromToken(
  token: string,
): Promise<SessionPayload | null> {
  const env = getServerEnv();
  if (!env.sessionCookieSecret) return null;
  try {
    const secret = new TextEncoder().encode(env.sessionCookieSecret);
    const { payload } = await jwtVerify(token, secret);
    const { tenantId, userId, role } = payload as Record<string, unknown>;
    if (
      typeof tenantId !== "string" ||
      typeof userId !== "string" ||
      typeof role !== "string"
    ) {
      return null;
    }
    return { tenantId, userId, role };
  } catch {
    return null;
  }
}

export async function tryGetSessionFromRequest(
  request: Request,
): Promise<SessionPayload | null> {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  const env = getServerEnv();
  const token = getCookieValue(cookieHeader, env.sessionCookieName);
  return token ? tryGetSessionFromToken(token) : null;
}

export async function tryGetSessionFromNextCookies(): Promise<SessionPayload | null> {
  const env = getServerEnv();
  if (!env.sessionCookieSecret) return null;
  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const token = cookieStore.get(env.sessionCookieName)?.value;
    return token ? tryGetSessionFromToken(token) : null;
  } catch {
    return null;
  }
}
