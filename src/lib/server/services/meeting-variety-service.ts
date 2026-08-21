/**
 * Meeting variety / client-as-copilot engine.
 *
 * Ensures no two monthly touches feel identical: each touch is assigned a rotating
 * FORMAT (a different angle month to month), a soft VARIETY NOTE describing how it
 * differs from last time, and one or two interactive DECISIONS the client co-owns —
 * so the client is a copilot, not a passenger.
 *
 * Deterministic and dependency-free: works with or without an LLM. The editable
 * `meeting_variety_prompt` in the Prompt Engine carries the same intent to the AI.
 */
import type { ClientRecord, DecisionTogether, MeetingFormat, OpportunityRecord } from "@/src/lib/mtos-data";
import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import {
  clientTouchHistoryCollectionPath,
  clientTouchHistoryPath,
} from "@/src/lib/server/firebase/collections";

/** The rotating library of meeting formats. Order is the default rotation order. */
export const MEETING_FORMATS: MeetingFormat[] = [
  { id: "wins-deep-dive", name: "Wins Deep-Dive", angle: "Celebrate and unpack the biggest measurable wins and exactly how they happened.", spotlight: "The single strongest result this period and its business impact." },
  { id: "competitor-teardown", name: "Competitor Teardown", angle: "Compare the client to their top local competitors and decide where to attack.", spotlight: "The competitor gap on the map and how to close it." },
  { id: "goal-coplanning", name: "Goal Co-Planning Workshop", angle: "Co-build the next 90-day goal and the path to reach it, together.", spotlight: "The goal, the milestones, and who owns what." },
  { id: "quick-win-sprint", name: "Quick-Win Sprint", angle: "Pick a handful of fast, high-impact levers to execute this month.", spotlight: "The fastest wins available right now." },
  { id: "customer-journey", name: "Customer-Journey Review", angle: "Walk the path a customer takes from search to booked job and fix the leaks.", spotlight: "Where leads drop off between found and booked." },
  { id: "seasonal-offer", name: "Seasonal & Offer Planning", angle: "Plan offers and campaigns around the season ahead.", spotlight: "The upcoming seasonal opportunity to capture." },
  { id: "money-map", name: "Money Map", angle: "Connect rankings and leads to real revenue and ROI.", spotlight: "The leads → booked jobs → revenue chain." },
  { id: "reputation-review", name: "Reputation & Reviews", angle: "Reviews, Google engagement, and the trust signals that win the click.", spotlight: "Review velocity, rating, and profile engagement." },
];

export interface TouchHistoryEntry {
  touchId: string;
  at: string;
  formatId: string;
  spotlight?: string;
}

// Exclude all-but-one of the formats from being re-picked, so the rotation cycles
// through the entire library before any format repeats.
const RECENT_WINDOW = MEETING_FORMATS.length - 1;

export async function readTouchHistory(context: TenantContext, clientId: string): Promise<TouchHistoryEntry[]> {
  const db = getFirebaseAdminDb();
  if (!db) return [];
  try {
    const snapshot = await db.collection(clientTouchHistoryCollectionPath(context.tenantId, clientId)).get();
    return snapshot.docs
      .map((doc) => doc.data() as TouchHistoryEntry)
      .sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  } catch {
    return [];
  }
}

export async function recordTouchHistory(context: TenantContext, clientId: string, entry: TouchHistoryEntry): Promise<void> {
  const db = getFirebaseAdminDb();
  if (!db) return;
  try {
    // Keyed by touchId, so re-preparing the same touch updates rather than duplicates.
    await db.doc(clientTouchHistoryPath(context.tenantId, clientId, entry.touchId)).set(entry, { merge: true });
  } catch {
    // history is best-effort — never block prep
  }
}

/** Pick a format not used recently. Deterministic: prefers the format least-recently
 *  used (never-used first, then oldest), so the rotation cycles all formats before repeating. */
