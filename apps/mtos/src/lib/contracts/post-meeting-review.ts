import type {
  CaseStatus,
  RiskRegisterEntry,
  RiskTier,
  StakeholderMapEntry,
} from "@/src/lib/mtos-data";

/**
 * The rules behind the post-meeting review, with nothing attached.
 *
 * One review, one submission. The account manager picks the score, then decides every ticket, the
 * Risk Register entry, the Stakeholder Map entry and the client email on the same screen, and
 * presses one button. Nothing is created, written or filed before that press, and the press is
 * their approval for exactly what they approved -- nothing more.
 *
 * The score comes first because it is a gate, not a label: a 6 or below makes the Risk Register
 * entry mandatory, and that has to be decided before the AM reasons about anything else. These
 * rules live here, away from the screen and away from ClickUp, so both the screen and the server
 * ask the same question and can be checked without either.
 */

// ---------------------------------------------------------------------------
// The score
// ---------------------------------------------------------------------------

/**
 * The band an account sits in, per the NPS / Account Health Score guideline.
 *
 * The score is the AM's own judgement of the account, not something the client said out loud. A
 * client never gives a number, so nothing here or downstream may describe it as the client's.
 */
export function npsBand(nps: number): string {
  if (nps >= 9) return "Healthy";
  if (nps >= 7) return "Stable with friction";
  if (nps >= 5) return "At risk";
  if (nps >= 3) return "Critical";
  return "Churn imminent";
}

/**
 * The line in the Health Tracker, derived from the score: 9-10 Good, 7-8 Neutral, 6 and below Risk.
 *
 * Returns null for a score that was never given, which is not the same as a bad score and must not
 * be written to the row as one.
 */
export function healthFromNps(nps: number | null): "Good" | "Neutral" | "Risk" | null {
  if (nps === null) return null;
  if (nps >= 9) return "Good";
  if (nps >= 7) return "Neutral";
  return "Risk";
}

/**
 * The one hard rule of this step: a score of 6 or below REQUIRES a Risk Register entry.
 *
 * A score of 7 or above does not. That is the whole gate -- it is not a suggestion, a nudge or a
 * tone, and it is evaluated from the score the AM confirmed rather than from how the call read.
 * A score that was never given cannot require anything, so it returns false and the missing score
 * is reported on its own.
 */
export function riskRegisterRequired(nps: number | null): boolean {
  return nps !== null && nps <= 6;
}

/** What the AM must also do when the score is 6 or below, beyond the register itself. */
export const LOW_SCORE_OBLIGATIONS = [
  "Run the matching red-flag playbook.",
  "@-tag the Manager in the client channel.",
];

// ---------------------------------------------------------------------------
// Completeness of each entry
// ---------------------------------------------------------------------------

/**
 * Risk Score is the count of threat fields answered "Yes" -- an answered "No" counts as answered,
 * not as a flag. Six fields, so 0 through 6.
 */
export function riskFlagCount(entry: RiskRegisterEntry): number {
  return [
    entry.money,
    entry.responsiveness,
    entry.lifeChange,
    entry.technical,
    entry.otherAgency,
    entry.performance,
  ].filter((value) => value === "Yes").length;
}

/** Risk Tier follows the count: 0 Healthy, 1 Low, 2-3 Medium, 4-5 High, 6 Critical. */
export function riskTierFromFlagCount(count: number): RiskTier {
  if (count >= 6) return "Critical";
  if (count >= 4) return "High";
  if (count >= 2) return "Medium";
  if (count === 1) return "Low";
  return "Healthy";
}

/** The case status a tier implies, as a starting point the AM can change. */
export function caseStatusFromTier(tier: RiskTier): CaseStatus {
  return tier === "Healthy" ? "Resolved-Healthy" : tier === "Low" ? "Watching" : "Working";
}

/**
 * The fields the Risk Register entry needs before it can be approved.
 *
 * Every one of them, because a half-filled entry does not show in the Risk Register view at all:
 * a client with a case status and a flag date but no threat answers, score, tier or category is
 * invisible there, which looks exactly like never having been logged. Each threat field needs an
 * explicit answer -- "No" is an answer, blank is not.
 */
export const RISK_REGISTER_MUST_FIELDS: { key: keyof RiskRegisterEntry; label: string }[] = [
  { key: "caseStatus", label: "Case Status" },
  { key: "money", label: "Money / Cash Flow" },
  { key: "responsiveness", label: "Responsiveness" },
  { key: "lifeChange", label: "Life Change" },
  { key: "technical", label: "Technical Challenge" },
  { key: "otherAgency", label: "Other Agency / Advisor" },
  { key: "performance", label: "Performance" },
  { key: "riskTier", label: "Risk Tier" },
  { key: "dateFlagged", label: "Date Flagged" },
  { key: "nextAction", label: "Next Action" },
  { key: "nextActionOwner", label: "Next Action Owner" },
  { key: "primaryCategory", label: "Primary Category" },
];

/** The Risk Register fields still empty, by their ClickUp names, for the AM to fill. */
export function riskRegisterGaps(entry: RiskRegisterEntry): string[] {
  const gaps = RISK_REGISTER_MUST_FIELDS.filter(({ key }) => {
    const value = entry[key];
    return value === undefined || value === null || String(value).trim() === "";
  }).map(({ label }) => label);
  // Risk Score is derived from the threat answers rather than typed, so it is only missing while
  // they are -- reporting it separately would send the AM looking for a field they can't fill.
  return gaps;
}

