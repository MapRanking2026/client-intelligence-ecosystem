import type { ClientType, RiskRegisterEntry, StakeholderMapEntry } from "@/src/lib/mtos-data";
import { riskFlagCount, riskTierFromFlagCount } from "@/src/lib/contracts/post-meeting-review";

/**
 * The three trackers a monthly touch updates, and what counts as a change to one.
 *
 * All three already exist in ClickUp with a row per client, so none of this is "fill in a form".
 * It is "here is the row as it stands, here is what this call changes about it" -- which is why
 * every field carries what it was. An AM approving a row they cannot see the previous value of
 * is approving a silent overwrite, and the Health Tracker is read by people who were not on the
 * call and will not know a number moved.
 *
 * The one place this file deliberately disagrees with the code beside it is `healthFromScore`.
 * See the note on it.
 */

// ---------------------------------------------------------------------------
// The Client Health Tracker's Account Health row
// ---------------------------------------------------------------------------

export type CaseStatusValue = "—" | "Watching" | "Working" | "downgraded";
export type CommunicationType = "Normal" | "Distant" | "Needy";
export type UpsellingValue = "Yes!" | "Possible" | "No way";
export type HealthValue = "Good" | "Neutral" | "Risk";

export const CASE_STATUS_VALUES: CaseStatusValue[] = ["—", "Watching", "Working", "downgraded"];
export const COMMUNICATION_TYPES: CommunicationType[] = ["Normal", "Distant", "Needy"];
export const UPSELLING_VALUES: UpsellingValue[] = ["Yes!", "Possible", "No way"];
export const HEALTH_VALUES: HealthValue[] = ["Good", "Neutral", "Risk"];
export const CLIENT_TYPES: ClientType[] = ["Direct", "White Label"];

export interface HealthTrackerRow {
  clientName?: string;
  startDate?: string;
  assignee?: string;
  clientType?: ClientType;
  accountManager?: string;
  /** From the confirmed score. Read-only here: the score gate owns it. */
  nps?: number | null;
  status?: string;
  caseStatus?: CaseStatusValue;
  communicationType?: CommunicationType;
  mrr?: string;
  upselling?: UpsellingValue;
  health?: HealthValue;
  email?: string;
  services?: string[];
  servicesUpsell?: string[];
  latestComment?: string;
}

/**
 * The Health field's default, from the confirmed score: 7 and up Good, 5-6 Neutral, 4 and down Risk.
 *
 * This is the handoff's mapping, and it is NOT the same as `healthFromNps` in the post-meeting
 * review contract, which reads 9-10 Good, 7-8 Neutral, 6 and below Risk. Both are in the codebase
 * on purpose: that one is what the existing review screen has been writing to this tracker, and
 * changing it would silently re-grade every client the old screen touches. Whichever is right,
 * they should not quietly be two -- this needs an answer from whoever owns the Health Tracker.
 */
export function healthFromScore(score: number | null | undefined): HealthValue | undefined {
  if (score === null || score === undefined) return undefined;
  if (score >= 7) return "Good";
  if (score >= 5) return "Neutral";
  return "Risk";
}

// ---------------------------------------------------------------------------
// Field descriptions, shared by the editor and the diff
// ---------------------------------------------------------------------------

export type FieldKind = "text" | "longText" | "date" | "select" | "multi" | "readonly";

export interface TrackerField<TRow> {
  key: keyof TRow & string;
  /** The field's name in ClickUp, which is the name the AM is looking for. */
  label: string;
  kind: FieldKind;
  options?: readonly string[];
}

