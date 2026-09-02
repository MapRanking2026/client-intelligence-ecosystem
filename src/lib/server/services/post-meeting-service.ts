import { nanoid } from "nanoid";
import { z } from "zod";

import type { TenantContext } from "@/src/lib/contracts/mtos";
import type {
  ClientEmailDraft,
  ClientRecord,
  DraftTicket,
  BillingChangeType,
  MonthlyTouchRecord,
  PostMeetingReview,
  TicketDepartment,
  TicketPriority,
  TicketType,
} from "@/src/lib/mtos-data";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { getServerEnv } from "@/src/lib/server/env";
import { getIntegrationConnection, getIntegrationCredentials } from "@/src/lib/server/integrations";
import { callLlmForJson, getNowIso, hasAnyLlmProvider, stripUndefinedDeep } from "@/src/lib/server/services/mtos-ai";
import { getPromptText } from "@/src/lib/server/prompt-store";
import { getAccountManagerIdentity } from "@/src/lib/server/services/user-service";
import {
  applyDashboardDecisions,
  draftDashboardUpdates,
} from "@/src/lib/server/services/dashboard-intelligence-service";
import type { DashboardUpdateReview } from "@/src/lib/mtos-data";

const departmentEnum = z.enum(["SEO", "Web Design", "Ads", "Account Manager", "Other"]);

const analysisSchema = z.object({
  recapSummary: z.string().min(1),
  extractedCommitments: z.array(z.string().min(1)).max(10),
  draftTickets: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().min(1),
        department: departmentEnum,
        // Optional: the model's suggested assignee, chosen from the provided roster.
        suggestedAssignee: z.string().optional(),
        // Optional: suggested priority + effort so the ticket form fields start filled.
        priority: z.enum(["urgent", "high", "normal", "low"]).optional(),
        timeEstimateHours: z.number().optional(),
        // Classification: "billing" for anything touching pricing/MRR, else "regular".
        ticketType: z.enum(["regular", "billing"]).optional(),
        billingChangeType: z
          .enum(["Upsell", "Downsell", "New Sale", "Pause", "Cancel", "Payment Failed"])
          .optional(),
      }),
    )
    .max(8),
  clientEmailSubject: z.string().min(1),
  clientEmailBody: z.string().min(1),
});

/**
 * Flatten an LLM value that should be a short string. The model often returns a
 * commitment as an object (e.g. { commitment, owner, dueDate }) rather than a
 * plain string, which would fail `z.string()`. Pull the primary text out and
 * append owner/due-date style qualifiers so no detail is lost.
 */
function coerceText(value: unknown, joiner = " — "): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((entry) => coerceText(entry, joiner)).filter(Boolean).join(joiner);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const primaryKeys = [
      "commitment",
      "text",
      "summary",
      "description",
      "title",
      "task",
      "action",
      "item",
      "detail",
      "name",
    ];
    const parts: string[] = [];
    for (const key of primaryKeys) {
      const part = record[key];
      const text = typeof part === "string" ? part.trim() : "";
      if (text && !parts.includes(text)) parts.push(text);
    }
    let text = parts.join(joiner);
    if (!text) {
      // Nothing on the known keys -- fall back to any string values on the object.
      text = Object.values(record)
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
        .join(joiner);
    }
    const qualifiers: string[] = [];
    for (const key of ["owner", "assignee", "responsible", "dueDate", "due", "deadline", "timeline"]) {
      const part = record[key];
      if (typeof part === "string" && part.trim()) qualifiers.push(`${key}: ${part.trim()}`);
    }
    if (qualifiers.length) text = text ? `${text} (${qualifiers.join(", ")})` : qualifiers.join(", ");
    return text.trim();
  }
  return "";
}

/** Map whatever the model calls the department onto the fixed enum. */
function coerceDepartment(value: unknown): z.infer<typeof departmentEnum> {
  const text = coerceText(value).toLowerCase();
  if (/web|site|design|\bdev\b|wordpress/.test(text)) return "Web Design";
  if (/seo|search|ranking|gbp|listing/.test(text)) return "SEO";
  if (/\bads?\b|ppc|paid|adwords|meta|campaign/.test(text)) return "Ads";
  if (/account|manager|\bam\b|relationship|success/.test(text)) return "Account Manager";
  return "Other";
}

/** Coerce the model's priority wording onto the four ClickUp levels. */
function coercePriority(value: unknown): "urgent" | "high" | "normal" | "low" | undefined {
  const text = coerceText(value).toLowerCase();
  if (!text) return undefined;
  if (/urgent|critical|asap|immediate|emergency/.test(text)) return "urgent";
  if (/high|important|soon/.test(text)) return "high";
  if (/low|minor|whenever|someday|backlog/.test(text)) return "low";
  if (/normal|medium|standard|routine/.test(text)) return "normal";
  return undefined;
}

/** Coerce free text onto one of the billing-change categories. */
function coerceBillingChangeType(value: unknown): BillingChangeType | undefined {
  const text = coerceText(value).toLowerCase();
  if (!text) return undefined;
  if (/pay(ment)?\s*fail|declin|nsf|charge\s*fail/.test(text)) return "Payment Failed";
  if (/down\s*sell|downgrade|reduce|lower/.test(text)) return "Downsell";
  if (/up\s*sell|upgrade|add[- ]?on|additional|extra|new gbp|another gbp/.test(text)) return "Upsell";
  if (/new\s*(sale|sell|client|account|deal)/.test(text)) return "New Sale";
  if (/pause|hold|freeze|suspend/.test(text)) return "Pause";
  if (/cancel|churn|terminate|offboard/.test(text)) return "Cancel";
  return undefined;
}

