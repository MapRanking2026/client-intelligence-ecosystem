import { NextResponse } from "next/server";

import { getServerEnv } from "@/src/lib/server/env";

export async function POST() {
  const env = getServerEnv();
  const response = NextResponse.json({ ok: true });

  response.cookies.set(env.sessionCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: env.appEnv !== "development",
    path: "/",
    maxAge: 0,
  });

  return response;
}

