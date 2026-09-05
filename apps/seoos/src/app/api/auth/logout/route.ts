import { NextResponse } from "next/server";
import { getServerEnv } from "@/src/lib/server/env";

export async function POST() {
  const env = getServerEnv();
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(env.sessionCookieName);
  return res;
}