/** Decide whether a ticket is a billing-change ticket, and its category. */
function coerceTicketType(
  typeValue: unknown,
  billingTypeValue: unknown,
): { ticketType?: TicketType; billingChangeType?: BillingChangeType } {
  const typeText = coerceText(typeValue).toLowerCase();
  const billingChangeType = coerceBillingChangeType(billingTypeValue) || coerceBillingChangeType(typeValue);
  const looksBilling =
    /bill|invoice|pric|discount|coupon|refund|charge|subscription|\bmrr\b|payment|upsell|downsell|cancel|pause/.test(
      typeText,
    ) || Boolean(billingChangeType);
  if (looksBilling) {
    return { ticketType: "billing", billingChangeType };
  }
  return { ticketType: "regular" };
}

/** Convert an ISO/date-ish string to a YYYY-MM-DD value for a date input. */
function toDateInputValue(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10);
}

/** Coerce a time estimate (number of hours, or strings like "5h" / "90m") to hours. */
function coerceHours(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const text = coerceText(value).toLowerCase().trim();
  if (!text) return undefined;
  const minutesMatch = text.match(/(\d+(?:\.\d+)?)\s*m(?:in)?/);
  const hoursMatch = text.match(/(\d+(?:\.\d+)?)\s*h/);
  if (hoursMatch) return parseFloat(hoursMatch[1]);
  if (minutesMatch) return parseFloat(minutesMatch[1]) / 60;
  const bare = parseFloat(text);
  return Number.isFinite(bare) && bare > 0 ? bare : undefined;
}

/**
 * Coerce the raw LLM object into the exact shape `analysisSchema` expects, so a
 * model that returns commitments-as-objects or emits more than the max number of
 * items degrades gracefully (flattened + trimmed) instead of throwing a Zod
 * validation error that surfaces as a wall of red in the UI.
 */
function normalizePostMeetingAnalysis(raw: Record<string, unknown>) {
  const commitments = (Array.isArray(raw.extractedCommitments) ? raw.extractedCommitments : [])
    .map((entry) => coerceText(entry))
    .filter(Boolean)
    .slice(0, 10);

  const rawTickets = Array.isArray(raw.draftTickets) ? raw.draftTickets : [];
  const draftTickets = rawTickets
    .map((entry) => {
      const item = (entry ?? {}) as Record<string, unknown>;
      return {
        title: coerceText(item.title ?? item.name ?? item.headline),
        description: coerceText(item.description ?? item.detail ?? item.summary ?? item.body ?? item.notes),
        department: coerceDepartment(item.department ?? item.team ?? item.category ?? item.type),
        suggestedAssignee: coerceText(item.suggestedAssignee ?? item.assignee ?? item.owner) || undefined,
        priority: coercePriority(item.priority ?? item.urgency),
        timeEstimateHours: coerceHours(item.timeEstimateHours ?? item.timeEstimate ?? item.estimateHours ?? item.hours),
        ...coerceTicketType(item.ticketType, item.billingChangeType ?? item.billingType),
      };
    })
    .filter((ticket) => ticket.title && ticket.description)
    .slice(0, 8);

  const emailBody = raw.clientEmailBody ?? raw.emailBody ?? raw.email ?? raw.body;

  return {
    recapSummary: coerceText(raw.recapSummary ?? raw.recap ?? raw.summary),
    extractedCommitments: commitments,
    draftTickets,
    clientEmailSubject: coerceText(raw.clientEmailSubject ?? raw.emailSubject ?? raw.subject),
    // Preserve paragraph breaks for the email body rather than the "—" joiner.
    clientEmailBody: coerceText(emailBody, "\n\n"),
  };
}

async function analyzeWithClaude(
  env: ReturnType<typeof getServerEnv>,
  touch: MonthlyTouchRecord,
  client: ClientRecord,
  transcript: string,
  accountManagerName: string,
  memberNames: string[],
) {
  const system = await getPromptText("meeting_transcript_analysis_prompt");
  const amName = accountManagerName.trim() || client.accountManager?.trim() || "the account manager";

  const assigneeDirective = memberNames.length
    ? [
        "draftTickets items may ALSO include suggestedAssignee: the name of the ONE teammate from the",
        "roster below best suited to the ticket (match the work to the department/skill in the name when",
        "you can). Use the name EXACTLY as it appears in the roster. If you are not reasonably sure, omit",
        "suggestedAssignee -- do not guess. Roster: " + memberNames.join(", ") + ".",
        "",
      ]
    : [];

  const userText = [
    "Return a JSON object with keys: recapSummary, extractedCommitments, draftTickets,",
    "clientEmailSubject, clientEmailBody.",
    "recapSummary: a single string. clientEmailSubject/clientEmailBody: single strings.",
    "extractedCommitments: an array of AT MOST 10 plain strings (each one sentence -- NOT objects).",
    "draftTickets: an array of AT MOST 8 objects, each { title, description, department },",
    'where department is one of "SEO", "Web Design", "Ads", "Account Manager", "Other".',
    "Each ticket SHOULD also include priority (one of \"urgent\", \"high\", \"normal\", \"low\" based on how",
    "time-sensitive the work is from the conversation) and timeEstimateHours (a realistic number of",
    "hours of effort, e.g. 0.5, 2, 5).",
    "TICKET TYPE: set ticketType to \"billing\" for ANYTHING that changes what the client pays -- a",
    "discount, coupon, pricing agreement, upsell, downsell, new sale, an added or removed GBP/service,",
    "a pause, a cancellation, or a payment/charge issue. For those, also set billingChangeType to one",
    'of "Upsell", "Downsell", "New Sale", "Pause", "Cancel", "Payment Failed". Everything else (the',
    'actual optimization/implementation work) is ticketType "regular". When in doubt about billing, make',
    "a SEPARATE billing ticket for the money part in addition to any regular work ticket.",
    ...assigneeDirective,
    `VOICE: You ARE ${amName}, the account manager, writing these tickets yourself. Write every`,
    "ticket title and description in the FIRST PERSON (\"I need\", \"Please\", \"Can you\") addressed",
    "directly to the teammate or department who will do the work. Never write in the third person and",
    `never refer to "the AM" or "${amName}" as someone else -- that is you.`,
    `CONTEXT: Every ticket is for the client "${client.name}". Make it explicit in each ticket`,
    `description which business the work is for (name the business "${client.name}"), so whoever picks`,
    "it up knows the client without extra digging.",
    "",
    JSON.stringify(
      {
        accountManager: amName,
        client: {
          businessName: client.name,
          industry: client.industry,
          contact: client.contact,
          accountManager: client.accountManager || amName,
        },
        touchExecutiveBrief: touch.executiveBrief,
        touchWins: touch.wins,
        touchRisks: touch.risks,
        transcript,
      },
      null,
      2,
    ),
  ].join("\n");

  // The analysis emits a recap, up to 10 commitments, up to 8 draft tickets
  // (title + description + department each), plus a full client email subject
  // and body -- 1800 truncated the JSON mid-array, which then fails to parse.
  const result = await callLlmForJson({ env, system, userText, maxTokens: 8000 });
  // Normalize before validating so the model returning objects-as-commitments or
  // overshooting the item caps degrades gracefully instead of failing schema validation.
  const analysis = analysisSchema.parse(normalizePostMeetingAnalysis(result.data));
  return { analysis, provider: result.provider, model: result.model };
}

