import { normalizeChips, type SourceChip } from "@/src/lib/contracts/brief-sources";
import { htmlToMarkdown } from "@/src/lib/contracts/rich-text";

/**
 * The Pre-Monthly Touch brief: the whole document the account manager reviews before the call,
 * and the same content that is posted to the Client's Book.
 *
 * This replaces the "five questions" review. Five questions were a summary of a preparation that
 * had already been written in full, so the AM reviewed the summary, walked into the call, and met
 * the detail for the first time while the client was listening.
 *
 * ## Two numbering systems, mapped on purpose
 *
 * The preparation agent (MT-002) writes its sections under the numbering of the manual skill it
 * came from: `R` retention, `0` the QC feedback loop, then `1`–`16`. The brief the AM reads is
 * numbered the way the team reads it: 1 promises, 2 retention, 3 snapshot, and so on to 15, the
 * client-facing agenda email. Both are in the handoff, and neither is wrong -- so rather than
 * renumbering one of them and leaving the other to drift, the agent keeps its numbering and
 * `PROMPT_SECTION_TO_BRIEF` maps it onto the brief. Three of the agent's sections (SEO & GBP,
 * Google Ads, Meta Ads) fold into one brief section, each as its own subheading, which is why the
 * map carries a subtitle.
 *
 * ## What the AM can do to it
 *
 * Edit any section, or decline it. A declined section is not deleted: it stays in the record, and
 * is excluded from the Client's Book post and from the live call guide or deck. There are no
 * per-section approvals -- one approval covers the brief, which is the whole point of the single
 * submission (see `touch-progress`).
 */

/** The sections of the brief as the AM reads them. `h` is the header, `15` the client email. */
export type BriefSectionId =
  | "h"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "11"
  | "12"
  | "13"
  | "14"
  | "15";

export interface BriefSectionMeta {
  id: BriefSectionId;
  /** What the rail and the table of contents show: `i` for the header, else the number. */
  n: string;
  title: string;
  /** One line on what this section is for, shown under the title. */
  purpose: string;
  /** Declinable sections are the fourteen numbered ones. The header and the email are not. */
  declinable: boolean;
}

export const BRIEF_SECTIONS: BriefSectionMeta[] = [
  {
    id: "h",
    n: "i",
    title: "Brief header",
    purpose: "Who, when, what data — and what is still missing.",
    declinable: false,
  },
  {
    id: "1",
    n: "1",
    title: "Before this call: previous promises",
    purpose: "What we promised last time, and whether it was delivered.",
    declinable: true,
  },
  {
    id: "2",
    n: "2",
    title: "Retention assessment",
    purpose: "Risk level and what the call must secure.",
    declinable: true,
  },
  { id: "3", n: "3", title: "Client snapshot", purpose: "Orient yourself in 30 seconds.", declinable: true },
  {
    id: "4",
    n: "4",
    title: "Opening questions",
    purpose: "Business context first — let them talk.",
    declinable: true,
  },
  {
    id: "5",
    n: "5",
    title: "Look-back",
    purpose: "Reconnect to the last conversation and check the money.",
    declinable: true,
  },
  {
    id: "6",
    n: "6",
    title: "Spoken call agenda",
    purpose: "Read this aloud after the opening.",
    declinable: true,
  },
  {
    id: "7",
    n: "7",
    title: "Open items",
    purpose: "Who owes what — get a date for every client item.",
    declinable: true,
  },
  { id: "8", n: "8", title: "Wins", purpose: "Results, with what they mean for the business.", declinable: true },
  {
    id: "9",
    n: "9",
    title: "Issues and what we're doing",
    purpose: "Every issue arrives with a plan, an owner and a date.",
    declinable: true,
  },
  {
    id: "10",
    n: "10",
    title: "Service performance review",
    purpose: "GBP, SEO, Google Ads and Meta in detail — declines and recoveries.",
    declinable: true,
  },
  { id: "11", n: "11", title: "Goal", purpose: "A measurable definition of success.", declinable: true },
  {
    id: "12",
    n: "12",
    title: "Growth opportunities",
    purpose: "Practical next moves, grounded in where this client is now.",
    declinable: true,
  },
  {
    id: "13",
    n: "13",
    title: "Marketing content discovery",
    purpose: "Stories, assets and feedback worth capturing.",
    declinable: true,
  },
  {
    id: "14",
    n: "14",
    title: "Live recap and close",
    purpose: "Last 5–7 minutes: agreements, owners, dates, next touch.",
    declinable: true,
  },
  {
    id: "15",
    n: "15",
    title: "Client-facing agenda",
    purpose: "The email the client receives before the call.",
    declinable: false,
  },
];

