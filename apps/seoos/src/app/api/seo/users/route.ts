import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { AuthzContextV1 } from "@cie/contracts";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { getUserRepo } from "@/src/lib/server/repositories/user-repo";
import { hashPassword } from "@/src/lib/server/password";
import { SeoUserV1 } from "@/src/lib/domain/user";

function adminGuard(authz: AuthzContextV1) {
  requirePermission(authz.permissions, "settings.manage");
  if (authz.clientVisibility !== "all") throw new AuthzError("forbidden_permission", "Admin only");
}

export const dynamic = "force-dynamic";

function sanitizeId(email: string): string {
  return email.split("@")[0].replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "user";
}
function tempPassword(): string {
  return randomBytes(9).toString("base64url"); // ~12 chars, ≥ the 8-char minimum
}

/** Admin: list SEOOS login users. */
export async function GET(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    adminGuard(authz);
    const users = await getUserRepo().list(authz.tenantId);
    const data = users.map((u) => ({
      userId: u.userId,
      email: u.email,
      displayName: u.displayName ?? "",
      isAdmin: u.clientVisibility === "all" || u.roles.includes("tenant_admin"),
      disabled: u.disabled,
      mustResetPassword: u.mustResetPassword === true,
    }));
    return NextResponse.json({ data });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    email: z.string().email(),
    displayName: z.string().min(1),
    admin: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("update"),
    userId: z.string().min(1),
    displayName: z.string().optional(),
    makeAdmin: z.boolean().optional(),
    forceReset: z.boolean().optional(),
    disabled: z.boolean().optional(),
  }),
]);

/** Admin: create a user (returns a one-time temp password), or update one. */
export async function POST(request: Request) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    adminGuard(authz);
    const repo = getUserRepo();
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    }
    const now = new Date().toISOString();

    if (parsed.data.action === "create") {
      const { email, displayName, admin } = parsed.data;
      if (await repo.getByEmail(authz.tenantId, email)) {
        return NextResponse.json({ error: "A user with that email already exists." }, { status: 409 });
      }
      let userId = sanitizeId(email);
      if (await repo.getById(authz.tenantId, userId)) userId = `${userId}_${Date.now().toString(36).slice(-4)}`;
      const temp = tempPassword();
      const { salt, hash } = hashPassword(temp);
      await repo.save(
        SeoUserV1.parse({
          schemaVersion: 1,
          tenantId: authz.tenantId,
          userId,
          email: email.trim().toLowerCase(),
          displayName,
          passwordSalt: salt,
          passwordHash: hash,
          roles: [admin ? "tenant_admin" : "seo_specialist"],
          clientVisibility: admin ? "all" : [],
          disabled: false,
          mustResetPassword: true,
          createdAt: now,
          updatedAt: now,
        }),
      );
      return NextResponse.json({ data: { userId, email: email.trim().toLowerCase(), tempPassword: temp } });
    }

    const { userId, displayName, makeAdmin, forceReset, disabled } = parsed.data;
    const user = await repo.getById(authz.tenantId, userId);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const next = { ...user, updatedAt: now };
    if (typeof displayName === "string" && displayName.trim()) next.displayName = displayName.trim();
    if (makeAdmin) {
      next.roles = ["tenant_admin"];
      next.clientVisibility = "all";
    }
    if (typeof disabled === "boolean") next.disabled = disabled;
    if (forceReset) next.mustResetPassword = true;
    await repo.save(SeoUserV1.parse(next));
    return NextResponse.json({ data: { userId, ok: true } });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