export async function analyzePostMeetingTranscript(context: TenantContext, touchId: string, transcript: string) {
  const trimmedTranscript = transcript.trim();
  if (trimmedTranscript.length < 40) {
    throw new Error("Paste the full meeting transcript (at least a few sentences) before analyzing.");
  }

  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firebase Admin must be configured before post-meeting analysis can run");
  }

  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }

  // No-duplicates rule: once this touch's follow-up has been filed to ClickUp,
  // block re-analysis so a refresh or re-paste can't regenerate and re-create the
  // same tickets. A fresh touch is the way to start a new set.
  const existingPostMeeting = touch.postMeeting;
  const alreadyFiled =
    existingPostMeeting?.status === "approved" ||
    (existingPostMeeting?.draftTickets || []).some((ticket) => ticket.clickupTaskId);
  if (alreadyFiled) {
    throw new Error(
      "This touch's follow-up tickets have already been created in ClickUp. Re-analyzing is blocked to prevent duplicates -- start a new monthly touch if you need a fresh set.",
    );
  }

  const client = await dataSource.getClientById(touch.clientId);
  if (!client) {
    throw new Error("Monthly touch client is not visible for the current user");
  }

  const env = getServerEnv();
  if (!hasAnyLlmProvider(env)) {
    throw new Error("No AI provider is configured (set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY), so transcript analysis can't run.");
  }

  const { name: accountManagerName } = await getAccountManagerIdentity(context);

  // Pull the real ClickUp members + business options so we can PRE-FILL each draft
  // ticket's assignee and business (both stay editable on the review screen).
  const [{ members }, { businesses }] = await Promise.all([
    listAssignableMembers(context).catch(() => ({ members: [] as AssignableMember[] })),
    listBusinessOptions(context).catch(() => ({ businesses: [] as BusinessOption[] })),
  ]);

  const { analysis, model } = await analyzeWithClaude(
    env,
    touch,
    client,
    trimmedTranscript,
    accountManagerName,
    members.map((member) => member.name),
  );

  // Default business = the client's own business, matched to a ClickUp option.
  const defaultBusinessId = resolveBusinessOptionId(businesses, client.name);
  const defaultBusiness = businesses.find((business) => business.id === defaultBusinessId);
  const memberOptions = members.map((entry) => ({ id: String(entry.id), name: entry.name }));

  // Billing tickets are routed to Carlos Camacho -- resolve him once (editable later).
  const billingAssigneeName = process.env.CLICKUP_BILLING_ASSIGNEE || "Carlos Camacho";
  const billingMember = matchDropdownOption(memberOptions, billingAssigneeName);
  // Default "date it was requested" for billing tickets = the touch/meeting date.
  const touchDateString = toDateInputValue(touch.scheduledAt) || toDateInputValue(getNowIso());

  const draftTickets: DraftTicket[] = analysis.draftTickets.map((ticket) => {
    const isBilling = ticket.ticketType === "billing";

    // Match the model's suggested assignee to a real member (unambiguously) so the
    // dropdown starts pre-selected; the AM can still change it. Billing tickets
    // default to Carlos.
    const suggested = ticket.suggestedAssignee?.trim();
    const suggestedMember = suggested ? matchDropdownOption(memberOptions, suggested) : undefined;
    const member = isBilling ? billingMember || suggestedMember : suggestedMember;

    const timeEstimateMinutes =
      typeof ticket.timeEstimateHours === "number" && ticket.timeEstimateHours > 0
        ? Math.round(ticket.timeEstimateHours * 60)
        : 60;

    return {
      id: `ticket-${nanoid(8)}`,
      title: ticket.title,
      description: ticket.description,
      department: ticket.department,
      assigneeId: member ? Number(member.id) : undefined,
      assignee: member?.name,
      businessOptionId: defaultBusiness?.id,
      businessName: defaultBusiness?.name || client.name,
      priority: ticket.priority || "normal",
      timeEstimateMinutes,
      ticketType: ticket.ticketType || "regular",
      billingChangeType: isBilling ? ticket.billingChangeType : undefined,
      dateRequested: isBilling ? touchDateString : undefined,
      status: "pending",
    };
  });

  // Client Intelligence Dashboard Updater -- one additional post-processing step
  // inserted after transcript analysis. It only drafts proposed Risk Register /
  // Stakeholder Map updates; it writes nothing here. It is deliberately
  // non-fatal: if it fails, transcript analysis still succeeds unchanged.
  let dashboardUpdates: DashboardUpdateReview | undefined;
  try {
    dashboardUpdates = await draftDashboardUpdates(env, touch, client, {
      recapSummary: analysis.recapSummary,
      extractedCommitments: analysis.extractedCommitments,
      draftTickets: analysis.draftTickets,
    });
  } catch (error) {
    dashboardUpdates = {
      status: "draft_ready",
      proposals: [],
      analyzedAt: getNowIso(),
      model,
      errorMessage:
        error instanceof Error ? error.message : "Dashboard intelligence step could not run.",
    };
  }

  const postMeeting: PostMeetingReview = {
    status: "draft_ready",
    transcript: trimmedTranscript,
    recapSummary: analysis.recapSummary,
    extractedCommitments: analysis.extractedCommitments,
    draftTickets,
    clientEmail: {
      subject: analysis.clientEmailSubject,
      body: analysis.clientEmailBody,
      status: "pending",
    },
    dashboardUpdates,
    analyzedAt: getNowIso(),
    model,
  };

  const updatedTouch: MonthlyTouchRecord = stripUndefinedDeep({
    ...touch,
    postMeeting,
    updatedAt: getNowIso(),
  });

  await db.doc(monthlyTouchPath(context.tenantId, touch.id)).set(updatedTouch, { merge: true });

  return { touch: updatedTouch };
}

