import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { tryGetSessionFromToken } from "@/src/lib/auth/session-cookie";
import { getServerEnv } from "@/src/lib/server/env";

/**
 * Route protection (Next 16 middleware). Mirrors MTOS: seed mode bypasses; the
 * shared session cookie is required otherwise. Per-route permission/membership
 * checks happen in the pages/handlers (this only enforces authentication).
 */
export async function proxy(request: NextRequest) {
  const env = getServerEnv();
  if (env.useSeedData) return NextResponse.next();

  const path = request.nextUrl.pathname;
  const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const isPublic =
    path === "/sign-in" ||
    path.startsWith("/api/auth/login") ||
    path.startsWith("/api/auth/signup") ||
    path.startsWith("/api/auth/logout") ||
    path.startsWith("/api/health") ||
    path.startsWith("/_next") ||
    path.startsWith("/favicon");

  if (isPublic) return NextResponse.next();

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
      const res = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      res.cookies.delete(env.sessionCookieName);
      return res;
    }
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.searchParams.set("next", returnTo);
    const res = NextResponse.redirect(url);
    res.cookies.delete(env.sessionCookieName);
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
