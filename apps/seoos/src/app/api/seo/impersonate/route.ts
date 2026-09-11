import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerEnv } from "@/src/lib/server/env";
import { tryGetSessionFromRequest } from "@/src/lib/auth/session-cookie";
import { listSpecialists } from "@/src/lib/server/specialists-service";

/** The developer/super-admin who may impersonate specialists (userId). */
const SUPER_ADMIN_USER_ID = process.env.SEOOS_SUPERADMIN_USER_ID || "francisco";

export const dynamic = "force-dynamic";

const Body = z.union([
  z.object({ specialistId: z.string().min(1) }),
  z.object({ stop: z.literal(true) }),
]);

/**
 * Start/stop impersonating an SEO specialist. Gated to the super-admin: we read
 * the REAL session here (never the resolved authz), so an active impersonation
 * can't lock the super-admin out of stopping it.
 */
export async function POST(request: Request) {
  const env = getServerEnv();
  const session = await tryGetSessionFromRequest(request);
  const isSuperAdmin = env.useSeedData || session?.userId === SUPER_ADMIN_USER_ID;
  if (!isSuperAdmin) {
    return NextResponse.json({ error: "Only the developer account can impersonate." }, { status: 403 });
  }

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const data = parsed.data;

  if ("stop" in data) {
    const res = NextResponse.json({ ok: true, stopped: true });
    res.cookies.delete("seoos_impersonate");
    return res;
  }

  const tenantId = session?.tenantId ?? env.pilotTenantId;
  const specialists = await listSpecialists(tenantId);
  const target = specialists.find((s) => s.id === data.specialistId);
  if (!target) return NextResponse.json({ error: "Specialist not found" }, { status: 404 });

  const res = NextResponse.json({ ok: true, specialist: { id: target.id, name: target.name } });
  res.cookies.set("seoos_impersonate", target.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });
  return res;
}
