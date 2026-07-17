import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { tryGetSessionFromToken } from "@/src/lib/auth/session-cookie";
import { getServerEnv } from "@/src/lib/server/env";

export async function proxy(request: NextRequest) {
  const env = getServerEnv();

  if (env.useSeedData) {
    return NextResponse.next();
  }

  const path = request.nextUrl.pathname;
  const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const isPublic =
    path === "/sign-in" ||
    path === "/login" ||
    path === "/sign-up" ||
    path.startsWith("/api/auth/session") ||
    path.startsWith("/api/auth/firebase-session") ||
    path.startsWith("/api/auth/firebase-signup") ||
    path.startsWith("/api/auth/logout") ||
    path.startsWith("/api/integrations/oauth/callback") ||
    path.startsWith("/api/integrations/clickup/callback") ||
    // Cron endpoints authenticate with CRON_SECRET, not a session cookie.
    path.startsWith("/api/cron/") ||
    path.startsWith("/_next") ||
    path.startsWith("/favicon");

  if (isPublic) {
    return NextResponse.next();
  }

  const token = request.cookies.get(env.sessionCookieName)?.value;
  if (!token) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", returnTo);
    return NextResponse.redirect(url);
  }

  const session = await tryGetSessionFromToken(token);
  if (!session) {
    if (path.startsWith("/api/")) {
      const response = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      response.cookies.delete(env.sessionCookieName);
      return response;
    }

    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", returnTo);

    const response = NextResponse.redirect(url);
    response.cookies.delete(env.sessionCookieName);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
