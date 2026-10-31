import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { ClientRecord, CommitmentRecord, MonthlyTouchRecord } from "@/src/lib/mtos-data";
import { averageScore, needsAttention } from "@/src/lib/health-display";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { deriveRunSheetStage } from "@/src/lib/server/services/prep-readiness-service";

/**
 * The Command Center, organised around the AM's day instead of around client health.
 *
 * The first version led with a portfolio gauge and a priority queue sorted by health severity and
 * cut to four -- which meant a book of healthy accounts filled an "at risk" queue with Healthy and
 * Excellent clients, while the thing the AM actually needed (today's calls, the prep due tomorrow,
 * the follow-through that is three days late) was nowhere. It also labelled the average growth
 * score "Portfolio health", limited "this week's touches" to the four nearest dates whatever month
 * they were in, and said "Good morning" at six in the evening.
 *
 * Everything here is derived from real scheduled dates and real workflow state. Where a date is
 * missing it stays missing: a touch with no date is listed as needing one, not guessed into a day.
 */

export type DayPart = "morning" | "afternoon" | "evening";

export interface TouchWithClient {
  touch: MonthlyTouchRecord;
  client: ClientRecord;
  /** The meeting time we actually know, or null. Never inferred. */
  scheduledAt: Date | null;
}

export interface CommandCenterV2View {
  context: TenantContext;
  /** Server-rendered so the greeting matches the AM's working day, not the hour the page was built. */
  greeting: { part: DayPart; label: string };
  today: Date;
  todaysCalls: TouchWithClient[];
  prepDueWithin48h: TouchWithClient[];
  overdueFollowThrough: TouchWithClient[];
  qaWaiting: TouchWithClient[];
  atRisk: ClientRecord[];
  thisWeek: TouchWithClient[];
  weekLabel: string;
  overdueCommitments: CommitmentRecord[];
  /** Named for what it is: the average of the clients that actually have a growth score. */
  averageGrowthScore: { value: number | null; counted: number; total: number };
  unassessedClients: number;
  clientCount: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The meeting time for a touch.
 *
 * `scheduledAt` is the real one. `touchDate` on the client is a display string that the ClickUp
 * sync fills in, so it is used only as a fallback and only when it parses -- a string that does not
 * parse yields null rather than today's date, because a touch silently dated "now" would appear in
 * today's calls and send an AM to a meeting that is not happening.
 */
function resolveScheduledAt(touch: MonthlyTouchRecord, client: ClientRecord): Date | null {
  const candidates = [touch.scheduledAt, touch.prepPack?.schedule.scheduledAt, client.touchDate];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/** Monday to Sunday containing `date`. The AM's week, not a rolling seven days. */
function weekBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(date);
  const weekday = (start.getDay() + 6) % 7; // Monday = 0
  start.setDate(start.getDate() - weekday);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end };
}

function greetingFor(date: Date): { part: DayPart; label: string } {
  const hour = date.getHours();
  if (hour < 12) return { part: "morning", label: "Good morning." };
  if (hour < 18) return { part: "afternoon", label: "Good afternoon." };
  return { part: "evening", label: "Good evening." };
}

function formatWeekLabel(start: Date, end: Date): string {
  const last = new Date(end.getTime() - DAY_MS);
  const month = new Intl.DateTimeFormat("en-US", { month: "short" });
  const sameMonth = start.getMonth() === last.getMonth();
  return sameMonth
    ? `${month.format(start)} ${start.getDate()}–${last.getDate()}`
    : `${month.format(start)} ${start.getDate()} – ${month.format(last)} ${last.getDate()}`;
}

export async function getCommandCenterV2View(
  context: TenantContext,
  now = new Date(),
): Promise<CommandCenterV2View> {
  const dataSource = getMtosDataSource(context);
  const [clients, commitments, touches] = await Promise.all([
    dataSource.getClients(),
    dataSource.getCommitments(),
    dataSource.getMonthlyTouches(),
  ]);

  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const entries: TouchWithClient[] = touches
    .map((touch) => {
      const client = clientsById.get(touch.clientId);
      if (!client) return null;
      return { touch, client, scheduledAt: resolveScheduledAt(touch, client) };
    })
    .filter((entry): entry is TouchWithClient => entry !== null);

  const byDate = (a: TouchWithClient, b: TouchWithClient) =>
    (a.scheduledAt?.getTime() ?? Number.POSITIVE_INFINITY) -
    (b.scheduledAt?.getTime() ?? Number.POSITIVE_INFINITY);

  const todaysCalls = entries
    .filter((entry) => entry.scheduledAt && sameDay(entry.scheduledAt, now))
    .sort(byDate);

  // Prep due in the next 48 hours: the meeting is close and the preparation is not finished. A
  // touch already in Live, Follow-through or QA is not prep work, however its date reads.
  const in48h = new Date(now.getTime() + 2 * DAY_MS);
  const prepDueWithin48h = entries
    .filter((entry) => {
      if (!entry.scheduledAt) return false;
      if (entry.scheduledAt < now || entry.scheduledAt > in48h) return false;
      const stage = deriveRunSheetStage(entry.touch);
      return stage === "prep" || stage === "review";
    })
    .sort(byDate);

  // Follow-through is overdue once the meeting has passed and the post-meeting decisions have not
  // been applied. The SOP window is 24 business hours; a full day past the meeting is the earliest
  // point at which it is genuinely late rather than simply not done yet.
  const overdueFollowThrough = entries
    .filter((entry) => {
      if (!entry.scheduledAt) return false;
      if (entry.scheduledAt.getTime() > now.getTime() - DAY_MS) return false;
      if (entry.touch.qaReview) return false;
      return entry.touch.postMeeting?.status !== "approved";
    })
    .sort(byDate);

  const qaWaiting = entries
    .filter((entry) => entry.touch.qaReview?.status === "pending_victor_approval")
    .sort(byDate);

  // At risk means the health label says so. Healthy and Excellent accounts are not an attention
  // queue, and an unassessed account is a gap to fill rather than an emergency -- both are counted
  // separately instead of being padded into this list to make it look busy.
  const atRisk = clients
    .filter((client) => needsAttention(client.tone))
    .sort((a, b) => (a.commitmentsOpen ?? 0) < (b.commitmentsOpen ?? 0) ? 1 : -1);

  const { start, end } = weekBounds(now);
  const thisWeek = entries
    .filter((entry) => entry.scheduledAt && entry.scheduledAt >= start && entry.scheduledAt < end)
    .sort(byDate);

  const growth = averageScore(clients.map((client) => client.growthReadiness));

  return {
    context,
    greeting: greetingFor(now),
    today: now,
    todaysCalls,
    prepDueWithin48h,
    overdueFollowThrough,
    qaWaiting,
    atRisk,
    thisWeek,
    weekLabel: formatWeekLabel(start, end),
    overdueCommitments: commitments.filter((commitment) => commitment.status === "Overdue"),
    averageGrowthScore: { ...growth, total: clients.length },
    unassessedClients: clients.filter((client) => client.tone === "unknown").length,
    clientCount: clients.length,
  };
}
