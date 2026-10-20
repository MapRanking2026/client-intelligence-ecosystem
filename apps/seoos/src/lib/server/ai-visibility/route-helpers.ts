import type { AuthzContextV1, PermissionScope } from "@cie/contracts";

import type { SeoProjectV1 } from "@/src/lib/domain/project";
import type { AivProfileV1 } from "@/src/lib/ai-visibility/types";
import { AIV_PERMS, AivHttpError, apiError, requireAuthz, requireProjectAccess } from "./access";
import { getProfile } from "./profile-service";

export interface ProjectCtx {
  authz: AuthzContextV1;
  project: SeoProjectV1;
  actor: string;
}

/** Resolve authn + permission + project visibility, then run the handler. */
export async function withProject(
  request: Request,
  params: Promise<{ projectId: string }>,
  permission: PermissionScope,
  fn: (ctx: ProjectCtx) => Promise<Response>,
): Promise<Response> {
  try {
    const authz = await requireAuthz(request);
    const { projectId } = await params;
    const project = await requireProjectAccess(authz, projectId, permission);
    return await fn({ authz, project, actor: authz.userId });
  } catch (e) {
    return apiError(e);
  }
}

export async function requireProfile(ctx: ProjectCtx): Promise<AivProfileV1> {
  const p = await getProfile(ctx.authz.tenantId, ctx.project.id);
  if (!p) throw new AivHttpError(404, "AI visibility is not set up for this client yet");
  return p;
}

export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) throw new AivHttpError(415, "Expected application/json");
  const body = (await request.json().catch(() => null)) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AivHttpError(400, "Invalid JSON body");
  return body as Record<string, unknown>;
}

export { AIV_PERMS };
