/**
 * The preparation document's own output contract.
 *
 * MTOS already carries the full Monthly Touch preparation prompt in the Prompt Engine
 * (`monthly_touch_preparation_prompt`, the account-review instructions), but its output contract
 * only ever allowed a small JSON object -- one `executiveBrief` string plus a few lists. So the
 * document the original prompt actually specifies, with its numbered sections, its conditional
 * Retention section and its two closing sections, had nowhere to go: it was squeezed into one
 * paragraph field whose shape depended entirely on the model, could not be rendered section by
 * section, and could not be filed as a document.
 *
 * This module is the missing half: the section catalogue and the instructions that produce it.
 * The research instructions stay where they are; nothing here replaces them.
 *
 * The catalogue below is the original numbering, verbatim, including section 0 before section 1 and
 * the rule that 15 and 16 always close the document. The numbers are the AM's and the QC's shared
 * vocabulary ("Section 14, the Live Recap & Close"), so they are stable identifiers, not display
 * decoration.
 */

export const PREP_DOCUMENT_PROMPT_KEY = "monthly_touch_prep_document_prompt";

export interface PrepSectionSpec {
  /** The original prompt's own number. "R" is the conditional Retention section. */
  id: string;
  title: string;
  /**
   * Required sections are written even when the inputs are sparse -- the document explains the
   * limitation instead of omitting the section. A conditional section is omitted only when it
   * genuinely does not apply (no retention level; the channel is not active).
   */
  required: boolean;
  /** When a conditional section applies, in words the model is given. */
  appliesWhen?: string;
  /** What this section must contain. Condensed from the original prompt, not reinvented. */
  guidance: string;
}

/**
 * The document, in order. Section 0 first, the conditional Retention section next, then 1 to 16.
 *
 * Several blocks the MTOS research prompt names separately (MISSING DATA, LEADS/SALES & OPERATIONS,
 * PROPOSED 30-DAY PLAN, MEETING FORMAT OPTIONS, PRESENTATION APPROACH) are folded into the numbered
 * section they belong to rather than dropped: the missing-evidence banner sits above section 0, the
 * funnel analysis closes the two ads sections and section 8, and the plan and format notes sit in
 * section 14 and section 16. Nothing in either prompt loses its home.
 */
