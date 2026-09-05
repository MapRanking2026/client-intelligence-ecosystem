import { NextResponse } from "next/server";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { assignPodSpecialist, listPods } from "@/src/lib/server/pods-service";
import { getUserRepo } from "@/src/lib/server/repositories/user-repo";

function requireAdmin(authz: { clientVisibility: unknown } | null) {
  return !!authz && authz.clientVisibility === "all";
}

/** List pods + assignable specialists (admin only). */
export async function GET(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!requireAdmin(authz)) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const [pods, users] = await Promise.all([
    listPods(authz.tenantId),
    getUserRepo().list(authz.tenantId),
  ]);
  return NextResponse.json({
    data: {
      pods,
      users: users
        .filter((u) => !u.disabled)
        .map((u) => ({ userId: u.userId, email: u.email, displayName: u.displayName ?? u.email })),
    },
  });
}

/** Assign (or clear) a pod's specialist (admin only). Body: {podKey, specialistUserId|null}. */
export async function POST(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!requireAdmin(authz)) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as
    | { podKey?: string; specialistUserId?: string | null }
    | null;
  if (!body?.podKey) return NextResponse.json({ error: "podKey is required" }, { status: 400 });

  const pod = await assignPodSpecialist(
    authz.tenantId,
    body.podKey,
    body.specialistUserId ? body.specialistUserId : null,
  );
  return NextResponse.json({ data: pod });
}
