/**
 * ClickUp task-comment reader for SEOOS style seeding.
 *
 * READ-ONLY (personal API token, Authorization header, no Bearer). We fetch the
 * comments a task carries so we can learn how each specialist actually writes,
 * from their own words. Nothing is written back to ClickUp; the token and raw
 * payload never leave this module.
 */
const BASE = "https://api.clickup.com/api/v2";

export interface TaskComment {
  taskId: string;
  text: string;
  authorName?: string;
  authorEmail?: string;
  /** ClickUp epoch-millis string. */
  date?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch one task's comments. Tolerant by design: a task that 404s, is archived,
 * or rate-limits does not fail the whole seeding run — it just yields no
 * comments. Retries once on a 429.
 */
export async function fetchTaskComments(token: string, taskId: string): Promise<TaskComment[]> {
  if (!token || !taskId) return [];
  const url = `${BASE}/task/${taskId}/comment`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: token, "content-type": "application/json" },
        cache: "no-store",
      });
    } catch {
      return [];
    }
    if (res.status === 429 && attempt === 0) {
      await sleep(2000);
      continue;
    }
    if (!res.ok) return [];
    let body: { comments?: unknown };
    try {
      body = (await res.json()) as { comments?: unknown };
    } catch {
      return [];
    }
    const comments = Array.isArray(body.comments) ? body.comments : [];
    return comments
      .map((raw) => {
        const c = (raw ?? {}) as {
          comment_text?: string;
          user?: { username?: string; email?: string };
          date?: string;
        };
        const user = c.user ?? {};
        return {
          taskId,
          text: (c.comment_text ?? "").trim(),
          authorName: user.username,
          authorEmail: user.email,
          date: c.date,
        };
      })
      .filter((c) => c.text.length > 0);
  }
  return [];
}
