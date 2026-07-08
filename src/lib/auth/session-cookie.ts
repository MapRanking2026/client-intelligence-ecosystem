import { SignJWT, jwtVerify } from "jose";

import type { TenantContext, Role } from "@/src/lib/contracts/mtos";
import { getServerEnv } from "@/src/lib/server/env";

type SessionPayload = {
  tenantId: string;
  userId: string;
  role: Role;
};

function getCookieValue(cookieHeader: string, cookieName: string) {
  const parts = cookieHeader.split(";").map((part) => part.trim());
  const raw = parts.find((part) => part.startsWith(`${cookieName}=`));
  if (!raw) {
    return null;
  }
  return raw.slice(cookieName.length + 1);
}

export async function tryGetSessionFromRequest(request: Request): Promise<TenantContext | null> {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  const env = getServerEnv();
  const token = getCookieValue(cookieHeader, env.sessionCookieName);
  if (!token) {
    return null;
  }
  return tryGetSessionFromToken(token);
}

export async function tryGetSessionFromToken(token: string): Promise<TenantContext | null> {
  const env = getServerEnv();
  if (!env.sessionCookieSecret) {
    return null;
  }

  try {
    const secret = new TextEncoder().encode(env.sessionCookieSecret);
    const { payload } = await jwtVerify(token, secret);

    const tenantId = payload.tenantId;
    const userId = payload.userId;
    const role = payload.role;

    if (typeof tenantId !== "string" || typeof userId !== "string" || typeof role !== "string") {
      return null;
    }

    return {
      tenantId,
      userId,
      role: role as SessionPayload["role"],
    };
  } catch {
    return null;
  }
}

export async function tryGetSessionFromNextCookies(): Promise<TenantContext | null> {
  const env = getServerEnv();
  if (!env.sessionCookieSecret) {
    return null;
  }

  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const token = cookieStore.get(env.sessionCookieName)?.value;
    if (!token) {
      return null;
    }
    return tryGetSessionFromToken(token);
  } catch {
    return null;
  }
}

export async function createSessionToken(payload: SessionPayload) {
  const env = getServerEnv();
  if (!env.sessionCookieSecret) {
    throw new Error("SESSION_COOKIE_SECRET is required");
  }

  const secret = new TextEncoder().encode(env.sessionCookieSecret);
  const token = await new SignJWT({
    tenantId: payload.tenantId,
    userId: payload.userId,
    role: payload.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);

  return token;
}
