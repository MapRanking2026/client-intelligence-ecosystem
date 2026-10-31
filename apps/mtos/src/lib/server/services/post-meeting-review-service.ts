import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { RiskRegisterEntry, RiskTier, StakeholderMapEntry } from "@/src/lib/mtos-data";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import {
  applyClientIntelligenceDecisions,
  recordClientHealth,
} from "@/src/lib/server/services/client-intelligence-service";
import {
  applyPostMeetingDecisions,
  type PostMeetingTicketInput,
} from "@/src/lib/server/services/post-meeting-service";
import {
  reviewBlockers,
  riskFlagCount,
  riskTierFromFlagCount,
  type EntryDecision,
} from "@/src/lib/contracts/post-meeting-review";

/**
 * One submission for the whole post-meeting review.
 *
 * The AM used to press three buttons in sequence -- record the score, apply the client
 * intelligence, confirm the tickets -- and each one reloaded the screen, which threw away
 * everything they had typed into the other two. So they had to start over, every time, and the
 * safest thing to do was retype less. That is a correctness problem dressed as an annoyance: a
 * review the AM can't finish in one pass is a review that gets finished badly.
 *
 * This is the single entry point instead. The score, the tickets, the Risk Register entry, the
 * Stakeholder Map entry and the client recap email arrive together, are checked together against
 * the same rules the screen checks, and are then applied in the only order that makes them true:
 *
 *   1. the score, because the Risk Register requirement and the notes' first line both come from it
 *   2. the Risk Register and Stakeholder Map entries, each written to ClickUp on its own
 *   3. the tickets and the email, and last of all the notes, which quote the ticket links
 *
 * Nothing is created, written or filed before this call. A single refusal refuses the whole
 * submission before step 1, so a rejected review never leaves half of itself in ClickUp.
 */

export interface PostMeetingReviewInput {
  /** The confirmed score. null is "no score given", recorded as that rather than as zero. */
  nps: number | null;
  npsReason: string;
  riskTier?: RiskTier;
  riskReason?: string;
  tickets: PostMeetingTicketInput[];
  riskRegister?: { decision: EntryDecision; entry: RiskRegisterEntry };
  stakeholderMap?: { decision: EntryDecision; entry: StakeholderMapEntry };
  email: { subject: string; body: string; approve: boolean };
}

export class PostMeetingReviewIncompleteError extends Error {
  readonly blockers: string[];
  constructor(blockers: string[]) {
    super(blockers.join(" "));
    this.name = "PostMeetingReviewIncompleteError";
    this.blockers = blockers;
  }
}

export async function applyPostMeetingReview(
  context: TenantContext,
  touchId: string,
  input: PostMeetingReviewInput,
) {
  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }
  const postMeeting = touch.postMeeting;
  if (!postMeeting || postMeeting.status !== "draft_ready") {
    throw new Error("Analyze the transcript before submitting the review.");
  }
  const intelligence = postMeeting.clientIntelligence;

  // The derived fields are computed here rather than trusted from the client, so the count, the
  // tier and the stored entry can never disagree with the threat answers the AM actually gave.
  const riskEntry: RiskRegisterEntry | undefined = input.riskRegister
    ? {
        ...input.riskRegister.entry,
        riskScore: riskFlagCount(input.riskRegister.entry),
        riskTier: riskTierFromFlagCount(riskFlagCount(input.riskRegister.entry)),
      }
    : undefined;

  const blockers = reviewBlockers({
    nps: input.nps,
    npsReason: input.npsReason,
    // Reaching this function at all means the AM pressed submit, so the score was decided -- the
    // only remaining question is whether it is a number or an explicit "none given".
    npsChosen: true,
    tickets: input.tickets.map((ticket) => ({
      decision: ticket.decision,
      title: ticket.title,
      description: ticket.description,
      ticketType: ticket.ticketType,
      billingChangeType: ticket.billingChangeType,
    })),
    ...(riskEntry
      ? { risk: { decision: input.riskRegister?.decision, entry: riskEntry, offered: Boolean(intelligence?.riskRegister) } }
      : { risk: { decision: undefined, entry: {}, offered: Boolean(intelligence?.riskRegister) } }),
    ...(input.stakeholderMap
      ? {
          stakeholder: {
            decision: input.stakeholderMap.decision,
            entry: input.stakeholderMap.entry,
            offered: Boolean(intelligence?.stakeholderMap),
          },
        }
      : {}),
    email: input.email,
  });
  if (blockers.length) {
    throw new PostMeetingReviewIncompleteError(blockers);
  }

  // 1. The score. First, because the Risk Register requirement and the notes' header both read it.
  if (intelligence) {
    await recordClientHealth(context, touchId, {
      nps: input.nps,
      npsReason: input.npsReason,
      riskTier: input.riskTier,
      riskReason: input.riskReason,
    });
  }

  // 2. The two register entries, each written on its own so one failing leaves the other standing.
  if (intelligence && (input.riskRegister?.decision || input.stakeholderMap?.decision)) {
    await applyClientIntelligenceDecisions(context, touchId, {
      ...(input.riskRegister?.decision && riskEntry
        ? { riskRegister: { ...riskEntry, decision: input.riskRegister.decision } }
        : {}),
      ...(input.stakeholderMap?.decision
        ? { stakeholderMap: { ...input.stakeholderMap.entry, decision: input.stakeholderMap.decision } }
        : {}),
    });
  }

  // 3. The tickets, the email, and the notes -- which are written last because this is the first
  // moment they can be true: the score is confirmed and every ticket link exists.
  return applyPostMeetingDecisions(context, touchId, {
    tickets: input.tickets,
    email: input.email,
  });
}
