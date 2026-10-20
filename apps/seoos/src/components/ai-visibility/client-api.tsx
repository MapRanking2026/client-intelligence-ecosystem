"use client";

/** JSON fetch helper for AI-visibility client components. */
export async function callApi<T = unknown>(url: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; data?: T; error?: string; problems?: string[]; raw?: Record<string, unknown> }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const issues = Array.isArray(json.issues) ? (json.issues as string[]) : undefined;
      return { ok: false, status: res.status, error: String(json.error ?? `Request failed (${res.status})`), problems: (json.problems as string[]) ?? issues, raw: json };
    }
    return { ok: true, status: res.status, data: json.data as T, raw: json };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "Network error" };
  }
}

export function Msg({ msg }: { msg: { kind: "ok" | "error"; text: string; problems?: string[] } | null }) {
  if (!msg) return null;
  return (
    <div className={`aiv-msg ${msg.kind === "error" ? "aiv-msg--error" : "aiv-msg--ok"}`} role={msg.kind === "error" ? "alert" : "status"}>
      {msg.text}
      {msg.problems?.length ? (
        <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
          {msg.problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