export const STAKEHOLDER_MUST_FIELDS: { key: keyof StakeholderMapEntry; label: string }[] = [
  { key: "clientName", label: "Client Name" },
  { key: "role", label: "Role / Title" },
  { key: "communicationPreference", label: "Communication Preference" },
  { key: "marketingLiteracy", label: "Marketing Literacy" },
  { key: "personality", label: "Personality Styles" },
  { key: "whatTheyCareAbout", label: "What They Care About" },
];

/** The Stakeholder Map fields still empty. Email is excluded: it is only known when given. */
export function stakeholderMapGaps(entry: StakeholderMapEntry): string[] {
  return STAKEHOLDER_MUST_FIELDS.filter(({ key }) => {
    const value = entry[key];
    return value === undefined || value === null || String(value).trim() === "";
  }).map(({ label }) => label);
}

// ---------------------------------------------------------------------------
// Whether the whole review can be submitted
// ---------------------------------------------------------------------------

export type EntryDecision = "approved" | "declined" | undefined;

export interface ReviewSubmission {
  /** The score the AM picked. null means they explicitly recorded no score. */
  nps: number | null;
  npsReason: string;
  /** Whether the score has been picked at all, as distinct from being recorded as absent. */
  npsChosen: boolean;
  tickets: {
    decision: EntryDecision;
    title: string;
    description: string;
    ticketType?: string;
    billingChangeType?: string;
  }[];
  risk?: { decision: EntryDecision; entry: RiskRegisterEntry; offered: boolean };
  stakeholder?: { decision: EntryDecision; entry: StakeholderMapEntry; offered: boolean };
  email: { subject: string; body: string; approve: boolean };
}

/**
 * Everything standing between this review and being submitted, in the AM's own words.
 *
 * Returned as a list rather than a boolean so the screen can show exactly what is left and the
 * server can refuse with the same sentences. An empty list means the submission is complete and
 * every decision on it is the AM's.
 *
 * Note what is NOT a blocker: declining a required Risk Register entry. The AM is allowed to
 * decline it -- the notes then carry an open "Log the client in the Risk Register" line marked as
 * skipped at review, which is honest, where a block would just trap them on the screen.
 */
export function reviewBlockers(submission: ReviewSubmission): string[] {
  const blockers: string[] = [];

  if (!submission.npsChosen) {
    blockers.push(
      "Pick the NPS / Account Health score. It is the first line of the notes, and a 6 or below is what makes the Risk Register entry mandatory.",
    );
  } else if (!submission.npsReason.trim()) {
    blockers.push("Write one short line on why this score — a few words in your own voice is enough.");
  }

  const undecided = submission.tickets.filter((ticket) => !ticket.decision).length;
  if (undecided) {
    blockers.push(`Decide the remaining ${undecided === 1 ? "ticket" : `${undecided} tickets`} — approve or deny each one.`);
  }

  const emptyApproved = submission.tickets.filter(
    (ticket) => ticket.decision === "approved" && (!ticket.title.trim() || !ticket.description.trim()),
  ).length;
  if (emptyApproved) {
    blockers.push(
      `${emptyApproved === 1 ? "An approved ticket is" : `${emptyApproved} approved tickets are`} missing a name or a description.`,
    );
  }

  const billingWithoutType = submission.tickets.filter(
    (ticket) => ticket.decision === "approved" && ticket.ticketType === "billing" && !ticket.billingChangeType,
  ).length;
  if (billingWithoutType) {
    blockers.push("A billing ticket needs its change type before it can be filed.");
  }

  // A required entry has to be decided -- approving or declining are both decisions, leaving it
  // untouched is not, because the score already says this client belongs in the register.
  if (riskRegisterRequired(submission.nps)) {
    if (!submission.risk?.offered) {
      blockers.push(
        "This score requires a Risk Register entry and MTOS has none to show. Re-run the client intelligence step, or log the client in the Risk Register by hand.",
      );
    } else if (!submission.risk.decision) {
      blockers.push(
        `A score of ${submission.nps} requires a Risk Register entry. Approve it, or deny it and log the client by hand.`,
      );
    }
  }

  if (submission.risk?.decision === "approved") {
    const gaps = riskRegisterGaps(submission.risk.entry);
    if (gaps.length) {
      blockers.push(
        `The Risk Register entry still needs ${gaps.join(", ")}. A half-filled entry doesn't show in the Risk Register view at all.`,
      );
    }
  }

  if (submission.stakeholder?.decision === "approved") {
    const gaps = stakeholderMapGaps(submission.stakeholder.entry);
    if (gaps.length) {
      blockers.push(
        `The Stakeholder Map entry still needs ${gaps.join(", ")}. The client only shows in the Stakeholder Map view once its own fields are filled.`,
      );
    }
  }

  if (submission.email.approve && !(submission.email.subject.trim() && submission.email.body.trim())) {
    blockers.push("The client recap email needs a subject and a body before you can approve it.");
  }

  return blockers;
}

/**
 * The open item left in the notes when a required Risk Register entry was declined.
 *
 * Kept as a sentence rather than a flag because it is read by the AM in the filed document, where
 * "skipped at review" has to be visible as something still owed rather than quietly absent.
 */
export const RISK_REGISTER_SKIPPED_NOTE =
  "Log the client in the Risk Register — skipped at review, AM to log. The score of 6 or below requires it.";