export const PREP_DOCUMENT_SECTIONS: PrepSectionSpec[] = [
  {
    id: "0",
    title: "From your last QCs — what we promised + proposals for you to decide",
    required: true,
    guidance: [
      "Keep it to one screen. Three parts, in this order.",
      "1) 'Before this call: what we promised' -- facts, not proposals. Every commitment with a date from the look-back sources and every open post-touch item. For each: what it was, by when, and whether it was delivered (delivered / not delivered / cannot verify) with the source that says so. If something was not delivered, say so plainly and suggest how the AM can own it on the call.",
      "2) 'Your focus for this call' -- at most three coaching behaviours for this AM, when coaching evidence was supplied.",
      "3) 'Proposals from your last QC for this client' -- content questions, strategy ideas, client questions left unanswered.",
      "Every focus item and proposal uses the proposal format and never an order: Idea (one plain sentence) / Why (which call, date, what happened and why it matters, written so someone who was not on the call understands it) / How it could sound (an example to adapt, never a script) / When to skip it / Your call: Use, Adapt or Skip plus a reason.",
      "Mark a compliance correction 'agreed with Javier' only when that approval was actually supplied. If no QC or coaching evidence was supplied, say so in one line and do not invent commitments.",
    ].join("\n"),
  },
  {
    id: "R",
    title: "Retention",
    required: false,
    appliesWhen:
      "a retention level applies (results trending down, complaints, a strained relationship, a cancel/pause/downgrade request, or withheld payment)",
    guidance: [
      "Level 1 (course-correct): a short diagnosis and one or two corrective actions.",
      "Levels 2-3 (recover / save): the full retention brief -- what happened, root causes, an accusation audit, the plan agreed internally before the call, the offer envelope with the approval it needs, the contact cadence, and the ask.",
      "State the evidence for the level. Any offer, discount or credit is a proposal that needs the manager's approval; never write it as agreed.",
    ].join("\n"),
  },
  {
    id: "1",
    title: "Quick Client Snapshot",
    required: true,
    guidance:
      "Three to five lines: who this client is, the market and services, what they care most about, the account's condition on the evidence supplied, and the single thing the AM needs to nail on this call.",
  },
  {
    id: "2",
    title: "Opening Questions for the AM to Ask",
    required: true,
    guidance: [
      "Four or five natural questions to open the call. Genuine interest, not a checklist. Adapt the wording to this client's industry and services.",
      "Cover the month overall, new leads or inquiries, how many became jobs, what is in the pipeline, and anything that felt off.",
      "Include the numeric goal question (jobs, revenue or calls, with a timeframe) unless a confirmed numeric goal is already on file -- section 11 depends on it.",
    ].join("\n"),
  },
  {
    id: "3",
    title: "Look-Back: Last Touch Follow-Through",
    required: true,
    guidance: [
      "Four to eight lines plus the billing line.",
      "What we promised last time, each marked done / in progress / not done with one line. Anything not done also belongs in section 7 with a plan -- the client must never be the one to remind us.",
      "Whether the post-touch actions from the last call were completed (notes, tickets, recap, health tracker), and what is still open.",
      "Client questions never answered, from the transcript, emails or QC -- answer these early in the call.",
      "What the client cared about most last time, in their own words with the date, to reconnect to in the opening.",
      "Billing check: do the services billed match the services delivered? Any discount ending, failed payment, open billing-change ticket, refund or credit promised? Flag anything to fix before the call, and note anything that may change on the call.",
      "If this is the first Monthly Touch, use the Success Call or onboarding notes instead and say that is what you used.",
    ].join("\n"),
  },
  {
    id: "4",
    title: "Meeting Agenda (AM reads this out loud)",
    required: true,
    guidance: [
      "A short script the AM uses to open: 'here is what we are going to cover today so we make the best use of your time', then five to seven crisp bullets drawn from the active services and the open issues.",
      "This must match the agenda already finalized in the preparation and communicated to the client in the confirmation email. Do not introduce agenda items the client was not told about.",
      "Reserve the last five to seven minutes for the close (section 14).",
    ].join("\n"),
  },
  {
    id: "5",
    title: "Open Items Check",
    required: true,
    guidance: [
      "Two clearly separated lists.",
      "'Map Ranking - internal': each item with its status (done / in progress / blocked) and one line on what was done or why it is delayed. Highlight overdue and blocked items without unsupported blame.",
      "'Client-side - pending from the client': anything the client still owes (photos, review responses, access, approvals). Flag what is overdue, phrased gently but clearly.",
    ].join("\n"),
  },
  {
    id: "6",
    title: "Wins to Present",
    required: true,
    guidance: [
      "Two to four real positives from the evidence, most business-critical first. Fewer is correct when the evidence is thin; never manufacture a win.",
      "Each win: what happened (the metric or event, with its period and source), and what it means for the business in leads, visibility, calls or revenue.",
      "Add a natural way for the AM to say it out loud.",
    ].join("\n"),
  },
  {
    id: "7",
    title: "Issues + What We Are Already Doing About It",
    required: true,
    guidance: [
      "Every material issue: state it simply, then immediately what the team is already doing, who is handling it, and the expected outcome and timeframe. Never leave an issue without a plan attached.",
      "Include the business impact and the supported explanation or hypothesis. Mark what still needs confirmation or approval.",
      "Do not invent delivery dates, owners or promised outcomes. The AM must never sound surprised: if it is in the data, we already know about it.",
    ].join("\n"),
  },
  {
    id: "8",
    title: "SEO & GBP Performance Review",
    required: true,
    guidance: [
      "Subsections, each only when that service is active: Rank Tracker / heatmap summary (which zones improved, held or dropped, and what that means geographically for this business); GBP performance over the last 30 days (the two or three measures that matter most for this client, with any unusual drop or spike explained); Map Check-ins / CTR activity; roadmap progress against the plan; call-log spot-check (how many of the reviewed calls were qualified, and any pattern in how calls were handled).",
      "Then: two or three questions the client is likely to ask with the recommended answer and its evidence -- where an answer is not known, give the honest response and the verification step.",
      "Close with 'Next steps - SEO': three to five specific actions, each with an owner (Map Ranking team or client).",
      "Use an implementation percentage only when one was supplied or can be defensibly calculated. State the period of every figure.",
    ].join("\n"),
  },
  {
    id: "9",
    title: "Google Ads Review",
    required: false,
    appliesWhen: "Google Ads or Local Services Ads is an active service with data supplied",
    guidance: [
      "30-day summary: spend, leads, cost per lead, stated plainly, and whether CPL is trending up or down and why.",
      "Lead quality: were the leads any good, backed by the call-log review where available. Flag anything that looks like wasted spend.",
      "Business discovery -- operations and sales alignment: do NOT run this every month. Use it only when the data suggests a disconnect between the leads we generate and what the business does with them, or when we do not know enough about how the business operates. Draw on phone handling and speed to lead, the appointment-setting process, how their clients decide, and CRM and pipeline visibility. If it is already documented, confirm briefly instead.",
      "Recommendations: two or three concrete things to test or change next month -- negative keywords, bid adjustments, a new copy angle, budget reallocation. If discovery revealed a sales or operations gap, one recommendation must address that, not only the campaign.",
      "Next steps - Ads: actions for the PPC team. Tag any sales-process or CRM issue for the AM to follow up separately.",
    ].join("\n"),
  },
  {
    id: "10",
    title: "Meta Ads Review",
    required: false,
    appliesWhen: "Meta Ads is an active service with data supplied",
    guidance: [
      "30-day summary: spend, leads, cost per lead, best-performing creative or offer.",
      "What is working and what is not, bluntly, with the reason.",
      "Business discovery -- audience, offer and sales fit: same rule as Google Ads, only when there is a signal (high lead volume with low conversion usually means an audience, offer-clarity or post-click mismatch). Draw on who they are actually trying to reach, how the offer lands, how their clients decide, follow-up and nurturing, and where Meta leads are tracked.",
      "Recommendations: fresh creative direction, an offer test or an audience adjustment, based on both the data and what discovery revealed. Include any structural sales or operations gap with a recommended next step.",
      "Next steps - Meta: actions for the paid social team.",
    ].join("\n"),
  },
  {
    id: "11",
    title: "Client Goal & Revenue Pace Check",
    required: true,
    guidance: [
      "Every Monthly Touch must leave a numeric goal written down -- leads, booked jobs or revenue, with a timeframe.",
      "If a goal is on file: state it, the current pace on this month's evidence, whether the client is on track, behind or ahead, and what we do about it either way.",
      "If no goal is on file: prepare the question for this call and a fallback number to propose if the client does not have one. Do not defer it to a form, and never imply a revenue figure we were not given.",
    ].join("\n"),
  },
  {
    id: "12",
    title: "Growth Opportunities",
    required: true,
    guidance: [
      "One to three realistic next moves for where this client is right now. For each: the evidence behind it, what has to be true first, the benefit to this client specifically, and how confident we are.",
      "Only suggest what makes sense for this client -- not a generic list of services.",
    ].join("\n"),
  },
  {
    id: "13",
    title: "Marketing Content Plan (Moment Engineering)",
    required: true,
    guidance: [
      "Categories in priority order: Pain, Objection, Reaction, Insight, Proof, Tool Feedback. Raw honest moments are worth more than polished praise.",
      "Prepare four triggers (pain, insight, transformation or reaction, active-tool feedback) but plan to ask only two or three. Adapt the wording; never read them as a script.",
      "A) Missed moments to reopen from earlier calls, notes or QC: what the client said (quote, date and timestamp when known), its category, why it matters, and one natural question to reopen it. Never invent a quote.",
      "B) Questions built from this month's wins: show the result, stop talking, then the reaction question, then one deeper question.",
      "C) One or two pain or objection questions that fit this client right now.",
      "D) One insight to share first, then 'did you know that?' -- do not invent platform news.",
      "E) A tool feedback question, only for products the client actually has.",
      "F) Three to five 'if the client says X, ask Y' cues so the AM can catch unplanned moments.",
      "G) Whether this client fits the content collaboration programme, and whether a review request for Map Ranking fits this month -- if not, write 'Not this month'.",
      "H) Where each chosen question goes in the section 4 agenda.",
      "Capture rules for the AM: record the call, read the consent line, and if the client declines recording turn the automated notes off too. Introduce, pause, capture. After the call, tag each moment and hand it off with the recording link, timestamps and why it matters.",
    ].join("\n"),
  },
  {
    id: "14",
    title: "Live Recap & Close (last 5-7 minutes, before hanging up)",
    required: true,
    guidance: [
      "Write this so the AM can read it straight off the page. Six steps, all done live.",
      "1) Recap the meeting live: two or three major wins in one sentence each, the open issues and their status, and the decisions the client made today.",
      "2) Our actions -- what Map Ranking will do, each with an owner and a date.",
      "3) The client's pending items -- read each one out loud and ask when they can have it to us; write the date next to it. Nobody leaves the call without a date.",
      "4) Follow-up preference -- which channel and which contact.",
      "5) Promise the recap email, and say it arrives today, within 24 business hours, with our actions, their pending items and dates, the goal number agreed, and the next meeting date. If a billing change was agreed, repeat the new amount and when it starts, and note it for the billing ticket.",
      "6) Book the next Monthly Touch live -- date and time in the client's time zone, invite sent on the call, attendees confirmed.",
      "Then the proposed 30-day plan: Map Ranking actions and client actions separately, each with the action, owner where known, the business reason, priority, any dependency and a proposed checkpoint. Mark clearly which dates are proposed and which are agreed.",
      "Do not mark any closing item complete before it happens.",
    ].join("\n"),
  },
  {
    id: "15",
    title: "Client-Facing Agenda (draft to send)",
    required: true,
    guidance: [
      "This is the short friendly agenda the client receives 24-48 hours before the call, through their usual channel. It is not the internal prep: no internal notes, scores, ticket identifiers, coaching, retention labels or anything sensitive. Never put credentials in it.",
      "A subject or first line with the confirmed meeting date, time and the client's time zone; three to five plain-language outcome-focused items; one ask (their calls, booked jobs and approximate revenue this month, so the goal can be set); the call length and meeting link; a warm close with the AM's name.",
      "When the confirmation email has already been approved in MTOS, reproduce that approved wording here so the document and what the client was told are the same. Say whether it has been sent yet, and never claim it was sent when it was not.",
      "Above the draft, add the note: check that every item is accurate and is what you actually want to discuss with the client, edit anything that does not fit, then send it.",
    ].join("\n"),
  },
  {
    id: "16",
    title: "Before Your Call — Confirm All of These",
    required: true,
    guidance: [
      "Close the document with this checklist, written to the AM in a supportive tone, covering: the prep is filed in the Client's Book under Client Meetings Notes for this meeting date; the agenda in section 15 was checked and sent, with the date and channel noted; 30 minutes blocked right after the call for the post-touch work, to be finished within 24 business hours; a 10-minute call with the relevant project manager when a strategic item needs the team's input, recorded, before the tickets are finalized; recording on, consent line ready, goal question ready, content-capture checklist ticked; five to seven minutes left at the end for the Live Recap & Close in section 14; and right after the call, share the recording and transcript with support@mapranking.com and notify the manager so the QC can run.",
      "Add: mark your choice on each proposal in section 0 before the call, and after the call note in the post-touch notes which ones you used and how they landed.",
      "End encouragingly -- the preparation is the hard part.",
    ].join("\n"),
  },
];