export const DECLINABLE_SECTION_IDS: BriefSectionId[] = BRIEF_SECTIONS.filter(
  (section) => section.declinable,
).map((section) => section.id);

export function briefSection(id: BriefSectionId): BriefSectionMeta | undefined {
  return BRIEF_SECTIONS.find((section) => section.id === id);
}

/**
 * The preparation agent's own section numbering, mapped onto the brief.
 *
 * `16`, the pre-call checklist, has no brief section of its own: the handoff's brief ends at 15.
 * It is rendered as the footer of the review screen, so it is still the last thing the AM reads
 * before the call, which is what the prompt asks for.
 */
export const PROMPT_SECTION_TO_BRIEF: Record<string, { brief: BriefSectionId; subtitle?: string }> = {
  r: { brief: "2" },
  R: { brief: "2" },
  "0": { brief: "1" },
  "1": { brief: "3" },
  "2": { brief: "4" },
  "3": { brief: "5" },
  "4": { brief: "6" },
  "5": { brief: "7" },
  "6": { brief: "8" },
  "7": { brief: "9" },
  "8": { brief: "10", subtitle: "SEO & Google Business Profile" },
  "9": { brief: "10", subtitle: "Google Ads" },
  "10": { brief: "10", subtitle: "Meta Ads" },
  "11": { brief: "11" },
  "12": { brief: "12" },
  "13": { brief: "13" },
  "14": { brief: "14" },
  "15": { brief: "15" },
};

// ---------------------------------------------------------------------------
// What the preparation agent returns
// ---------------------------------------------------------------------------

/** A missing, stale or conflicting input. First thing on the brief, every time. */
export interface BriefGap {
  item: string;
  whyItMatters: string;
  /** What the AM should ask live, or check before the call. */
  askOrCheck: string;
}

export type PromiseStatus = "delivered" | "not_delivered" | "unknown";

export interface BriefPromise {
  what: string;
  byWhen: string;
  status: PromiseStatus;
  source: string;
  /** How to own it on the call when it was not delivered. */
  howToOwnIt: string;
  chips?: SourceChip[];
}

/**
 * A coaching item or a QC proposal.
 *
 * Always a proposal, never an order: QC reads the call, not the sales promise or the client's
 * history, so the AM is the one who decides. `agreedWithJavier` marks the compliance corrections
 * that are not up for discussion -- and only those.
 */
export interface BriefProposal {
  id: string;
  idea: string;
  why: string;
  howItCouldSound: string;
  whenToSkip: string;
  agreedWithJavier?: boolean;
  chips?: SourceChip[];
}

export interface BriefRetention {
  /** 0 = no retention level applies, so section 2 says so rather than inventing a risk. */
  level: 0 | 1 | 2 | 3;
  /** Markdown for section 2. Absent at level 0. */
  section?: string;
}

/** One section of the brief as written by the agent, before the AM's edits. */
export interface BriefSectionContent {
  /** The brief's id, already mapped from the agent's numbering. */
  id: BriefSectionId;
  /** Present when several of the agent's sections fold into one brief section. */
  subtitle?: string;
  title: string;
  markdown: string;
  chips?: SourceChip[];
}

export interface AgendaReadAloud {
  opener: string;
  items: string[];
  closeMinutes: number;
}

export type AgendaChannel = "email" | "text" | "whatsapp" | "ghl" | "partner";

export interface ClientAgendaEmail {
  channel: AgendaChannel;
  whiteLabel: boolean;
  subject: string;
  items: string[];
  ask: string;
  length: string;
  link: string;
  signoff: string;
  /**
   * What stops this being sent: a missing date, time zone, meeting link or length. Non-empty
   * blocks the send, because send-ready wording with a placeholder in it reaches the client.
   */
  blockingGaps: string[];
}

export interface UnreportedSeoWin {
  win: string;
  shippedOn: string;
  source: string;
}

