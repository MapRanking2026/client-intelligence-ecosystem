/**
 * What kind of lead a lead is, and which calls went unanswered.
 *
 * These two questions are asked in two places that had no idea about each other. The lead & call
 * verification engine resolves a type for every lead and counts missed calls, and the business
 * scorecard on the preparation brief has a "Form submissions" tile and a "Calls missed" tile. The
 * scorecard's two tiles were written as:
 *
 *     callsMissed:     metric("Calls missed",     null, null, "Requires CRM call-tracking data")
 *     formSubmissions: metric("Form submissions", null, null, "Requires per-source contact breakdown")
 *
 * -- hard-coded nulls with a note explaining what was needed, next to a verification engine that
 * had been computing both all along. The AM read "--" on both tiles and the note told them the data
 * did not exist. It did; nothing joined the two up. Reported by the owner on 11 November 2026.
 *
 * So the rules live here, once, and both callers use them. Pure: no Firestore, no GoHighLevel, no
 * React, and exercised directly by `scripts/check-lead-mix.ts`.
 */

import type { BusinessScorecard, LeadType, LeadVerificationReview, ScorecardMetric } from "@/src/lib/mtos-data";

type JsonRecord = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Everything about a lead that hints at how it arrived, as one lowercase string.
 *
 * The raw source, the UTM block and the tags together, because GoHighLevel puts the useful part in
 * a different one of those depending on how the lead was created.
 */
export function leadArrivalSignal(lead: JsonRecord): string {
  const attribution = (lead.attribution || {}) as JsonRecord;
  return [
    lead.source,
    attribution.source,
    attribution.medium,
    attribution.campaign,
    attribution.referrer,
    ...(Array.isArray(lead.tags) ? (lead.tags as unknown[]) : []),
  ]
    .map((part) => text(part))
    .join(" ")
    .toLowerCase();
}

/**
 * Whether this lead is a phone call, a chat, or a form.
 *
 * `form` is the default on purpose and that is a judgement, not an oversight: a web lead with no
 * recognizable signal arrived by filling something in, and calls and chats both announce themselves
 * loudly (a call carries `type: "call"` and call metadata from the sync; a chat says sms, widget or
 * whatsapp somewhere). Defaulting the unknown case to `call` would inflate the missed-call tile
 * with leads that never rang.
 */
export function resolveLeadType(lead: JsonRecord): LeadType {
  if (text(lead.type) === "call" || lead.call) {
    return "call";
  }
  const signal = leadArrivalSignal(lead);
  if (/call|phone|inbound|dial/.test(signal)) {
    return "call";
  }
  if (/chat|sms|message|widget|whatsapp/.test(signal)) {
    return "chat";
  }
  return "form";
}

/**
 * The call statuses that mean nobody picked up.
 *
 * GoHighLevel's status strings vary by the telephony provider behind the sub-account, so this
 * matches on the words rather than on an enumeration nobody controls. `cancel` and `failed` are in
 * here because a call that never connected is, from the client's side, a customer who did not get
 * through -- which is the thing the tile exists to put in front of an account manager.
 */
const MISSED_CALL_STATUS = /missed|no-?answer|no_answer|voicemail|busy|failed|cancel|unanswered|declin/;

/** Whether a call's metadata says it rang through and was never answered. */
export function callWasMissed(call: JsonRecord | undefined): boolean {
  if (!call) return false;
  return MISSED_CALL_STATUS.test(text(call.status).toLowerCase());
}

/** Whether a raw lead record is an unanswered call. */
export function leadIsMissedCall(lead: JsonRecord): boolean {
  if (resolveLeadType(lead) !== "call") return false;
  return callWasMissed((lead.call || {}) as JsonRecord);
}

export interface LeadMix {
  total: number;
  calls: number;
  /** Calls that rang and were not answered. A subset of `calls`. */
  missedCalls: number;
  /**
   * Calls whose outcome could actually be read.
   *
   * The distinction that keeps the "Calls missed" tile honest, and it is not hypothetical: the
   * shared GoHighLevel snapshot stores contacts only, with no call conversations in it at all, so
   * every lead it classifies as a call by its source wording ("Inbound Phone Call") carries no
   * status to judge. Counted naively that is `missedCalls: 0` -- a confident zero meaning "nobody
   * looked", printed on a brief next to 83 calls. A caller with no judgeable calls must show an em
   * dash, because missing is missing and never a zero.
   */
  callsWithStatus: number;
  forms: number;
  chats: number;
}

export function emptyLeadMix(): LeadMix {
  return { total: 0, calls: 0, missedCalls: 0, callsWithStatus: 0, forms: 0, chats: 0 };
}

