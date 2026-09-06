import { getIntegrationCredentials } from "@/src/lib/server/integrations-service";
import { refreshAccessToken } from "@/src/lib/server/google-oauth";

/** Read Google Docs from a Drive folder (read-only). Best-effort; no fabrication. */
export interface DriveDoc {
  id: string;
  name: string;
  content: string;
}

export async function fetchDriveDocs(
  tenantId: string,
  folderId: string,
): Promise<{ ok: boolean; error?: string; docs: DriveDoc[] }> {
  if (!folderId.trim()) return { ok: false, error: "A Drive folder ID is required.", docs: [] };

  const creds = await getIntegrationCredentials(tenantId, "google-drive");
  if (!creds?.refreshToken) {
    return { ok: false, error: "Google Drive isn't connected. Connect it under Integrations.", docs: [] };
  }
  let token: string;
  try {
    token = await refreshAccessToken(creds.refreshToken);
  } catch (e) {
    return { ok: false, error: `Couldn't refresh the Google token: ${e instanceof Error ? e.message : "error"}.`, docs: [] };
  }

  const q = encodeURIComponent(
    `'${folderId}' in parents and mimeType='application/vnd.google-apps.document' and trashed=false`,
  );
  const listRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=50`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  const listBody = (await listRes.json().catch(() => ({}))) as {
    files?: Array<{ id: string; name: string }>;
    error?: { message?: string };
  };
  if (!listRes.ok) return { ok: false, error: listBody.error?.message || `Drive returned ${listRes.status}.`, docs: [] };

  const files = listBody.files ?? [];
  const docs: DriveDoc[] = [];
  for (const f of files.slice(0, 50)) {
    try {
      const exp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=text/plain`,
        { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
      );
      if (!exp.ok) continue;
      const text = (await exp.text()).slice(0, 12000);
      if (text.trim()) docs.push({ id: f.id, name: f.name, content: text });
    } catch {
      // skip a doc that fails to export
    }
  }
  return { ok: true, docs };
}
