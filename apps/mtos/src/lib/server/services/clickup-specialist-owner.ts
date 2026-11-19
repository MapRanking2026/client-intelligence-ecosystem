import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getIntegrationConnection, getIntegrationCredentials } from "@/src/lib/server/integrations";

interface DashboardTask { id: string; name: string; parent?: string | null; assignees?: { id: number; username?: string }[]; }
const normalize = (name: string) => name.toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Exact client-project matches only; location-specific accounts must not inherit another location's owner. */
export function dashboardOwner(tasks: DashboardTask[], clientName: string) {
  const exact = tasks.filter(task => !task.parent && normalize(task.name) === normalize(clientName));
  const matches = exact.length ? exact : tasks.filter(task => !task.parent && normalize(task.name).startsWith(normalize(clientName) + " "));
  if (!matches.length || (!exact.length && matches.length < 2)) return;
  const owners = new Map(matches.flatMap(task => (task.assignees || []).map(owner => [owner.id, owner] as const)));
  if (owners.size !== 1 || matches.some(task => !task.assignees?.length)) return;
  const owner = [...owners.values()][0];
  if (!owner.username?.trim()) return;
  return { name: owner.username.trim(), source: "SEO account assignee in ClickUp: https://app.clickup.com/t/" + matches[0].id };
}

export async function readSeoDashboardOwner(context: TenantContext, clientName: string) {
  try {
    const connection = await getIntegrationConnection(context, "clickup");
    if (connection?.status !== "connected") return;
    const token = getIntegrationCredentials(connection).accessToken;
    if (!token) return;
    // The SEO Dashboard supplied by this workspace's owner; overridable for another installation.
    const listId = process.env.CLICKUP_SEO_DASHBOARD_LIST_ID || "901112026952";
    const tasks: DashboardTask[] = [];
    for (let page = 0; page < 20; page++) {
      const response = await fetch(`https://api.clickup.com/api/v2/list/${encodeURIComponent(listId)}/task?subtasks=false&include_closed=false&include_timl=true&page=${page}`, {
        headers: { authorization: token, accept: "application/json" }, signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return;
      const data = await response.json() as { tasks?: DashboardTask[]; last_page?: boolean };
      if (!Array.isArray(data.tasks)) return;
      tasks.push(...data.tasks);
      if (data.last_page === true || data.tasks.length < 100) return dashboardOwner(tasks, clientName);
    }
    // An incomplete directory cannot establish that a match is unique.
    return;
  } catch { return; }
}
