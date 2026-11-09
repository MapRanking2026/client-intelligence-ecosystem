import type {
  CallLabel,
  CallLabelSource,
  LeadCategory,
  LeadStatus,
  VerifiedLead,
} from "@/src/lib/mtos-data";

export type { CallLabel, CallLabelSource };

/**
 * The five words the call dashboard reports in, and the three layers that decide them.
 *
 * The owner's specification (8 November 2026) asks for calls labelled Good, Missed, Spam, Job
 * seeker or Unrelated. The app already stores four statuses crossed with nine categories, and the
 * instruction was explicit: add these alongside, delete nothing. So this file derives a call label
 * from what is already stored rather than replacing it. The lead & call verification page keeps
 * reporting on its nine categories, the channel reconciliation keeps working, and no stored
 * document changes meaning.
 *
 * ## Why a derivation and not a migration
 *
 * A migration would have to decide, once and forever, what an old `needs_review / valid_new_lead`
 * was really worth. Nobody knows -- it means "the rules could not tell", which is a different fact
 * from any of the five labels. Deriving instead means the honest answer survives: that call comes
 * out as the automatic layer's best reading, flagged as automatic, and a person can overrule it.
 * Re-deriving is free and nothing is lost if these rules change next month.
 *
 * ## The layers, in the order they win
 *
 * Three of them are decisions somebody made; two are readings of the data.
 *
 * 1. **Manual.** A label a person set by hand. It wins over everything and survives a re-pull.
 * 2. **AI review.** The vetting pass, where it ran and had something to read.
 * 3. **A recorded fact.** Where GoHighLevel recorded that nobody answered, the call is missed --
 *    see `hasRecordedNoAnswer`. This outranks the old nine-category verdict below it, because
 *    whether the phone was picked up is a record of the call, while the verdict is a judgement
 *    about the lead. A voicemail from a real prospect is honestly both.
 * 4. **The stored verdict.** The old nine categories, read where they are specific enough to mean
 *    something. This is what lets pulls made before 8 November 2026 appear here at all.
 * 5. **Automatic rules.** Always on, and the fallback. Never absent, so no call is unlabelled.
 *
 * Every row can say which layer decided and why, because a label on a client's call with no
 * visible reasoning is the thing an AM cannot defend in a meeting.
 *
 * ## What these rules honestly cannot do
 *
 * Two of the five labels need to know what was *said*: a job seeker asking about hiring, and a
 * robocall's wording. GoHighLevel call messages usually carry no transcript at all unless the
 * sub-account has transcription switched on. So `automaticCallLabel` reaches "job_seeker" and the
 * wording-based half of "spam" only when there is text to read, and the rest of the time it says
 * so rather than guessing. A call is never labelled a job seeker because it was short.
 *
 * This is deliberate and it is the whole reason `labelReason` exists. A dashboard that silently
 * invented "Job seeker" from a duration would be worse than one that admits the text is missing.
 */

/**
 * The five labels, in reporting order: the one that is good news, then the four that are not.
 *
 * `CallLabel` and `CallLabelSource` themselves live beside the other lead types in `mtos-data.ts`
 * and are re-exported above, so a caller needs only this module.
 */
export const CALL_LABELS: CallLabel[] = ["good", "missed", "spam", "job_seeker", "unrelated"];

export const CALL_LABEL_LABEL: Record<CallLabel, string> = {
  good: "Good",
  missed: "Missed",
  spam: "Spam",
  job_seeker: "Job seeker",
  unrelated: "Unrelated",
};

export const CALL_LABEL_SOURCE_LABEL: Record<CallLabelSource, string> = {
  manual: "You",
  ai: "AI review",
  automatic: "Automatic rule",
};

/**
 * Whether more of this label is good news.
 *
 * Only "good" rises in the right direction. The specification is explicit that for Missed, Spam,
 * Job seekers and Unrelated a *fall* is the improvement, and getting this backwards paints a green
 * arrow on a month that got worse -- which is exactly the number a client quotes back at you.
 */
export function moreIsBetter(label: CallLabel): boolean {
  return label === "good";
}

/** The colour each label is drawn in, as a CSS variable so it follows the theme. */
export const CALL_LABEL_TONE: Record<CallLabel, string> = {
  good: "var(--good)",
  missed: "var(--risk)",
  spam: "var(--watch)",
  job_seeker: "var(--info)",
  unrelated: "var(--slate-400)",
};

/**
 * A connected call shorter than this is a hang-up or a misdial, not a conversation.
 *
 * The specification sets the good-call floor at 20 seconds and the hang-up ceiling at 6. Both are
 * the owner's numbers, not an invention here: the existing heuristic used 10 and 60, which is why
 * `automaticCallLabel` does not simply reuse it.
 */
export const GOOD_CALL_MIN_SECONDS = 20;
export const HANGUP_MAX_SECONDS = 6;

/** Call statuses that mean nobody picked up. */
const MISSED_STATUS = /missed|no-?answer|no_answer|voicemail|busy|failed|cancel|unanswered|declin/i;