export function chooseMeetingFormat(recentFormatIds: string[]): MeetingFormat {
  const recent = recentFormatIds.slice(0, RECENT_WINDOW);
  const roundsSinceUsed = (id: string): number => {
    const i = recent.indexOf(id);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  return [...MEETING_FORMATS]
    .map((f, order) => ({ f, order, score: roundsSinceUsed(f.id) }))
    .sort((a, b) => b.score - a.score || a.order - b.order)[0].f;
}

/** Resolve the format for a touch: stable once chosen (re-prep keeps it), otherwise rotate. */
export async function resolveMeetingFormat(
  context: TenantContext,
  clientId: string,
  touchId: string,
): Promise<{ format: MeetingFormat; previous?: TouchHistoryEntry }> {
  const history = await readTouchHistory(context, clientId);
  const existing = history.find((h) => h.touchId === touchId);
  const others = history.filter((h) => h.touchId !== touchId);
  if (existing) {
    const found = MEETING_FORMATS.find((f) => f.id === existing.formatId);
    if (found) return { format: found, previous: others[0] };
  }
  return { format: chooseMeetingFormat(others.map((h) => h.formatId)), previous: others[0] };
}

/** Soft variety guardrail: describe how this touch differs, or warn if it repeats the last. */
export function buildVarietyNote(format: MeetingFormat, previous?: TouchHistoryEntry): string {
  if (previous && previous.formatId === format.id) {
    const prevName = MEETING_FORMATS.find((f) => f.id === previous.formatId)?.name || "last month";
    return `Heads up: this touch is using the same format as last time (${prevName}). Consider changing the angle or opening so it doesn't feel like a repeat.`;
  }
  if (previous) {
    const prevName = MEETING_FORMATS.find((f) => f.id === previous.formatId)?.name || "the last touch";
    return `This month's angle is “${format.name}” — deliberately different from ${prevName}. Lead with: ${format.spotlight}`;
  }
  return `This month's angle is “${format.name}”. Lead with: ${format.spotlight}`;
}

/** Build one or two interactive decisions the client co-owns, varied by format + data. */
export function buildDecisionsTogether(
  client: ClientRecord,
  format: MeetingFormat,
  opportunities: OpportunityRecord[],
  keywordTerms: string[],
): DecisionTogether[] {
  const decisions: DecisionTogether[] = [];
  const kw = keywordTerms.filter(Boolean);
  const opps = opportunities.map((o) => o.title).filter(Boolean);

  // Decision 1 — always: co-set the next 30-day focus (options drawn from real data where possible).
  const focusOptions =
    opps.length >= 2 ? [opps[0], opps[1]]
    : kw.length >= 2 ? [`Push “${kw[0]}” harder`, `Grow “${kw[1]}”`]
    : opps.length === 1 ? [opps[0], "Hold and consolidate current gains"]
    : ["Go after more visibility", "Focus on converting the traffic you already have"];
  decisions.push({
    question: "What should we make the #1 focus for the next 30 days?",
    options: focusOptions,
    why: "When the client chooses the priority, they own the plan — and we work on what matters most to them.",
  });

  // Decision 2 — format-specific, to keep the interactive moment fresh each month.
  const byFormat: Record<string, DecisionTogether> = {
    "competitor-teardown": { question: "Which competitor should we target first?", options: ["The one ranking just above you", "The one winning the most reviews"], why: "Focusing the attack makes the gains visible faster." },
    "seasonal-offer": { question: "Which offer should we run this month?", options: ["A limited-time seasonal promotion", "A review-for-discount push"], why: "A timely offer turns your visibility into booked jobs." },
    "money-map": { question: "Which number matters most to you right now?", options: ["More total leads", "Higher-value jobs"], why: "It changes where we point the strategy — volume vs. value." },
    "customer-journey": { question: "Where do you feel you lose the most customers?", options: ["Before they call (visibility)", "After they call (follow-up / speed)"], why: "We fix the biggest leak first." },
    "quick-win-sprint": { question: "Which quick win do you want first?", options: ["A new Google offer this week", "A fresh service/location page"], why: "You pick the fastest win you'll feel." },
    "reputation-review": { question: "How aggressive should we get on reviews?", options: ["Steady, natural pace", "An active review-generation campaign"], why: "Reviews drive both ranking and the click — your comfort sets the pace." },
    "goal-coplanning": { question: "What's the milestone we're aiming at next quarter?", options: ["A ranking / visibility target", "A booked-jobs / revenue target"], why: "A shared goal makes every month's work add up to something." },
    "wins-deep-dive": { question: "Which win should we try to repeat and scale?", options: ["The top-performing keyword", "The channel driving the best leads"], why: "Doubling down on what's working compounds results." },
  };
  const second = byFormat[format.id];
  if (second) decisions.push(second);

  return decisions;
}