export interface PrepBrief {
  gaps: BriefGap[];
  retention: BriefRetention;
  promises: BriefPromise[];
  /** At most three active coaching behaviours for this AM. */
  focus: BriefProposal[];
  proposals: BriefProposal[];
  sections: BriefSectionContent[];
  agendaReadAloud?: AgendaReadAloud;
  clientAgendaEmail?: ClientAgendaEmail;
  unreportedSeoWins: UnreportedSeoWin[];
  /** When the agent wrote this, so the review can say how fresh it is. */
  generatedAt?: string;
}

export const EMPTY_PREP_BRIEF: PrepBrief = {
  gaps: [],
  retention: { level: 0 },
  promises: [],
  focus: [],
  proposals: [],
  sections: [],
  unreportedSeoWins: [],
};

// ---------------------------------------------------------------------------
// Reading what the agent returned
// ---------------------------------------------------------------------------

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * A section's id as the model wrote it.
 *
 * The contract asks for `"id": "1"`, and `str` would read a number as nothing at all -- so a model
 * that answers `"id": 1`, which is the more natural JSON for a number and costs it nothing, would
 * have every one of its sections dropped on the floor with no error anywhere. The brief would read
 * "the preparation did not write this section" fifteen times over a response that wrote all
 * fifteen. Numbers are read, a `Section 4` or `#4` prefix is tolerated, and `R` keeps its letter.
 *
 * Nothing here invents an id: a value that carries no id still comes back empty and is still
 * dropped.
 */
function sectionId(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return str(value)
    .replace(/^#/, "")
    .replace(/^section\s*/i, "")
    .replace(/[.:]$/, "")
    .trim();
}

function strings(value: unknown, limit = 20): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(str).filter(Boolean).slice(0, limit);
}

function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object");
}

function promiseStatus(value: unknown): PromiseStatus {
  const text = str(value).toLowerCase();
  if (text === "delivered") return "delivered";
  if (text === "not_delivered" || text === "not delivered") return "not_delivered";
  // Anything else is unknown rather than a guess: "delivered" is a claim about our own word, and
  // reading it out of a value nobody recognised is how a brief tells an AM we kept a promise we
  // did not keep.
  return "unknown";
}

function agendaChannel(value: unknown): AgendaChannel {
  const text = str(value).toLowerCase();
  if (text === "text" || text === "sms") return "text";
  if (text === "whatsapp") return "whatsapp";
  if (text === "ghl" || text === "gohighlevel") return "ghl";
  if (text === "partner") return "partner";
  return "email";
}

function proposals(value: unknown, prefix: string, limit: number): BriefProposal[] {
  return rows(value)
    .map((row, index) => ({
      id: str(row.id) || `${prefix}-${index + 1}`,
      idea: str(row.idea),
      why: str(row.why),
      howItCouldSound: str(row.howItCouldSound),
      whenToSkip: str(row.whenToSkip),
      ...(row.agreedWithJavier === true ? { agreedWithJavier: true } : {}),
      chips: normalizeChips(row.chips),
    }))
    .filter((entry) => entry.idea)
    .slice(0, limit);
}

/**
 * Read the agent's output into a brief.
 *
 * Tolerant on purpose and never throws. A model that returns fourteen good sections and one
 * malformed one should cost the AM that one section, not the whole preparation -- the alternative
 * is a blank screen half an hour before a client call. Anything unrecognisable is dropped rather
 * than rendered, and a dropped section shows as "not generated" so the gap is visible.
 */