/**
 * Re-run ONLY the Client Intelligence dashboard step for a touch that already has
 * an analysis. Used to recover from a stale/failed dashboard result (e.g. the old
 * JSON-truncation error) without re-analyzing the transcript or touching any filed
 * tickets. Drafts proposals only; writes nothing to ClickUp until approved.
 */
export async function retryDashboardUpdates(context: TenantContext, touchId: string) {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firebase Admin must be configured before the dashboard step can run");
  }

  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }
  if (!touch.postMeeting) {
    throw new Error("Analyze the transcript before running the dashboard step.");
  }

  const client = await dataSource.getClientById(touch.clientId);
  if (!client) {
    throw new Error("Monthly touch client is not visible for the current user");
  }

  const env = getServerEnv();
  if (!hasAnyLlmProvider(env)) {
    throw new Error("No AI provider is configured, so the dashboard step can't run.");
  }

  let dashboardUpdates: DashboardUpdateReview;
  try {
    dashboardUpdates = await draftDashboardUpdates(env, touch, client, {
      recapSummary: touch.postMeeting.recapSummary || "",
      extractedCommitments: touch.postMeeting.extractedCommitments || [],
      draftTickets: (touch.postMeeting.draftTickets || []).map((ticket) => ({
        title: ticket.title,
        description: ticket.description,
        department: ticket.department,
      })),
    });
  } catch (error) {
    // Persist the fresh error so the UI reflects the latest attempt (retryable again).
    dashboardUpdates = {
      status: "draft_ready",
      proposals: [],
      analyzedAt: getNowIso(),
      model: touch.postMeeting.model,
      errorMessage: error instanceof Error ? error.message : "Dashboard intelligence step could not run.",
    };
  }

  const updatedTouch: MonthlyTouchRecord = stripUndefinedDeep({
    ...touch,
    postMeeting: { ...touch.postMeeting, dashboardUpdates },
    updatedAt: getNowIso(),
  });

  await db.doc(monthlyTouchPath(context.tenantId, touch.id)).set(updatedTouch, { merge: true });

  return { touch: updatedTouch };
}

interface ClickUpTaskResult {
  created: boolean;
  taskId?: string;
  taskUrl?: string;
  reason?: string;
}

interface ClickUpMember {
  id: number;
  username?: string;
  email?: string;
}

// The members of a list rarely change within a single approval batch, so cache
// the directory briefly to avoid re-fetching it for every approved ticket
// (createClickUpTask runs in parallel across tickets).
const memberCache = new Map<string, { at: number; members: ClickUpMember[] }>();
const MEMBER_CACHE_TTL_MS = 60_000;

/** Fetch the members who can be assigned tasks in a given list. Never throws. */
async function getListMembers(listId: string, authHeader: string): Promise<ClickUpMember[]> {
  const cached = memberCache.get(listId);
  if (cached && Date.now() - cached.at < MEMBER_CACHE_TTL_MS) {
    return cached.members;
  }
  try {
    const response = await fetch(`https://api.clickup.com/api/v2/list/${listId}/member`, {
      headers: { authorization: authHeader },
    });
    if (!response.ok) {
      return cached?.members ?? [];
    }
    const payload = (await response.json().catch(() => ({}))) as {
      members?: Array<{ id?: number; username?: string; email?: string }>;
    };
    const members: ClickUpMember[] = (payload.members || [])
      .filter((member): member is { id: number; username?: string; email?: string } => typeof member.id === "number")
      .map((member) => ({ id: member.id, username: member.username, email: member.email }));
    memberCache.set(listId, { at: Date.now(), members });
    return members;
  } catch {
    return cached?.members ?? [];
  }
}

export interface AssignableMember {
  id: number;
  name: string;
}

export interface AssignableMembersResult {
  members: AssignableMember[];
  /** Present when the list can't be produced (e.g. ClickUp not connected). */
  reason?: string;
}

/**
 * The real ClickUp members who can be assigned follow-up tickets -- i.e. the
 * members of the Growth Pilot list tasks are created in. Powers the assignee
 * dropdown on the follow-up screen so the AM picks a real person instead of
 * typing a name. Never throws; returns a reason when it can't resolve members.
 */
