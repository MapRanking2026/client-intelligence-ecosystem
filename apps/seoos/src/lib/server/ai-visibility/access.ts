import { NextResponse } from "next/server";
import { AuthzError, requirePermission } from "@cie/core";
import type { AuthzContextV1, PermissionScope } from "@cie/contracts";
import { ZodError } from "zod";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import type { SeoProjectV1 } from "@/src/lib/domain/project";
import { listProjectsForViewer } from "@/src/lib/server/projects-service";

/**
 * Server-side authorization for every AI-visibility page, API, export and
 * evidence view. A project is accessible only if it is in the viewer's
 * `listProjectsForViewer` set (ADR-0001 invariant) AND the viewer holds the
 * required permission. Inaccessible projects return 404 so existence is not
 * leaked across clients.
 */

export const AIV_PERMS = {
  read: "seo.package.read",
  manage: "seo.project.manage",
  providers: "integrations.manage",
} as const satisfies Record<string, PermissionScope>;

export class AivHttpError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
  }
}

export async function requireAuthz(request?: Request): Promise<AuthzContextV1> {
  const authz = await resolveSeoAuthz(request);
  if (!authz) throw new AivHttpError(401, "Unauthorized");
  return authz;
}

export async function requireProjectAccess(
  authz: AuthzContextV1,
  projectId: string,
  permission: PermissionScope = AIV_PERMS.read,
): Promise<SeoProjectV1> {
  requirePermission(authz.permissions, permission);
  const visible = await listProjectsForViewer(authz);
  const project = visible.find((p) => p.id === projectId);
  if (!project) throw new AivHttpError(404, "Client not found");
  return project;
}

export function hasPerm(authz: AuthzContextV1, p: PermissionScope): boolean {
  return authz.permissions.includes(p);
}

export function apiError(e: unknown): NextResponse {
  if (e instanceof AivHttpError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
  if (e instanceof AuthzError) return NextResponse.json({ error: "Forbidden", code: e.code }, { status: 403 });
  if (e instanceof ZodError) {
    return NextResponse.json({ error: "Invalid input", issues: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  }
  const msg = e instanceof Error ? e.message : "Failed";
  console.error("[aiv] request failed:", msg);
  return NextResponse.json({ error: msg }, { status: 400 });
}

/** Constant-time check of the CRON_SECRET bearer token for cron/worker routes. */
export function verifyCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (auth.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < auth.length; i += 1) diff |= auth.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
