import { NextResponse } from "next/server";
import { AuthzError, canAccessClient, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { getProject } from "@/src/lib/server/projects-service";
import { emailReport } from "@/src/lib/server/report-email";
import { EmailNotConfiguredError } from "@/src/lib/server/email";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Email a client's monthly report. Human-initiated: the admin supplies the recipient. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.project.manage");
    const { projectId } = await params;
    const project = await getProject(authz.tenantId, projectId);
    if (!project || !canAccessClient(authz.clientVisibility, project.clientId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const body = (await request.json().catch(() => null)) as { to?: string } | null;
    const to = (body?.to ?? "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      return NextResponse.json({ error: "A valid recipient email is required." }, { status: 400 });
    }
    const result = await emailReport(authz.tenantId, projectId, to);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ data: { sent: true, to } });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message, code: e.code }, { status: 403 });
    if (e instanceof EmailNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 400 });
  }
}