export async function listAssignableMembers(context: TenantContext): Promise<AssignableMembersResult> {
  const listId = process.env.CLICKUP_GROWTH_PILOT_LIST_ID;
  if (!listId) {
    return {
      members: [],
      reason: "No ClickUp list is configured for follow-up tickets yet (set CLICKUP_GROWTH_PILOT_LIST_ID).",
    };
  }

  const connection = await getIntegrationConnection(context, "clickup");
  if (!connection || connection.status !== "connected") {
    return { members: [], reason: "ClickUp isn't connected for this workspace yet. Connect it from Settings." };
  }

  const credentials = getIntegrationCredentials(connection);
  if (!credentials.accessToken) {
    return { members: [], reason: "The stored ClickUp connection is missing an access token. Reconnect ClickUp." };
  }

  const members = await getListMembers(listId, credentials.accessToken);
  return {
    members: members.map((member) => ({
      id: member.id,
      name: member.username || member.email || `Member ${member.id}`,
    })),
  };
}

export interface BusinessOption {
  id: string;
  name: string;
}

export interface BusinessOptionsResult {
  businesses: BusinessOption[];
  /** Present when the options can't be produced (e.g. ClickUp not connected, no Business Name field). */
  reason?: string;
}

/**
 * The options of the ClickUp "Business Name" dropdown on the follow-up ticket
 * list. Powers an editable Business dropdown so the AM can confirm the business a
 * ticket is filed under (and reassign multi-GBP profiles to the parent account).
 * Read-only; never modifies the field. Never throws.
 */
export async function listBusinessOptions(context: TenantContext): Promise<BusinessOptionsResult> {
  const listId = process.env.CLICKUP_GROWTH_PILOT_LIST_ID;
  if (!listId) {
    return {
      businesses: [],
      reason: "No ClickUp list is configured for follow-up tickets yet (set CLICKUP_GROWTH_PILOT_LIST_ID).",
    };
  }

  const connection = await getIntegrationConnection(context, "clickup");
  if (!connection || connection.status !== "connected") {
    return { businesses: [], reason: "ClickUp isn't connected for this workspace yet. Connect it from Settings." };
  }

  const credentials = getIntegrationCredentials(connection);
  if (!credentials.accessToken) {
    return { businesses: [], reason: "The stored ClickUp connection is missing an access token. Reconnect ClickUp." };
  }

  const fields = await getListCustomFields(listId, credentials.accessToken);
  const businessField =
    fields.find((field) => normalizeFieldName(field.name) === "business name") ||
    fields.find((field) => normalizeFieldName(field.name).includes("business name"));

  if (!businessField || businessField.type !== "drop_down") {
    return { businesses: [], reason: "No 'Business Name' dropdown was found on the follow-up list in ClickUp." };
  }

  const businesses = businessField.options
    .filter((option) => option.name)
    .map((option) => ({ id: option.id, name: option.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { businesses };
}

/** Best-effort resolve a client's business name to a Business Name option id (for the default selection). */
export function resolveBusinessOptionId(businesses: BusinessOption[], businessName: string): string | undefined {
  return matchDropdownOption(businesses, businessName)?.id;
}

/** Business/client context attached to every follow-up ticket so it's never orphaned. */
interface TicketContext {
  businessName: string;
  /** ClickUp Business Name option id chosen by the AM (may differ from the client for multi-GBP accounts). */
  businessOptionId?: string;
  clientContact?: string;
  accountManager?: string;
  touchDate?: string;
  department?: TicketDepartment;
  /** For billing tickets: the billing-change category, set on the ClickUp "Type" field. */
  billingChangeType?: BillingChangeType;
}

/** ClickUp native priority ids. */
const PRIORITY_TO_CLICKUP: Record<TicketPriority, number> = { urgent: 1, high: 2, normal: 3, low: 4 };

/** Our department -> the closest ClickUp "Department" dropdown option name (blank = leave for the AM). */
const DEPARTMENT_TO_CLICKUP: Record<TicketDepartment, string> = {
  SEO: "SEO",
  "Web Design": "Web Development",
  Ads: "", // ambiguous (Google vs Meta Ads) -- leave for the AM to set in ClickUp
  "Account Manager": "Account Management",
  Other: "",
};

/** Add `days` to a date, skipping weekends. */
function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from.getTime());
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const weekday = result.getDay();
    if (weekday !== 0 && weekday !== 6) added += 1;
  }
  return result;
}

/** End-of-day timestamp (ms) so a due date lands on the right calendar day. */
function endOfDayMs(date: Date): number {
  const end = new Date(date.getTime());
  end.setHours(23, 59, 0, 0);
  return end.getTime();
}

/** Start-of-day timestamp (ms) for a YYYY-MM-DD value. */
function toStartOfDayMs(dateInput: string): number | undefined {
  const parsed = new Date(`${dateInput}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.getTime();
}

/**
 * The due date (ms) for a ticket: an explicit override wins, otherwise it's
 * derived from priority (Urgent: today, High: +24h, Normal: +3 business days,
 * Low: +5 business days), matching the ClickUp ticket form's rule.
 */
function resolveDueDateMs(priority: TicketPriority | undefined, override: string | undefined): number | undefined {
  if (override) {
    const parsed = new Date(`${override}T23:59:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  }
  if (!priority) return undefined;
  const now = new Date();
  switch (priority) {
    case "urgent":
      return endOfDayMs(now);
    case "high":
      return now.getTime() + 24 * 60 * 60 * 1000;
    case "normal":
      return endOfDayMs(addBusinessDays(now, 3));
    case "low":
      return endOfDayMs(addBusinessDays(now, 5));
  }
}

interface ClickUpField {
  id: string;
  name: string;
  type: string;
  options: Array<{ id: string; name: string }>;
}

const fieldCache = new Map<string, { at: number; fields: ClickUpField[] }>();
const FIELD_CACHE_TTL_MS = 60_000;

