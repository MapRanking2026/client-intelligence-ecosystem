import { AivHttpError } from "@/src/lib/server/ai-visibility/access";
import { evidenceFiles } from "@/src/lib/server/ai-visibility/store";
import { AIV_PERMS, withProject } from "@/src/lib/server/ai-visibility/route-helpers";

type P = { params: Promise<{ projectId: string; fileId: string }> };

/** Serve a manual-observation screenshot to authorized viewers only. */
export async function GET(request: Request, { params }: P) {
  const { fileId } = await params;
  return withProject(request, params, AIV_PERMS.read, async ({ authz, project }) => {
    const f = await evidenceFiles().get(authz.tenantId, fileId);
    if (!f || f.projectId !== project.id) throw new AivHttpError(404, "Not found");
    return new Response(Buffer.from(f.dataBase64, "base64"), {
      headers: {
        "content-type": f.mimeType,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'",
      },
    });
  });
}