/**
 * The shape of a window's leads: how many came by phone, by form and by chat, and how many of the
 * calls went unanswered.
 *
 * Takes raw records from the integration snapshot. For leads that have already been through the
 * verification engine use `verifiedLeadMix` below, which trusts the statuses that engine settled
 * rather than re-deriving them from metadata the AI pass may have reinterpreted.
 */
export function summarizeLeadMix(leads: JsonRecord[]): LeadMix {
  const mix = emptyLeadMix();
  for (const lead of leads) {
    mix.total += 1;
    const type = resolveLeadType(lead);
    if (type === "call") {
      mix.calls += 1;
      const call = (lead.call || {}) as JsonRecord;
      if (text(call.status)) {
        mix.callsWithStatus += 1;
        if (callWasMissed(call)) mix.missedCalls += 1;
      }
    } else if (type === "chat") {
      mix.chats += 1;
    } else {
      mix.forms += 1;
    }
  }
  return mix;
}

/**
 * The same shape, from leads the verification engine has already classified.
 *
 * Preferred wherever a review exists: the engine pulls a larger window per client than the shared
 * snapshot can hold, and `status` here is the verdict after the AI pass and after the missed-call
 * status is re-asserted over it -- so this is the count an AM has actually seen and corrected,
 * rather than a second opinion computed beside it.
 */
export function verifiedLeadMix(
  leads: { type: LeadType; status: string }[],
): LeadMix {
  const mix = emptyLeadMix();
  for (const lead of leads) {
    mix.total += 1;
    if (lead.type === "call") {
      mix.calls += 1;
      // A verified lead always carries a settled status, so every call here is one whose outcome
      // somebody -- the engine, then the AM -- has actually decided.
      mix.callsWithStatus += 1;
      if (lead.status === "missed_call") mix.missedCalls += 1;
    } else if (lead.type === "chat") {
      mix.chats += 1;
    } else {
      mix.forms += 1;
    }
  }
  return mix;
}

/** A scorecard tile, with the availability flag derived rather than passed in and forgotten. */
function leadMetric(label: string, value: number | null, source: string, period: string): ScorecardMetric {
  return {
    label,
    value,
    previousValue: null,
    unit: "count",
    availability: value === null ? "unavailable" : "available",
    source,
    period,
  };
}

/**
 * Fill the two lead-mix tiles from the verification review, when there is one.
 *
 * Used in two places, and pure so that it can be. During a preparation the prep pack and the lead
 * verification run in parallel on purpose -- neither reads the other's output, so the prep costs
 * the slower rather than the sum -- which means the scorecard is built before the review exists and
 * this is the join afterwards, at no extra I/O. And on the way out of a stored touch, so that every
 * brief prepared before these tiles worked shows the numbers MTOS already holds instead of making
 * the AM sit through another account review.
 *
 * The review wins over the snapshot because it pulls a larger window per client than the shared
 * snapshot can hold, and because its statuses are the ones the AM sees in the lead table below the
 * brief and can correct. A scorecard tile disagreeing with that table is worse than the em dash it
 * replaced: the AM cannot tell which number to say out loud on the call.
 *
 * Counted from the leads rather than read off `review.totals.missedCalls`, because reviews written
 * before that total existed carry no value for it -- there is one on the live tenant with 82 calls
 * and no `missedCalls` at all -- and the leads are always there to count.
 */
export function withVerifiedLeadMix(
  scorecard: BusinessScorecard,
  review: LeadVerificationReview | undefined,
): BusinessScorecard {
  if (!review || review.status !== "ready" || !review.leads.length) {
    return scorecard;
  }
  const mix = verifiedLeadMix(review.leads);
  const period = leadWindowLabel(review.window);
  return {
    ...scorecard,
    callsMissed: leadMetric("Calls missed", mix.missedCalls, "Lead & call verification", period),
    formSubmissions: leadMetric("Form submissions", mix.forms, "Lead & call verification", period),
  };
}

/**
 * A window as the tile's period line should read it.
 *
 * Stated from the data rather than assumed, because these two tiles are the ones an AM quotes at a
 * client: "you had 14 form submissions" is a different claim from "you had 14 form submissions last
 * month". The old tiles said "Last 30 days" while holding no number at all.
 */
export function leadWindowLabel(window?: { since?: string; until?: string }): string {
  const day = (iso?: string) => {
    if (!iso) return "";
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? ""
      : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
  };
  const since = day(window?.since);
  const until = day(window?.until);
  if (since && until) return `${since} → ${until}`;
  if (since) return `${since} → now`;
  return "Last 30 days";
}