/** Fetch the custom-field definitions for a list (with dropdown options). Never throws. */
async function getListCustomFields(listId: string, authHeader: string): Promise<ClickUpField[]> {
  const cached = fieldCache.get(listId);
  if (cached && Date.now() - cached.at < FIELD_CACHE_TTL_MS) {
    return cached.fields;
  }
  try {
    const response = await fetch(`https://api.clickup.com/api/v2/list/${listId}/field`, {
      headers: { authorization: authHeader },
    });
    if (!response.ok) {
      return cached?.fields ?? [];
    }
    const payload = (await response.json().catch(() => ({}))) as {
      fields?: Array<{
        id?: string;
        name?: string;
        type?: string;
        type_config?: { options?: Array<{ id?: string; name?: string; label?: string }> };
      }>;
    };
    const fields: ClickUpField[] = (payload.fields || [])
      .filter((field): field is { id: string; name: string; type: string; type_config?: { options?: Array<{ id?: string; name?: string; label?: string }> } } =>
        Boolean(field.id && field.name && field.type),
      )
      .map((field) => ({
        id: field.id,
        name: field.name,
        type: field.type,
        options: (field.type_config?.options || [])
          .filter((option): option is { id: string; name?: string; label?: string } => Boolean(option.id))
          .map((option) => ({ id: option.id, name: (option.name || option.label || "").trim() })),
      }));
    fieldCache.set(listId, { at: Date.now(), fields });
    return fields;
  } catch {
    return cached?.fields ?? [];
  }
}

/** Normalize a field/option name for loose matching (drop emoji/punctuation, lowercase). */
function normalizeFieldName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type DropdownOption = { id: string; name: string };

/**
 * Resolve a free-text value to one of a dropdown's (often hundreds of) options.
 * Tiered so it only returns a confident, UNAMBIGUOUS match -- an ambiguous or
 * missing match returns undefined rather than picking the wrong option.
 */
function matchDropdownOption(options: DropdownOption[], value: string): DropdownOption | undefined {
  const candidates = options.filter((option) => option.name);
  const rawTarget = value.trim().toLowerCase();
  const target = normalizeFieldName(value);
  if (!target) return undefined;

  const unique = (matches: DropdownOption[]) => (matches.length === 1 ? matches[0] : undefined);

  // 1. Exact label (raw, then punctuation-insensitive).
  const rawExact = candidates.find((option) => option.name.toLowerCase() === rawTarget);
  if (rawExact) return rawExact;
  const normExact = candidates.filter((option) => normalizeFieldName(option.name) === target);
  if (normExact.length) return normExact[0];

  // 2. Unique prefix match either direction ("Connolly Heating" vs "Connolly Heating and Air").
  const prefix = unique(
    candidates.filter((option) => {
      const name = normalizeFieldName(option.name);
      return name.startsWith(target) || target.startsWith(name);
    }),
  );
  if (prefix) return prefix;

  // 3. Unique substring match, but only for names long enough to be distinctive.
  if (target.length >= 4) {
    const contains = unique(
      candidates.filter((option) => {
        const name = normalizeFieldName(option.name);
        return name.includes(target) || target.includes(name);
      }),
    );
    if (contains) return contains;
  }

  return undefined;
}

/**
 * Build the ClickUp `custom_fields` payload from the ticket context. Free-text
 * fields (Client Name) are set directly; the Business Name dropdown is set to the
 * exact option the AM chose (by id); the Account Manager dropdown is matched to an
 * existing option. Nothing here creates options or blocks task creation.
 */
function buildTicketCustomFields(
  fields: ClickUpField[],
  context: TicketContext,
): Array<{ id: string; value: unknown }> {
  const out: Array<{ id: string; value: unknown }> = [];

  const findField = (needle: string) =>
    fields.find((field) => normalizeFieldName(field.name) === needle) ||
    fields.find((field) => normalizeFieldName(field.name).includes(needle));

  // Business Name (dropdown): use the exact option the AM selected. Fall back to
  // matching the business name only when no explicit option id was chosen.
  const businessField = findField("business name");
  if (businessField && businessField.type === "drop_down") {
    const optionId =
      context.businessOptionId ||
      matchDropdownOption(businessField.options, context.businessName)?.id;
    if (optionId) out.push({ id: businessField.id, value: optionId });
  }

  // Client Name (free text): always carry the business name.
  const clientField = findField("client name");
  if (clientField && clientField.type !== "drop_down" && context.businessName.trim()) {
    out.push({ id: clientField.id, value: context.businessName.trim() });
  }

  // Account Manager (dropdown): match the AM name to an existing option.
  if (context.accountManager?.trim()) {
    const amField = findField("account manager");
    if (amField && amField.type === "drop_down") {
      const option = matchDropdownOption(amField.options, context.accountManager);
      if (option) out.push({ id: amField.id, value: option.id });
    } else if (amField) {
      out.push({ id: amField.id, value: context.accountManager.trim() });
    }
  }

  // Department (dropdown): map our department to the closest ClickUp option.
  const clickupDepartment = context.department ? DEPARTMENT_TO_CLICKUP[context.department] : "";
  if (clickupDepartment) {
    const deptField = findField("department");
    if (deptField && deptField.type === "drop_down") {
      const option = matchDropdownOption(deptField.options, clickupDepartment);
      if (option) out.push({ id: deptField.id, value: option.id });
    }
  }

  // Type (dropdown): billing-change category, e.g. Upsell / Cancel / Payment Failed.
  if (context.billingChangeType) {
    const typeField =
      fields.find((field) => normalizeFieldName(field.name) === "type") ||
      fields.find((field) => normalizeFieldName(field.name) === "type of change");
    if (typeField && typeField.type === "drop_down") {
      const option = matchDropdownOption(typeField.options, context.billingChangeType);
      if (option) out.push({ id: typeField.id, value: option.id });
    }
  }

  return out;
}