export const HEALTH_TRACKER_FIELDS: TrackerField<HealthTrackerRow>[] = [
  { key: "clientName", label: "Client Name", kind: "text" },
  { key: "startDate", label: "Start date", kind: "date" },
  { key: "assignee", label: "Assignee", kind: "text" },
  { key: "clientType", label: "Client Type", kind: "select", options: CLIENT_TYPES },
  { key: "accountManager", label: "Account Manager", kind: "text" },
  { key: "nps", label: "NPS", kind: "readonly" },
  { key: "status", label: "Status", kind: "text" },
  { key: "caseStatus", label: "Case Status", kind: "select", options: CASE_STATUS_VALUES },
  { key: "communicationType", label: "Communication Type", kind: "select", options: COMMUNICATION_TYPES },
  { key: "mrr", label: "MRR", kind: "text" },
  { key: "upselling", label: "Upselling", kind: "select", options: UPSELLING_VALUES },
  { key: "health", label: "Health", kind: "select", options: HEALTH_VALUES },
  { key: "email", label: "Email", kind: "text" },
  { key: "services", label: "Services", kind: "multi" },
  { key: "servicesUpsell", label: "Services Upsell", kind: "multi" },
  { key: "latestComment", label: "Latest comment", kind: "longText" },
];

export const RISK_REGISTER_FIELDS: TrackerField<RiskRegisterEntry>[] = [
  { key: "accountManager", label: "Assignee", kind: "text" },
  { key: "clientType", label: "Client Type", kind: "select", options: CLIENT_TYPES },
  { key: "caseStatus", label: "Case Status", kind: "text" },
  { key: "dateFlagged", label: "Date Flagged", kind: "date" },
  { key: "money", label: "Money / Cash Flow", kind: "select", options: ["—", "Yes", "No"] },
  { key: "responsiveness", label: "Responsiveness", kind: "select", options: ["—", "Yes", "No"] },
  { key: "lifeChange", label: "Life Change", kind: "select", options: ["—", "Yes", "No", "maybe"] },
  { key: "technical", label: "Technical Challenge", kind: "select", options: ["—", "Yes", "No"] },
  { key: "otherAgency", label: "Other Agency / Advisor", kind: "select", options: ["—", "Yes", "No", "kind of"] },
  { key: "performance", label: "Performance", kind: "select", options: ["—", "Yes", "No"] },
  { key: "riskScore", label: "Risk Score", kind: "readonly" },
  { key: "riskTier", label: "Risk Tier", kind: "text" },
  { key: "primaryCategory", label: "Primary Category", kind: "text" },
  { key: "nextAction", label: "Next Action", kind: "text" },
  { key: "nextActionOwner", label: "Next Action Owner", kind: "text" },
  { key: "dueDate", label: "Due date", kind: "date" },
  { key: "lastMonthlyTouch", label: "Last Client Touchpoint", kind: "date" },
  { key: "latestComments", label: "Latest comment", kind: "longText" },
];

export const STAKEHOLDER_FIELDS: TrackerField<StakeholderMapEntry>[] = [
  { key: "clientName", label: "Client Name", kind: "text" },
  { key: "assignee", label: "Assignee", kind: "text" },
  { key: "clientType", label: "Client Type", kind: "select", options: CLIENT_TYPES },
  { key: "services", label: "Services", kind: "multi" },
  { key: "role", label: "Role / Title", kind: "text" },
  {
    key: "communicationPreference",
    label: "Communication Preference",
    kind: "select",
    options: ["Email", "Face-to-Face", "Phone", "Text/Chat"],
  },
  { key: "marketingLiteracy", label: "Marketing Literacy", kind: "select", options: ["Low", "Medium", "High"] },
  { key: "personality", label: "Personality Style", kind: "text" },
  { key: "whatTheyCareAbout", label: "What They Care About", kind: "longText" },
  { key: "knownHistory", label: "Known History / Context", kind: "longText" },
];

// ---------------------------------------------------------------------------
// The diff
// ---------------------------------------------------------------------------

export interface FieldDiff {
  key: string;
  label: string;
  kind: FieldKind;
  /** What the row says now, rendered. "" when the field was empty. */
  was: string;
  /** What this touch would make it, rendered. */
  now: string;
  changed: boolean;
  /** True when the row had nothing here before -- filling a blank is not overwriting an answer. */
  isNew: boolean;
}

/** One value as it reads on screen, so "was" and "now" are compared like for like. */
export function renderValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry).trim())
      .filter(Boolean)
      .sort()
      .join(", ");
  }
  return String(value).trim();
}