export function normalizePrepBrief(raw: unknown, generatedAt?: string): PrepBrief {
  if (!raw || typeof raw !== "object") return { ...EMPTY_PREP_BRIEF, ...(generatedAt ? { generatedAt } : {}) };
  const row = raw as Record<string, unknown>;

  const retentionRaw = (row.retention || {}) as Record<string, unknown>;
  const levelValue = Number(retentionRaw.level);
  const level: BriefRetention["level"] =
    levelValue === 1 || levelValue === 2 || levelValue === 3 ? levelValue : 0;

  // Each section is kept with the agent's own id as a second sort key. Three of the agent's
  // sections fold into brief section 10, and they have to come out in the agent's order -- SEO,
  // then Google Ads, then Meta -- rather than in whatever order the model happened to emit them,
  // or the AM reads the paid-media numbers under the SEO heading's lead-in.
  const collected: { promptRank: number; section: BriefSectionContent }[] = [];
  for (const entry of rows(row.sections)) {
    const promptId = sectionId(entry.id);
    const mapped = PROMPT_SECTION_TO_BRIEF[promptId];
    const markdown = str(entry.markdown);
    if (!mapped || !markdown) continue;
    collected.push({
      promptRank: promptRank(promptId),
      section: {
        id: mapped.brief,
        ...(mapped.subtitle ? { subtitle: mapped.subtitle } : {}),
        title: str(entry.title) || briefSection(mapped.brief)?.title || "",
        markdown,
        chips: normalizeChips(entry.chips),
      },
    });
  }
  // Retention arrives as its own field rather than in `sections`, so fold it in as section 2.
  if (level > 0 && str(retentionRaw.section)) {
    collected.push({
      promptRank: promptRank("r"),
      section: { id: "2", title: briefSection("2")!.title, markdown: str(retentionRaw.section) },
    });
  }
  collected.sort(
    (a, b) => briefOrder(a.section.id) - briefOrder(b.section.id) || a.promptRank - b.promptRank,
  );
  const sections: BriefSectionContent[] = collected.map((entry) => entry.section);

  const email = (row.clientAgendaEmail || {}) as Record<string, unknown>;
  const agenda = (row.agendaReadAloud || {}) as Record<string, unknown>;
  const closeMinutes = Number(agenda.closeMinutes);

  return {
    gaps: rows(row.missing)
      .map((entry) => ({
        item: str(entry.item),
        whyItMatters: str(entry.whyItMatters),
        askOrCheck: str(entry.askOrCheck),
      }))
      .filter((entry) => entry.item),
    retention: { level, ...(str(retentionRaw.section) ? { section: str(retentionRaw.section) } : {}) },
    promises: rows(row.qcPromises)
      .map((entry) => ({
        what: str(entry.what),
        byWhen: str(entry.byWhen),
        status: promiseStatus(entry.status),
        source: str(entry.source),
        howToOwnIt: str(entry.howToOwnIt),
        chips: normalizeChips(entry.chips),
      }))
      .filter((entry) => entry.what),
    // Three is the cap in the prompt, and it is a real cap: an AM given eight behaviours to work
    // on in one call works on none of them.
    focus: proposals(row.qcFocus, "focus", 3),
    proposals: proposals(row.qcProposals, "proposal", 10),
    sections,
    ...(str(agenda.opener) || strings(agenda.items).length
      ? {
          agendaReadAloud: {
            opener: str(agenda.opener),
            items: strings(agenda.items, 7),
            closeMinutes: Number.isFinite(closeMinutes) && closeMinutes > 0 ? closeMinutes : 7,
          },
        }
      : {}),
    ...(str(email.subject) || strings(email.items).length
      ? {
          clientAgendaEmail: {
            channel: agendaChannel(email.channel),
            whiteLabel: email.whiteLabel === true,
            subject: str(email.subject),
            items: strings(email.items, 5),
            ask: str(email.ask),
            length: str(email.length),
            link: str(email.link),
            signoff: str(email.signoff),
            blockingGaps: strings(email.blockingGaps),
          },
        }
      : {}),
    unreportedSeoWins: rows(row.unreportedSeoWins)
      .map((entry) => ({ win: str(entry.win), shippedOn: str(entry.shippedOn), source: str(entry.source) }))
      .filter((entry) => entry.win),
    ...(generatedAt ? { generatedAt } : {}),
  };
}

/** The agent's own section order, used only to break ties inside one brief section. */
const PROMPT_ORDER = Object.keys(PROMPT_SECTION_TO_BRIEF);

function promptRank(promptId: string): number {
  const index = PROMPT_ORDER.indexOf(promptId);
  return index < 0 ? PROMPT_ORDER.length : index;
}

function briefOrder(id: BriefSectionId): number {
  const index = BRIEF_SECTIONS.findIndex((section) => section.id === id);
  return index < 0 ? BRIEF_SECTIONS.length : index;
}

// ---------------------------------------------------------------------------
// What the review screen renders
// ---------------------------------------------------------------------------

export type SectionState = "written" | "edited" | "declined" | "missing";

export interface ReviewSection extends BriefSectionMeta {
  state: SectionState;
  /** The agent's blocks for this section; several when its subsections fold together. */
  blocks: BriefSectionContent[];
  /** The AM's replacement text, when they edited it. */
  edited?: string;
}