/** A short, human-readable header naming the business so the ticket is never orphaned. */
function buildTicketContextBlock(context: TicketContext): string {
  return [
    `Business: ${context.businessName}`,
    context.clientContact ? `Client contact: ${context.clientContact}` : null,
    context.accountManager ? `Account Manager: ${context.accountManager}` : null,
    context.touchDate ? `Monthly Touch: ${context.touchDate}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Creates a real ClickUp task when a target list is configured and the
 * tenant's ClickUp connection is active. If either prerequisite is missing,
 * this returns created: false with an honest reason instead of pretending
 * the ticket was filed -- the AM still gets the full draft to create it
 * manually.
 */
async function createClickUpTask(
  context: TenantContext,
  ticket: DraftTicket,
  ticketContext?: TicketContext,
): Promise<ClickUpTaskResult> {
  const isBilling = ticket.ticketType === "billing";
  // Billing tickets can route to a dedicated list when one is configured; otherwise
  // they share the follow-up list (distinguished by the Type field + assignee).
  const listId = isBilling
    ? process.env.CLICKUP_BILLING_CHANGE_LIST_ID || process.env.CLICKUP_GROWTH_PILOT_LIST_ID
    : process.env.CLICKUP_GROWTH_PILOT_LIST_ID;
  if (!listId) {
    return {
      created: false,
      reason:
        "No ClickUp list is configured for follow-up tickets yet (set CLICKUP_GROWTH_PILOT_LIST_ID). Copy this ticket into ClickUp manually for now.",
    };
  }

  const connection = await getIntegrationConnection(context, "clickup");
  if (!connection || connection.status !== "connected") {
    return {
      created: false,
      reason: "ClickUp isn't connected for this workspace yet. Connect it from Settings, then re-approve this ticket.",
    };
  }

  const credentials = getIntegrationCredentials(connection);
  if (!credentials.accessToken) {
    return {
      created: false,
      reason: "The stored ClickUp connection is missing an access token. Reconnect ClickUp and try again.",
    };
  }

  // The AM picked the assignee from a dropdown of real members, so we set the
  // ClickUp assignee by id directly -- no name matching needed.
  const assigneeId = ticket.assigneeId;

  // Name the business the ticket is for -- both in the description (always) and in
  // the list's custom fields (best-effort). Custom fields are fetched but never
  // block creation if they can't be resolved.
  const description = ticketContext
    ? `${buildTicketContextBlock(ticketContext)}\n\n${ticket.description}`
    : ticket.description;
  const customFields = ticketContext
    ? buildTicketCustomFields(await getListCustomFields(listId, credentials.accessToken), ticketContext)
    : [];

  // Native ClickUp fields differ by ticket type:
  //  - regular: priority + time estimate, due date derived from priority
  //  - billing: no priority/estimate; a start date (the requested/event date) and a due date
  const priorityId = ticket.priority ? PRIORITY_TO_CLICKUP[ticket.priority] : undefined;
  const timeEstimateMs =
    typeof ticket.timeEstimateMinutes === "number" && ticket.timeEstimateMinutes > 0
      ? Math.round(ticket.timeEstimateMinutes * 60 * 1000)
      : undefined;
  const dueDateMs = resolveDueDateMs(ticket.priority || (isBilling ? "normal" : undefined), ticket.dueDate);
  const startDateMs = ticket.dateRequested ? toStartOfDayMs(ticket.dateRequested) : undefined;

  const nativeFields = isBilling
    ? {
        ...(dueDateMs ? { due_date: dueDateMs } : {}),
        ...(startDateMs ? { start_date: startDateMs } : {}),
      }
    : {
        ...(priorityId ? { priority: priorityId } : {}),
        ...(timeEstimateMs ? { time_estimate: timeEstimateMs } : {}),
        ...(dueDateMs ? { due_date: dueDateMs } : {}),
      };

  try {
    const response = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
      method: "POST",
      headers: {
        authorization: credentials.accessToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: ticket.title,
        description,
        ...(typeof assigneeId === "number" ? { assignees: [assigneeId] } : {}),
        ...nativeFields,
        ...(customFields.length ? { custom_fields: customFields } : {}),
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      id?: string;
      url?: string;
      err?: string;
    };

    if (!response.ok) {
      return {
        created: false,
        reason: payload.err || `ClickUp task creation failed with status ${response.status}.`,
      };
    }

    return { created: true, taskId: payload.id, taskUrl: payload.url };
  } catch (error) {
    return {
      created: false,
      reason: error instanceof Error ? error.message : "ClickUp task creation failed unexpectedly.",
    };
  }
}

/**
 * One ticket as the AM finalized it on the follow-up screen. Carries the (possibly
 * edited) content plus the approve/decline decision, so the AM can edit, add, and
 * delete tickets before confirming -- not just approve the AI's originals.
 */
export interface PostMeetingTicketInput {
  id: string;
  title: string;
  description: string;
  department: TicketDepartment;
  /** ClickUp member id chosen from the assignee dropdown, if any. */
  assigneeId?: number;
  /** Display name of the chosen member, kept on the record for the UI. */
  assignee?: string;
  /** ClickUp Business Name option id chosen from the business dropdown, if any. */
  businessOptionId?: string;
  /** Display name of the chosen business. */
  businessName?: string;
  priority?: TicketPriority;
  timeEstimateMinutes?: number;
  /** Optional explicit due date (YYYY-MM-DD); derived from priority when absent. */
  dueDate?: string;
  ticketType?: TicketType;
  billingChangeType?: BillingChangeType;
  dateRequested?: string;
  decision: "approved" | "declined";
}

export interface PostMeetingDecisions {
  /** The full final ticket set (additions included, deletions omitted). */
  tickets: PostMeetingTicketInput[];
  /** The (possibly edited) client email plus whether to approve it. */
  email: { subject: string; body: string; approve: boolean };
  /** Decisions on Client Intelligence dashboard proposals, keyed by proposal id. */
  dashboardDecisions?: Record<string, "approved" | "declined">;
}

export async function applyPostMeetingDecisions(
  context: TenantContext,
  touchId: string,
  decisions: PostMeetingDecisions,
) {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firebase Admin must be configured before decisions can be applied");
  }

  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }

  if (!touch.postMeeting || touch.postMeeting.status !== "draft_ready") {
    throw new Error("Generate the post-meeting analysis before applying decisions");
  }

  // Guard: an approved ticket must actually have content (the AM may have cleared a field).
  for (const input of decisions.tickets) {
    if (input.decision === "approved" && (!input.title.trim() || !input.description.trim())) {
      throw new Error("Approved tickets need both a title and a description.");
    }
  }

  // Resolve the shared client/AM context so every filed ticket names the business
  // it's for (in the description and the ClickUp custom fields). The business itself
  // is per-ticket (the AM may reassign a multi-GBP profile to the parent account).
  const client = await dataSource.getClientById(touch.clientId);
  const { name: accountManagerName } = await getAccountManagerIdentity(context);
  const sharedContext = {
    clientContact: client?.contact,
    accountManager: accountManagerName || client?.accountManager || undefined,
    touchDate: touch.scheduledAt || undefined,
    fallbackBusinessName: client?.name || "",
  };

  // No-duplicates safety net: any ticket already filed to ClickUp (has a task id)
  // is never created again -- we reuse its existing task instead.
  const alreadyFiledById = new Map(
    (touch.postMeeting.draftTickets || [])
      .filter((ticket) => ticket.clickupTaskId)
      .map((ticket) => [ticket.id, ticket]),
  );

  // Build the final ticket set from what the AM confirmed -- their edits, additions,
  // and deletions -- rather than the AI's originals. Approved tickets are filed to
  // ClickUp using the edited content.
  const updatedTickets: DraftTicket[] = await Promise.all(
    decisions.tickets.map(async (input) => {
      const ticket: DraftTicket = {
        id: input.id,
        title: input.title.trim(),
        description: input.description.trim(),
        department: input.department,
        assigneeId: input.assigneeId,
        assignee: input.assignee?.trim() || undefined,
        businessOptionId: input.businessOptionId,
        businessName: input.businessName?.trim() || undefined,
        priority: input.priority,
        timeEstimateMinutes: input.timeEstimateMinutes,
        dueDate: input.dueDate,
        ticketType: input.ticketType || "regular",
        billingChangeType: input.billingChangeType,
        dateRequested: input.dateRequested,
        status: input.decision,
      };

      if (input.decision !== "approved") {
        return { ...ticket, status: "declined" as const };
      }

      // If this ticket was already filed, reuse its ClickUp task -- never duplicate it.
      const prior = alreadyFiledById.get(input.id);
      if (prior?.clickupTaskId) {
        return {
          ...ticket,
          status: "approved" as const,
          clickupTaskId: prior.clickupTaskId,
          clickupTaskUrl: prior.clickupTaskUrl,
        };
      }

      const isBillingTicket = ticket.ticketType === "billing";
      const ticketContext: TicketContext = {
        businessName: ticket.businessName || sharedContext.fallbackBusinessName,
        businessOptionId: ticket.businessOptionId,
        clientContact: sharedContext.clientContact,
        accountManager: sharedContext.accountManager,
        touchDate: sharedContext.touchDate,
        // Billing tickets follow the billing form (no Department); regular tickets carry it.
        department: isBillingTicket ? undefined : ticket.department,
        billingChangeType: isBillingTicket ? ticket.billingChangeType : undefined,
      };

      const result = await createClickUpTask(context, ticket, ticketContext);
      return {
        ...ticket,
        status: "approved" as const,
        clickupTaskId: result.taskId,
        clickupTaskUrl: result.taskUrl,
        executionNote: result.created ? undefined : result.reason,
      };
    }),
  );

  const clientEmail: ClientEmailDraft = {
    subject: decisions.email.subject.trim(),
    body: decisions.email.body,
    status: decisions.email.approve ? "approved" : "pending",
  };

  // Apply approved dashboard proposals (writes to the two configured ClickUp
  // dashboard lists). Left untouched when there are no proposals or decisions.
  let dashboardUpdates = touch.postMeeting.dashboardUpdates;
  if (dashboardUpdates?.proposals.length && decisions.dashboardDecisions) {
    dashboardUpdates = await applyDashboardDecisions(
      context,
      dashboardUpdates,
      decisions.dashboardDecisions,
    );
  }

  const postMeeting: PostMeetingReview = {
    ...touch.postMeeting,
    status: "approved",
    draftTickets: updatedTickets,
    clientEmail,
    dashboardUpdates,
  };

  const updatedTouch: MonthlyTouchRecord = stripUndefinedDeep({
    ...touch,
    postMeeting,
    updatedAt: getNowIso(),
  });

  await db.doc(monthlyTouchPath(context.tenantId, touch.id)).set(updatedTouch, { merge: true });

  return { touch: updatedTouch };
}

/**
 * Apply approve/decline decisions on the Client Intelligence dashboard proposals
 * on their own -- used when they were generated (or retried) after the main
 * decisions were already confirmed. Approved proposals are written to their
 * ClickUp dashboard list; nothing else on the touch changes.
 */
export async function applyDashboardOnlyDecisions(
  context: TenantContext,
  touchId: string,
  dashboardDecisions: Record<string, "approved" | "declined">,
) {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firebase Admin must be configured before decisions can be applied");
  }

  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }
  if (!touch.postMeeting?.dashboardUpdates?.proposals.length) {
    throw new Error("There are no dashboard proposals to apply.");
  }

  const dashboardUpdates = await applyDashboardDecisions(
    context,
    touch.postMeeting.dashboardUpdates,
    dashboardDecisions,
  );

  const updatedTouch: MonthlyTouchRecord = stripUndefinedDeep({
    ...touch,
    postMeeting: { ...touch.postMeeting, dashboardUpdates },
    updatedAt: getNowIso(),
  });

  await db.doc(monthlyTouchPath(context.tenantId, touch.id)).set(updatedTouch, { merge: true });

  return { touch: updatedTouch };
}
