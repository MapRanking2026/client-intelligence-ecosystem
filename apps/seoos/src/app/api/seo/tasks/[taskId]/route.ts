import { NextResponse } from "next/server";
import { AuthzError, requirePermission } from "@cie/core";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import {
  decidePreparedTask,
  draftPreparedTask,
  getTaskForViewer,
  type TaskDecision,
} from "@/src/lib/server/task-drafting-service";

/** One prepared task, scoped to the viewer's client access. */
export async function GET(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.package.read");
    const { taskId } = await params;
    const task = await getTaskForViewer(authz, taskId);
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ data: task });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Failed" }, { status: 400 });
  }
}

/**
 * Act on a task. Body: { action: "draft" | "approve" | "reject" | "needs_info" |
 * "save" | "skip", note?, draft? }. Drafting stages the deliverable in SEOOS;
 * decisions record the specialist's call — nothing is pushed live here.
 */
export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const authz = await resolveSeoAuthz(request);
  if (!authz) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    requirePermission(authz.permissions, "seo.package.read");
    const { taskId } = await params;
    const task = await getTaskForViewer(authz, taskId);
    if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = (await request.json().catch(() => null)) as
      | { action?: string; note?: string; draft?: string }
      | null;
    const action = body?.action ?? "";

    if (action === "draft") {
      const res = await draftPreparedTask(authz.tenantId, taskId);
      if (!res.ok) return NextResponse.json({ error: res.error ?? "draft_failed" }, { status: 400 });
      return NextResponse.json({ data: await getTaskForViewer(authz, taskId) });
    }

    if (["approve", "reject", "needs_info", "save", "skip"].includes(action)) {
      const res = await decidePreparedTask(
        authz.tenantId,
        taskId,
        { action: action as TaskDecision, note: body?.note, draft: body?.draft },
        authz.userId,
      );
      if (!res.ok) return NextResponse.json({ error: res.error ?? "failed" }, { status: 400 });
      return NextResponse.json({ data: await getTaskForViewer(authz, taskId) });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: e.message }, { status: 403 });
    return NextResponse.json({ error: "Failed" }, { status: 400 });
  }
}