/**
 * The sections in order, with what the AM has done to each.
 *
 * Every section in the registry is returned, including the ones the agent did not write: a brief
 * that silently omits the goal reads as a brief with no goal, when what happened is that the
 * preparation could not find one. `missing` says so on the screen.
 */
export function reviewSections(
  brief: PrepBrief,
  review?: { declinedSections?: string[]; sectionEdits?: Record<string, string> },
): ReviewSection[] {
  const declined = new Set(review?.declinedSections || []);
  const edits = review?.sectionEdits || {};
  return BRIEF_SECTIONS.map((meta) => {
    const blocks = brief.sections.filter((section) => section.id === meta.id);
    const edited = edits[meta.id];
    const state: SectionState = declined.has(meta.id)
      ? "declined"
      : edited
        ? "edited"
        : blocks.length || meta.id === "h" || meta.id === "15"
          ? "written"
          : "missing";
    return { ...meta, state, blocks, ...(edited ? { edited } : {}) };
  });
}

/** The declinable sections that will be posted to the Client's Book and drive the live call. */
export function approvedSectionIds(review?: { declinedSections?: string[] }): BriefSectionId[] {
  const declined = new Set(review?.declinedSections || []);
  return DECLINABLE_SECTION_IDS.filter((id) => !declined.has(id));
}

/** What the single approval button says it will do, so it is never a surprise. */
export function approvalSummary(review?: { declinedSections?: string[] }): {
  approving: number;
  declined: BriefSectionId[];
} {
  const declined = DECLINABLE_SECTION_IDS.filter((id) =>
    new Set(review?.declinedSections || []).has(id),
  );
  return { approving: DECLINABLE_SECTION_IDS.length - declined.length, declined };
}

// ---------------------------------------------------------------------------
// What gets posted to the Client's Book
// ---------------------------------------------------------------------------

/**
 * The approved brief as one markdown page.
 *
 * Only the sections the AM did not decline, in brief order, with the AM's own edits in place of
 * the generated text where they made one. Three things are deliberate.
 *
 * **Declined sections leave a line, not a hole.** `Section 7 — Issues and what we are doing:
 * declined` tells next month's preparation that this was considered and left out. Silently
 * dropping it is indistinguishable from the preparation never writing it.
 *
 * **A section the preparation could not write says so**, for the same reason, and because the page
 * is what the AM reads during the call.
 *
 * **The missing-evidence list goes at the top.** The prompt puts it there, and it is the one part
 * of the brief that changes what the AM does in the first five minutes of the call.
 */
export function approvedBriefMarkdown(
  brief: PrepBrief,
  review: { declinedSections?: string[]; sectionEdits?: Record<string, string> } | undefined,
  options: { clientName: string; callLabel: string; accountManager?: string },
): string {
  const declined = new Set(review?.declinedSections || []);
  const edits = review?.sectionEdits || {};
  const out: string[] = [
    options.clientName
      ? `# Pre-Monthly Touch brief — ${options.clientName}`
      : "# Pre-Monthly Touch brief",
    "",
    [`Call: ${options.callLabel}`, options.accountManager ? `Account manager: ${options.accountManager}` : ""]
      .filter(Boolean)
      .join(" · "),
    "",
  ];

  if (brief.gaps.length) {
    out.push("## ⚠️ Missing — confirm before or during the call", "");
    for (const gap of brief.gaps) {
      const why = gap.whyItMatters ? ` — ${gap.whyItMatters}` : "";
      const ask = gap.askOrCheck ? ` _Ask or check: ${gap.askOrCheck}_` : "";
      out.push(`- **${gap.item}**${why}${ask}`);
    }
    out.push("");
  }

  for (const meta of BRIEF_SECTIONS) {
    if (meta.id === "h" || !meta.declinable) continue;
    const heading = `## ${meta.n}. ${meta.title}`;
    if (declined.has(meta.id)) {
      out.push(heading, "", "_Declined by the account manager — left out of this call._", "");
      continue;
    }
    const edited = edits[meta.id];
    if (edited) {
      out.push(heading, "", htmlToMarkdown(edited), "");
      continue;
    }
    const blocks = brief.sections.filter((section) => section.id === meta.id);
    if (!blocks.length) {
      out.push(heading, "", "_The preparation did not write this section._", "");
      continue;
    }
    out.push(heading, "");
    for (const block of blocks) {
      if (block.subtitle) out.push(`### ${block.subtitle}`, "");
      out.push(block.markdown.trim(), "");
    }
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