/**
 * Whether GoHighLevel actually recorded that nobody answered this call.
 *
 * This is a FACT about the call, not a reading of it, and that distinction is the whole point of
 * the function existing separately from `automaticCallLabel`. That function also returns "missed"
 * when there is no duration AND no status -- but that is the ABSENCE of data, not evidence of a
 * missed call, and it must not be allowed to overrule anything.
 *
 * `lead-verification-service.ts` has taken the same view since long before this file existed: it
 * marks a no-answer call `missed_call` up front and re-asserts that status after the AI pass,
 * because "whether a call was answered is a FACT from its metadata, not a judgment". This is the
 * same rule, applied one layer further along.
 */
export function hasRecordedNoAnswer(callStatus: string | undefined): boolean {
  const status = (callStatus || "").trim();
  return Boolean(status) && MISSED_STATUS.test(status);
}

/** Wording that only appears in a robocall or a cold sales script. */
const SPAM_WORDING =
  /(press\s*(one|1|two|2))|(this is not a sales call)|(final notice)|(your (car|auto) warranty)|(google (listing|business) (is|has) (not )?verif)|(seo services)|(rank (your|you) (site|website) (on|#))|(medicare)|(student loan)|(social security (number|administration))|(crypto)|(solar (program|incentive))|(we are calling regarding your)/i;

/** Wording that means somebody is asking about a job, not about buying anything. */
const JOB_SEEKER_WORDING =
  /(are you hiring)|(looking for (a )?(job|work|employment|position))|(apply(ing)? for (a )?(job|position))|(any (job )?openings)|(accepting applications)|(send (you )?my (resume|cv))|(job application)|(is the position still)|(interested in (a )?(job|position) )|(hiring for)/i;

/** Wording that means the caller wanted somebody else entirely. */
const WRONG_NUMBER_WORDING =
  /(wrong number)|(sorry,? wrong)|(i think i (have|dialed) the wrong)|(is this (not )?[a-z ]{3,20}\?.*no)|(must have misdialed)/i;

/** What the automatic layer decided, and the sentence it would say about it. */
export interface AutomaticLabel {
  label: CallLabel;
  /** Plain words, shown in the row. Never a rule id. */
  reason: string;
}

/** Everything the automatic rules are allowed to look at. */
export interface CallFacts {
  /** Seconds the call lasted. 0 or undefined for a call that never connected. */
  durationSec?: number;
  /** GoHighLevel's own call status string, whatever shape it arrived in. */
  callStatus?: string;
  /** "inbound" / "outbound", where it was recorded. */
  direction?: string;
  /** The call's transcript or message body, when the sub-account captured one. */
  text?: string;
}

/**
 * The automatic label for a call, from its metadata and whatever text exists.
 *
 * Checked in the order that matters most: whether anybody answered comes before what was said,
 * because a voicemail containing the word "hiring" is still a missed call the client should ring
 * back. Spam is checked before job seeker only because a robocall about jobs is still a robocall.
 *
 * Returns a label for every call. There is no "unknown" -- an unlabelled row would be a hole in
 * the one table the whole dashboard is evidence for.
 */
export function automaticCallLabel(facts: CallFacts): AutomaticLabel {
  const duration = Number(facts.durationSec) || 0;
  const status = (facts.callStatus || "").trim();
  const text = (facts.text || "").trim();

  if (status && MISSED_STATUS.test(status)) {
    return {
      label: "missed",
      reason: `Nobody answered — GoHighLevel recorded this call as "${status}".`,
    };
  }
  if (!duration && !status) {
    return {
      label: "missed",
      reason: "No answer and no duration were recorded, so this call did not connect.",
    };
  }

  if (text && SPAM_WORDING.test(text)) {
    return {
      label: "spam",
      reason: "What was said matches a robocall or cold sales script.",
    };
  }
  if (text && JOB_SEEKER_WORDING.test(text)) {
    return {
      label: "job_seeker",
      reason: "The caller asked about work or hiring, not about buying anything.",
    };
  }
  if (text && WRONG_NUMBER_WORDING.test(text)) {
    return {
      label: "unrelated",
      reason: "The caller said they had the wrong number.",
    };
  }

  if (duration > 0 && duration < HANGUP_MAX_SECONDS) {
    return {
      label: "spam",
      reason: `Answered and hung up after ${duration}s, which is a robocall or a misdial rather than a caller.`,
    };
  }
  if (duration >= GOOD_CALL_MIN_SECONDS) {
    return {
      label: "good",
      reason: `Answered and lasted ${duration}s, long enough to be a real conversation.`,
    };
  }
  if (duration > 0) {
    return {
      label: "unrelated",
      reason: `Answered but lasted only ${duration}s, under the ${GOOD_CALL_MIN_SECONDS}s a real enquiry takes.${
        text ? "" : " There is no call text to read, so this is from the length alone."
      }`,
    };
  }

  return {
    label: "missed",
    reason: `GoHighLevel reported "${status}" with no duration, so this call did not connect.`,
  };
}

/**
 * The call label implied by the nine-category verdict a lead already carries.
 *
 * This is the bridge that lets stored pulls appear on the new dashboard without being re-fetched.
 * It is a reading of an existing verdict, not a second opinion: where the old verdict is specific
 * the new label follows it, and where the old verdict means "we could not tell"
 * (`needs_review`) there is nothing to translate, so it returns undefined and the automatic rules
 * answer instead.
 */
export function callLabelFromVerdict(
  status: LeadStatus | undefined,
  category: LeadCategory | undefined,
): CallLabel | undefined {
  if (status === "missed_call") {
    return "missed";
  }
  switch (category) {
    case "spam":
    case "sales_solicitation":
      return "spam";
    case "wrong_number":
    case "out_of_area":
    case "irrelevant":
      return "unrelated";
    case "valid_new_lead":
      return status === "valid" ? "good" : undefined;
    case "existing_customer":
      // A real conversation with a real customer. Not a new lead, but not junk either, and the
      // dashboard counts good calls rather than new leads.
      return status === "valid" ? "good" : undefined;
    case "duplicate":
    case "incomplete":
    default:
      return undefined;
  }
}

/** A lead as this module needs to see it. Narrow on purpose, so it is easy to test. */
export type LabelledLead = Pick<
  VerifiedLead,
  "status" | "category" | "callDurationSec" | "callStatus" | "callDirection"
> & {
  callLabel?: CallLabel;
  labelSource?: CallLabelSource;
  labelReason?: string;
  transcript?: string;
};

/** The label, the layer that set it, and why -- for one call. */
export interface ResolvedLabel {
  label: CallLabel;
  source: CallLabelSource;
  reason: string;
}

/**
 * The label a call should show right now, respecting the layer order.
 *
 * A manual label is returned untouched, then a stored AI label where there is one. After those,
 * a recorded no-answer settles it -- the phone system said nobody picked up, and that outranks any
 * reading of the lead. Only then is the old nine-category verdict consulted, and only where it is
 * specific enough to mean something (see `callLabelFromVerdict`); the automatic rules answer when
 * it is not. The full order, and why, is at the top of this file.
 */
export function resolveCallLabel(lead: LabelledLead): ResolvedLabel {
  if (lead.labelSource === "manual" && lead.callLabel) {
    return {
      label: lead.callLabel,
      source: "manual",
      reason: lead.labelReason || "You set this label by hand.",
    };
  }
  if (lead.labelSource === "ai" && lead.callLabel) {
    return {
      label: lead.callLabel,
      source: "ai",
      reason: lead.labelReason || "AI review read the call and set this label.",
    };
  }

  // A recorded no-answer beats the old nine-category verdict, on the owner's instruction
  // (8 November 2026) and measured on live data: of 121 real calls GoHighLevel recorded as
  // unanswered, 32 were stored under some other verdict, and 3 of those were being reported as
  // Good or Unrelated -- a voicemail shown to a client as an answered call.
  //
  // This sits BELOW a hand-set label and below AI review, which are deliberate decisions about
  // the label itself, and ABOVE the verdict, which is a judgement about the lead rather than a
  // record of the call. The two were never really in conflict: a voicemail from somebody who
  // genuinely wants a quote is both a missed call AND a valid new lead. The old nine categories
  // had no single word for that, so the verdict had to pick one and picked the wrong one for this
  // column. The lead & call verification page still shows that verdict, untouched.
  if (hasRecordedNoAnswer(lead.callStatus)) {
    return {
      label: "missed",
      source: "automatic",
      reason: `Nobody answered — GoHighLevel recorded this call as "${(lead.callStatus || "").trim()}".${
        lead.category ? ` The earlier verification read the lead itself as "${lead.category}", which is a separate question from whether the phone was picked up.` : ""
      }`,
    };
  }

  const fromVerdict = callLabelFromVerdict(lead.status, lead.category);
  const automatic = automaticCallLabel({
    durationSec: lead.callDurationSec,
    callStatus: lead.callStatus,
    direction: lead.callDirection,
    text: lead.transcript,
  });

  if (fromVerdict && fromVerdict !== automatic.label) {
    // The stored verdict is more specific than the metadata, so it wins -- but say which it was.
    return {
      label: fromVerdict,
      source: "automatic",
      reason: `Carried over from the earlier verification, which marked this call "${
        lead.category ?? "unknown"
      }".`,
    };
  }
  return { label: automatic.label, source: "automatic", reason: automatic.reason };
}

/** Whether this call counts as inbound. The dashboard reports on inbound calls only. */
export function isInboundCall(direction: string | undefined): boolean {
  const value = (direction || "").trim().toLowerCase();
  return value !== "outbound" && value !== "out";
}

/**
 * Whether a direction was actually recorded.
 *
 * `isInboundCall` treats a missing direction as inbound, because GoHighLevel often omits it and
 * dropping those calls would silently shrink every total. But "we assumed" is not "we know", so
 * the dashboard counts these separately and says how many it assumed rather than letting a reader
 * believe the inbound figure was measured.
 */
export function hasRecordedDirection(direction: string | undefined): boolean {
  return Boolean((direction || "").trim());
}