/**
 * What this touch changes about a row, field by field.
 *
 * Compared on the rendered value rather than the raw one, so a list reordered by ClickUp is not
 * a change and neither is a stray space. Filling an empty field is reported as new rather than
 * changed: there is no previous answer to lose, and treating the two the same buries the handful
 * of real overwrites in a wall of yellow.
 */
export function diffRow<TRow extends object>(
  current: Partial<TRow> | undefined,
  next: Partial<TRow>,
  fields: TrackerField<TRow>[],
): FieldDiff[] {
  return fields.map((field) => {
    const was = renderValue(current?.[field.key]);
    const now = renderValue(next[field.key]);
    return {
      key: field.key,
      label: field.label,
      kind: field.kind,
      was,
      now,
      changed: was !== now && was !== "",
      isNew: was === "" && now !== "",
    };
  });
}

/** How many fields this touch actually changes, for the card's header chip. */
export function changeCount(diffs: FieldDiff[]): { changed: number; added: number } {
  return {
    changed: diffs.filter((diff) => diff.changed).length,
    added: diffs.filter((diff) => diff.isNew).length,
  };
}

// ---------------------------------------------------------------------------
// The cards
// ---------------------------------------------------------------------------

export type TrackerDecision = "approved" | "denied" | "deleted";

export type TrackerCardKind = "health" | "risk" | "stakeholder";

interface TrackerCardBase {
  id: string;
  /** True when no row exists in ClickUp yet -- the card creates one rather than updating one. */
  isNewRow?: boolean;
  decision?: TrackerDecision;
}

/**
 * A card, discriminated by which tracker it writes to.
 *
 * A union rather than one generic card so each kind's row keeps its own type: a Risk Register
 * entry and a Health Tracker row share several field names with different value sets, and a
 * single loose shape would let a Case Status from one be written into the other.
 */
export type TrackerCard =
  | (TrackerCardBase & {
      kind: "health";
      current?: Partial<HealthTrackerRow>;
      next: Partial<HealthTrackerRow>;
    })
  | (TrackerCardBase & {
      kind: "risk";
      current?: RiskRegisterEntry;
      next: RiskRegisterEntry;
    })
  | (TrackerCardBase & {
      kind: "stakeholder";
      /** The person this card is about. */
      personName?: string;
      current?: StakeholderMapEntry;
      next: StakeholderMapEntry;
    });

/** The derived Risk Register fields, recomputed rather than trusted from the screen. */
export function withDerivedRiskFields(entry: RiskRegisterEntry): RiskRegisterEntry {
  const count = riskFlagCount(entry);
  return { ...entry, riskScore: count, riskTier: riskTierFromFlagCount(count) };
}

/**
 * What is stopping the tracker cards being processed.
 *
 * A denied or deleted card is decided and clears. An approved one has to carry something: a card
 * that changes nothing is not an update, it is a write that touches a live row for no reason.
 */
export function trackerBlockers(
  cards: TrackerCard[],
  diffsById: Record<string, FieldDiff[]>,
): string[] {
  const blockers: string[] = [];

  const undecided = cards.filter((card) => !card.decision).length;
  if (undecided) {
    blockers.push(
      `Decide the remaining ${undecided === 1 ? "tracker card" : `${undecided} tracker cards`} — approve, deny or delete each one.`,
    );
  }

  for (const card of cards.filter((candidate) => candidate.decision === "approved")) {
    const diffs = diffsById[card.id] || [];
    const { changed, added } = changeCount(diffs);
    if (!changed && !added && !card.isNewRow) {
      blockers.push(
        `The ${cardLabel(card)} changes nothing. Deny it rather than writing to a live row for no reason.`,
      );
    }
  }

  return blockers;
}

export function cardLabel(card: TrackerCard): string {
  switch (card.kind) {
    case "health":
      return "Client Health Tracker row";
    case "risk":
      return "Risk Register row";
    default:
      return `Stakeholder card for ${card.personName || "this person"}`;
  }
}