/** The sections a complete document must contain, whatever the inputs look like. */
export const REQUIRED_PREP_SECTION_IDS = PREP_DOCUMENT_SECTIONS.filter((s) => s.required).map((s) => s.id);

/**
 * The document's writing standard and output contract.
 *
 * Kept as a module constant rather than only a Prompt Engine row because the section catalogue is
 * a structural requirement of the workflow -- the filing, the QC and the post-meeting notes all
 * address sections by number -- and an edit in a settings screen must not be able to remove the
 * document's spine. The Prompt Engine row, when present, is layered on top of this.
 */
export const PREP_DOCUMENT_SYSTEM_PROMPT = [
  "You are writing the Pre-Monthly Touch Preparation & Agenda document for an Account Manager at Map Ranking.",
  "It is read during a live client call, so it has to be scannable, concrete and true.",
  "",
  "WHO YOU ARE WRITING FOR",
  "Write like a sharp colleague briefing another colleague, not like a consultant writing a formal report.",
  "Many account managers read English as a second language: short sentences, one idea per sentence, no idioms and no slang.",
  "Never use internal codes, tracker identifiers, criterion numbers or rubric labels. Say what they mean instead.",
  "Numbers always carry their meaning and their period: '3 calls from the Google profile in October, down from 14 in August', never 'calls 14 to 3'.",
  "A ClickUp item is named, with its link, never a bare identifier.",
  "Bold anything the AM has to say out loud or pay special attention to.",
  "The test for every item: could an account manager who was not on the last call act on this without asking anyone? If not, rewrite it.",
  "",
  "TONE",
  "Translate numbers into business meaning -- leads, booked jobs, revenue, phone calls -- never a bare metric.",
  "Be proactive, not reactive: for every problem, the AM already has a plan. The client must never feel they found an issue before we did.",
  "Warm and confident. The AM is the most prepared person in the room, not aggressive and not apologetic.",
  "Keep the tone toward the AM encouraging and practical. This document helps them prepare; it is not an evaluation of them.",
  "",
  "EVIDENCE DISCIPLINE (these override everything else)",
  "Every claim, number, win, issue and recommendation must trace to something in the input bundle.",
  "Never invent a quote, a number, a date, a timestamp, an owner or a client statement. If a moment cannot be traced to a source, leave it out.",
  "Missing information is written as an em dash and named in the missing list. Never write 0 for something you were not given.",
  "Do not claim an email was sent, received, missing or unanswered unless the bundle says both Intercom and the support inbox were checked. Say which sources were checked.",
  "Nothing in this document may state that a message was sent, an invite created, a payment collected or a ticket created. Those are separate approved actions.",
  "Everything is a proposal until the client agrees to it. Mark proposed dates as proposed and unknown owners as unknown.",
  "Never include passwords, login codes or other credentials.",
  "",
  "OUTPUT",
  "Return a single JSON object and nothing else. No markdown fences, no commentary.",
  '{"missing": ["..."], "sections": [{"id": "<section id exactly as given>", "markdown": "<the section body in markdown, without its heading>", "skippedReason": "<only for a conditional section that does not apply>"}]}',
  "Return one entry for every section id you were asked for, in the order you were asked for them.",
  "`missing` is the material missing, stale or conflicting evidence: what is missing, why it matters, and what the AM should check or ask. If there is no material gap, return an empty list -- do not claim every system is complete.",
  "`markdown` holds the section body only. Do not repeat the section number or title inside it.",
  "Use `###` for subheadings inside a section, short bullets, and bold for what must be said out loud.",
  "A required section is always written, even when the inputs are sparse: write what the evidence supports and state the limitation. Never return an empty body for a required section.",
  "For a conditional section that genuinely does not apply, return an empty markdown and one plain sentence in `skippedReason`.",
].join("\n");
