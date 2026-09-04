import type { TenantContext } from "@/src/lib/contracts/mtos";
import type {
  CaseStatus,
  ClientIntelligenceReview,
  ClientRecord,
  ClientType,
  CommunicationPreference,
  MarketingLiteracy,
  MonthlyTouchRecord,
  RiskPrimaryCategory,
  RiskRegisterEntry,
  RiskTier,
  StakeholderMapEntry,
  YesNo,
  YesNoKindOf,
  YesNoMaybe,
} from "@/src/lib/mtos-data";
import { getServerEnv } from "@/src/lib/server/env";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { getIntegrationConnection, getIntegrationCredentials } from "@/src/lib/server/integrations";
import { callLlmForJson, getNowIso, hasAnyLlmProvider, stripUndefinedDeep } from "@/src/lib/server/services/mtos-ai";
import { getAccountManagerIdentity } from "@/src/lib/server/services/user-service";
import {
  applyFieldWritesToTask,
  CustomFieldBuilder,
  findField,
  getListCustomFields,
  getListMembers,
  getTaskFieldValues,
  matchOption,
  updateTaskNative,
} from "@/src/lib/server/services/clickup-fields";

// ---------------------------------------------------------------------------
// Coercion helpers -- keep the LLM's answers on the allowed values.
// ---------------------------------------------------------------------------

function str(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function yesNo(value: unknown): YesNo | undefined {
  const text = str(value).toLowerCase();
  if (!text) return undefined;
  if (/^y|true|yes/.test(text)) return "Yes";
  if (/^n|false|no/.test(text)) return "No";
  return undefined;
}

function caseStatus(value: unknown): CaseStatus | undefined {
  const text = str(value).toLowerCase();
  if (/cancel/.test(text)) return "Requested Cancellation";
  if (/resolv|health/.test(text)) return "Resolved-Healthy";
  if (/work/.test(text)) return "Working";
  if (/watch|monitor/.test(text)) return "Watching";
  return undefined;
}

function primaryCategory(value: unknown): RiskPrimaryCategory | undefined {
  const text = str(value).toLowerCase();
  if (/commun/.test(text)) return "Communication";
  if (/expect/.test(text)) return "Expectations";
  if (/product|deliver|service quality/.test(text)) return "Product";
  if (/onboard/.test(text)) return "Onboarding";
  if (/business|general|gen\.?/.test(text)) return "Gen. Business";
  return undefined;
}

function commPref(value: unknown): CommunicationPreference | undefined {
  const text = str(value).toLowerCase();
  if (/phone|call/.test(text)) return "Phone";
  if (/email|mail/.test(text)) return "Email";
  if (/face|in.person|video|zoom|meeting/.test(text)) return "Face-to-Face";
  if (/text|sms|chat|message/.test(text)) return "Text/Chat";
  return undefined;
}

function literacy(value: unknown): MarketingLiteracy | undefined {
  const text = str(value).toLowerCase();
  if (/high|expert|advanced|savvy/.test(text)) return "High";
  if (/med|inter/.test(text)) return "Medium";
  if (/low|begin|novice|none|basic/.test(text)) return "Low";
  return undefined;
}

function yesNoMaybe(value: unknown): YesNoMaybe | undefined {
  const text = str(value).toLowerCase();
  if (!text) return undefined;
  if (/maybe|possibly|partly|somewhat|unsure/.test(text)) return "maybe";
  if (/^y|yes|true/.test(text)) return "Yes";
  if (/^n|no|false/.test(text)) return "No";
  return undefined;
}

function yesNoKindOf(value: unknown): YesNoKindOf | undefined {
  const text = str(value).toLowerCase();
  if (!text) return undefined;
  if (/kind of|kinda|sort of|somewhat|partly/.test(text)) return "kind of";
  if (/^y|yes|true/.test(text)) return "Yes";
  if (/^n|no|false/.test(text)) return "No";
  return undefined;
}

/**
 * Risk Score is a simple COUNT of the six warning signs marked "Yes" (0-6), per
 * the Client Retention Risk Tracker rubric. Only "Yes" counts as a flag;
 * "maybe"/"kind of" are informational and do not add to the score.
 */
function computeRiskScore(entry: {
  money?: string;
  responsiveness?: string;
  lifeChange?: string;
  technical?: string;
  otherAgency?: string;
  performance?: string;
}): number {
  return [entry.money, entry.responsiveness, entry.lifeChange, entry.technical, entry.otherAgency, entry.performance]
    .filter((value) => value === "Yes").length;
}

/** Risk Tier from the flag count, per the rubric: 0 Healthy, 1 Low, 2-3 Medium, 4-5 High, 6 Critical. */
function riskScoreToTier(score: number): RiskTier {
  if (score >= 6) return "Critical";
  if (score >= 4) return "High";
  if (score >= 2) return "Medium";
  if (score === 1) return "Low";
  return "Healthy";
}

/** Default case status from tier, per the rubric (Low/Medium: Watching; High/Critical: Working). */
function defaultCaseStatusForTier(tier: RiskTier): "Watching" | "Working" {
  return tier === "High" || tier === "Critical" ? "Working" : "Watching";
}

/** Convert an ISO/date string to YYYY-MM-DD. */
function toDate(value?: string): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDaysDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** White label is (currently) only Joscelyn and Lara; everyone else defaults to Direct. */
function defaultClientType(accountManager: string): ClientType {
  return /josce|joseph|lara|laura/i.test(accountManager) ? "White Label" : "Direct";
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

interface AnalysisInput {
  recapSummary: string;
  extractedCommitments: string[];
  draftTickets: Array<{ title: string; description: string; department: string }>;
}

/**
 * Generate the Client Intelligence record from the completed transcript analysis:
 * a narrative report (saved with the client, never posted); a Stakeholder Map
 * entry ALWAYS (every client must be listed & current); and a Risk Register entry
 * ONLY when a retention risk is detected. Writes nothing to ClickUp.
 */
export async function generateClientIntelligence(
  context: TenantContext,
  env: ReturnType<typeof getServerEnv>,
  touch: MonthlyTouchRecord,
  client: ClientRecord,
  analysis: AnalysisInput,
  accountManagerName: string,
): Promise<ClientIntelligenceReview> {
  const amName = accountManagerName.trim() || client.accountManager?.trim() || "";
  const touchDate = toDate(touch.scheduledAt) || todayDate();

  const system = [
    "You are a client-success analyst for the agency Map Ranking. From a monthly-touch transcript",
    "and the client context, produce a concise internal Client Intelligence report AND decide whether",
    "the client shows ANY retention risk (money, responsiveness, expectations, performance, a life",
    "event, a technical change, or another agency circling). Use ONLY the evidence provided; never invent.",
  ].join(" ");

  const userText = [
    "Return a JSON object with exactly these keys:",
    "  report: string -- a tight narrative (2-4 short paragraphs) on where this client stands after the touch.",
    "  factors: the six retention warning signs -- money, responsiveness, lifeChange, technical,",
    '           otherAgency, performance. Mark each "Yes" ONLY if this touch shows it as a real warning',
    "           sign for this client, otherwise \"No\". (The risk score is simply how many are Yes, so be",
    '           accurate.) money/responsiveness/technical/performance are "Yes"/"No"; lifeChange is',
    '           "Yes"/"No"/"maybe"; otherAgency is "Yes"/"No"/"kind of".',
    '  caseStatus: one of "Watching","Working","Requested Cancellation","Resolved-Healthy" (or null).',
    '  primaryCategory: one of "Communication","Expectations","Gen. Business","Product","Onboarding".',
    "  nextAction: 2-4 words max, imperative (e.g. \"Schedule check-in call\", \"Send updated report\").",
    "  latestComments: ONE short sentence of notable context (this is the only field allowed a sentence).",
    "  stakeholder: an object with role, communicationPreference (Phone/Email/Face-to-Face/Text/Chat),",
    "           marketingLiteracy (Low/Medium/High), personality, whatTheyCareAbout, knownHistory,",
    "           and services (array of service names they have).",
    "",
    "FIELD STYLE (critical): the table columns are single-word cells. Fill role, personality,",
    "whatTheyCareAbout, and knownHistory with ONE word each (e.g. role \"Owner\"; personality \"Analytical\";",
    "whatTheyCareAbout \"Leads\"; knownHistory \"Longtime\"). Do NOT write sentences in any field. The ONLY",
    "field that may be a short sentence is latestComments. Keep report as prose; keep every table field terse.",
    "Always return report and stakeholder. When no warning signs apply, mark all six factors \"No\".",
    "",
    JSON.stringify(
      {
        client: {
          name: client.name,
          industry: client.industry,
          contact: client.contact,
          healthScore: client.healthScore,
          tone: client.tone,
          topRisks: client.topRisks,
          churnSignals: client.churnSignals,
          riskNote: client.riskNote,
          summary: client.summary,
          nextBestAction: client.nextBestAction,
          goals: client.goals,
        },
        touch: { executiveBrief: touch.executiveBrief, wins: touch.wins, risks: touch.risks },
        transcriptAnalysis: analysis,
      },
      null,
      2,
    ),
  ].join("\n");

  const { data, model } = await callLlmForJson({ env, system, userText, maxTokens: 6000 });

  const report = str(data.report) || str(data.summary) || "No report was generated.";
  const factors = (data.factors ?? {}) as Record<string, unknown>;
  const stakeholder = (data.stakeholder ?? {}) as Record<string, unknown>;
  const clientType = defaultClientType(amName);
  const servicesRaw = Array.isArray(stakeholder.services) ? stakeholder.services : [];

  // Normalize the six warning signs, then the Risk Score is the COUNT of "Yes"
  // (per the Client Retention Risk Tracker rubric), and the Tier follows the count.
  const flags = {
    money: yesNo(factors.money) || "No",
    responsiveness: yesNo(factors.responsiveness) || "No",
    lifeChange: yesNoMaybe(factors.lifeChange) || "No",
    technical: yesNo(factors.technical) || "No",
    otherAgency: yesNoKindOf(factors.otherAgency) || "No",
    performance: yesNo(factors.performance) || "No",
  };
  const score = computeRiskScore(flags);
  const tier = riskScoreToTier(score);
  const riskDetected = score >= 1;

  // Stakeholder Map is ALWAYS produced -- every client must be listed & kept current.
  const stakeholderMap: StakeholderMapEntry = {
    clientName: client.contact || client.name,
    assignee: amName || undefined,
    clientType,
    services: servicesRaw.map((entry) => str(entry)).filter(Boolean),
    role: str(stakeholder.role) || undefined,
    communicationPreference: commPref(stakeholder.communicationPreference),
    marketingLiteracy: literacy(stakeholder.marketingLiteracy),
    personality: str(stakeholder.personality) || undefined,
    whatTheyCareAbout: str(stakeholder.whatTheyCareAbout) || undefined,
    knownHistory: str(stakeholder.knownHistory) || undefined,
  };

  // Read the client's current row: is the stakeholder data already filled, and is
  // the client CURRENTLY flagged at risk (so we can clear it when the risk is gone)?
  const { linked, stakeholderUpToDate, currentlyFlagged } = await inspectClientTask(context, client);

  const review: ClientIntelligenceReview = {
    status: "draft_ready",
    report,
    riskDetected,
    stakeholderMap,
    stakeholderMapStatus: "pending",
    stakeholderUpToDate,
    clientTaskLinked: linked,
    analyzedAt: getNowIso(),
    model,
  };

  if (riskDetected) {
    // New / ongoing risk -> flag the client and fill the Risk Register.
    review.riskTier = tier;
    review.riskRegister = {
      accountManager: amName || undefined,
      clientType,
      caseStatus: caseStatus(data.caseStatus) || defaultCaseStatusForTier(tier),
      dateFlagged: todayDate(),
      ...flags,
      riskScore: score,
      riskTier: tier,
      primaryCategory: primaryCategory(data.primaryCategory),
      nextAction: str(data.nextAction) || "Follow up",
      nextActionOwner: amName || undefined,
      dueDate: plusDaysDate(7),
      lastMonthlyTouch: touchDate,
      latestComments: str(data.latestComments) || undefined,
    };
    review.riskRegisterStatus = "pending";
  } else if (currentlyFlagged) {
    // Previously flagged, but this touch shows no risk (0 flags) -> propose clearing it.
    review.riskResolved = true;
    review.riskTier = "Healthy";
    review.riskRegister = {
      accountManager: amName || undefined,
      clientType,
      caseStatus: "Resolved-Healthy",
      dateFlagged: todayDate(),
      ...flags,
      riskScore: 0,
      riskTier: "Healthy",
      nextAction: "Monitor",
      nextActionOwner: amName || undefined,
      lastMonthlyTouch: touchDate,
      latestComments: str(data.latestComments) || undefined,
    };
    review.riskRegisterStatus = "pending";
  }

  return review;
}

/** Field names that indicate the Stakeholder Map row is already filled in. */
const STAKEHOLDER_FIELD_NAMES = [
  "role title",
  "communication preference",
  "marketing literacy",
  "personality styles",
  "what they care about",
  "known history context",
];

/** Read the client's linked task: is the stakeholder data filled, and is it currently flagged at risk? */
async function inspectClientTask(
  context: TenantContext,
  client: ClientRecord,
): Promise<{ linked: boolean; stakeholderUpToDate: boolean; currentlyFlagged: boolean }> {
  const taskId = client.clickupTaskId;
  const listId = process.env.CLICKUP_HEALTH_TRACKER_LIST_ID;
  if (!taskId || !listId) {
    return { linked: Boolean(taskId), stakeholderUpToDate: false, currentlyFlagged: false };
  }
  const auth = await getClickUpAuth(context);
  if (!("token" in auth)) return { linked: true, stakeholderUpToDate: false, currentlyFlagged: false };
  try {
    const [fields, values] = await Promise.all([
      getListCustomFields(listId, auth.token),
      getTaskFieldValues(taskId, auth.token),
    ]);
    const populated = STAKEHOLDER_FIELD_NAMES.filter((name) => {
      const field = findField(fields, [name]);
      if (!field) return false;
      const value = values.get(field.id);
      return value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);
    });
    // Is the "Health" dropdown currently set to a Risk option?
    let currentlyFlagged = false;
    const healthField = findField(fields, ["health"]);
    if (healthField) {
      const rawValue = values.get(healthField.id);
      const optionId = typeof rawValue === "string" ? rawValue : (rawValue as { id?: string })?.id;
      const option = healthField.options.find((opt) => opt.id === optionId);
      currentlyFlagged = /risk/i.test(option?.name || "");
    }
    return { linked: true, stakeholderUpToDate: populated.length >= 4, currentlyFlagged };
  } catch {
    return { linked: true, stakeholderUpToDate: false, currentlyFlagged: false };
  }
}

// ---------------------------------------------------------------------------
// Writing to ClickUp on approval
// ---------------------------------------------------------------------------

interface ClickUpAuth {
  token: string;
}

async function getClickUpAuth(context: TenantContext): Promise<ClickUpAuth | { error: string }> {
  const connection = await getIntegrationConnection(context, "clickup");
  if (!connection || connection.status !== "connected") {
    return { error: "ClickUp isn't connected for this workspace yet. Connect it from Settings." };
  }
  const credentials = getIntegrationCredentials(connection);
  if (!credentials.accessToken) {
    return { error: "The stored ClickUp connection is missing an access token. Reconnect ClickUp." };
  }
  return { token: credentials.accessToken };
}

/** Resolve an account-manager name to a member id on a list (for native assignee / users fields). */
async function resolveMemberId(listId: string, token: string, name?: string): Promise<number | undefined> {
  if (!name?.trim()) return undefined;
  const members = await getListMembers(listId, token);
  const match = matchOption(
    members.map((member) => ({ id: String(member.id), name: member.name })),
    name,
  );
  return match ? Number(match.id) : undefined;
}

async function writeRiskRegister(
  listId: string,
  token: string,
  taskId: string,
  entry: RiskRegisterEntry,
): Promise<{ ok: boolean; reason?: string }> {
  const fields = await getListCustomFields(listId, token);
  const ownerId = await resolveMemberId(listId, token, entry.nextActionOwner || entry.accountManager);
  // Risk Score = count of "Yes" flags; Tier follows the count (rubric is authoritative,
  // recomputed here in case the AM edited a flag). Resolved cases go back to Healthy/Good.
  const resolved = entry.caseStatus === "Resolved-Healthy";
  const score = resolved ? 0 : computeRiskScore(entry);
  const tier = riskScoreToTier(score);
  const health = resolved || score === 0 ? "Good" : "Risk";
  const writes = new CustomFieldBuilder(fields)
    .dropdown(["health"], health)
    .dropdown(["account manager"], entry.accountManager)
    .dropdown(["client type"], entry.clientType)
    .dropdown(["case status"], entry.caseStatus)
    .date(["date flagged"], entry.dateFlagged)
    .dropdown(["money cash flow", "money"], entry.money)
    .dropdown(["responsiveness"], entry.responsiveness)
    .dropdown(["life change", "life changing event"], entry.lifeChange)
    .dropdown(["technical challenge", "technical"], entry.technical)
    .dropdown(["other agency advisor", "other agency"], entry.otherAgency)
    .dropdown(["performance"], entry.performance)
    .dropdown(["risk score"], String(score))
    .dropdown(["risk tier"], tier)
    .dropdown(["primary category per churn analysis", "primary category"], entry.primaryCategory)
    .text(["next action"], entry.nextAction)
    .users(["next action owner"], ownerId)
    .date(["last client touchpoint", "last client monthly touch", "last monthly touch"], entry.lastMonthlyTouch)
    .text(["latest comments", "comments", "insights"], entry.latestComments)
    .build();
  const result = await applyFieldWritesToTask(taskId, writes, token);
  const dueMs = entry.dueDate ? new Date(`${entry.dueDate}T23:59:00`).getTime() : undefined;
  await updateTaskNative(taskId, token, { dueDateMs: dueMs });
  return result;
}

async function writeStakeholderMap(
  listId: string,
  token: string,
  taskId: string,
  entry: StakeholderMapEntry,
): Promise<{ ok: boolean; reason?: string }> {
  const fields = await getListCustomFields(listId, token);
  const today = new Date().toISOString().slice(0, 10);
  const writes = new CustomFieldBuilder(fields)
    .text(["client name"], entry.clientName)
    .dropdown(["account manager"], entry.assignee)
    .dropdown(["client type"], entry.clientType)
    .labels(["services"], entry.services)
    .text(["role title", "role"], entry.role)
    .dropdown(["communication preference"], entry.communicationPreference)
    .dropdown(["marketing literacy"], entry.marketingLiteracy)
    .text(["personality styles", "personality"], entry.personality)
    .text(["what they care about"], entry.whatTheyCareAbout)
    .text(["known history context", "known history"], entry.knownHistory)
    // "Date updated" -- ClickUp auto-stamps native update, but set Date Reviewed too if present.
    .date(["date updated", "date reviewed"], today)
    .build();
  return applyFieldWritesToTask(taskId, writes, token);
}

export interface ClientIntelligenceDecisions {
  riskRegister?: RiskRegisterEntry & { decision: "approved" | "declined" };
  stakeholderMap?: StakeholderMapEntry & { decision: "approved" | "declined" };
}

/**
 * Apply the AM's approve/decline decisions on the Risk Register + Stakeholder Map
 * entries. Approved entries UPDATE the client's existing row (task) in the Client
 * Health Tracker list -- never create a duplicate. Declined ones are just recorded.
 * The narrative report is never posted.
 */
export async function applyClientIntelligenceDecisions(
  context: TenantContext,
  touchId: string,
  decisions: ClientIntelligenceDecisions,
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
  const postMeeting = touch.postMeeting;
  if (!postMeeting?.clientIntelligence) {
    throw new Error("Generate the Client Intelligence step before applying decisions.");
  }
  const existing = postMeeting.clientIntelligence;

  const client = await dataSource.getClientById(touch.clientId);
  const auth = await getClickUpAuth(context);
  const listId = process.env.CLICKUP_HEALTH_TRACKER_LIST_ID;
  const taskId = client?.clickupTaskId;
  const taskUrl = taskId ? `https://app.clickup.com/t/${taskId}` : undefined;

  const review: ClientIntelligenceReview = {
    ...existing,
    // Carry the AM's edited entries.
    riskRegister: decisions.riskRegister ? stripEntry(decisions.riskRegister) : existing.riskRegister,
    stakeholderMap: decisions.stakeholderMap ? stripEntry(decisions.stakeholderMap) : existing.stakeholderMap,
    status: "applied",
  };
  const notes: string[] = [];

  // Shared preconditions for writing to the client's Health Tracker row.
  const blockedReason = !("token" in auth)
    ? (auth as { error: string }).error
    : !listId
      ? "No Client Health Tracker list is configured (set CLICKUP_HEALTH_TRACKER_LIST_ID)."
      : !taskId
        ? "This client isn't linked to a ClickUp row yet — sync clients from ClickUp first, then re-approve."
        : undefined;
  const token = "token" in auth ? auth.token : undefined;

  // Risk Register -> update the client's row.
  if (decisions.riskRegister?.decision === "approved") {
    if (blockedReason || !token || !listId || !taskId) {
      review.riskRegisterStatus = "pending";
      if (blockedReason) notes.push(blockedReason);
    } else {
      const result = await writeRiskRegister(listId, token, taskId, review.riskRegister || {});
      review.riskRegisterStatus = "approved";
      review.riskRegisterTaskUrl = taskUrl;
      if (!result.ok && result.reason) notes.push(`Risk Register: ${result.reason}`);
    }
  } else if (decisions.riskRegister?.decision === "declined") {
    review.riskRegisterStatus = "declined";
  }

  // Stakeholder Map -> update the client's row.
  if (decisions.stakeholderMap?.decision === "approved") {
    if (blockedReason || !token || !listId || !taskId) {
      review.stakeholderMapStatus = "pending";
      if (blockedReason) notes.push(blockedReason);
    } else {
      const result = await writeStakeholderMap(listId, token, taskId, review.stakeholderMap || {});
      review.stakeholderMapStatus = "approved";
      review.stakeholderMapTaskUrl = taskUrl;
      if (!result.ok && result.reason) notes.push(`Stakeholder Map: ${result.reason}`);
    }
  } else if (decisions.stakeholderMap?.decision === "declined") {
    review.stakeholderMapStatus = "declined";
  }

  review.executionNote = notes.length ? Array.from(new Set(notes)).join(" ") : undefined;

  const updatedTouch: MonthlyTouchRecord = stripUndefinedDeep({
    ...touch,
    postMeeting: { ...postMeeting, clientIntelligence: review },
    updatedAt: getNowIso(),
  });
  await db.doc(monthlyTouchPath(context.tenantId, touch.id)).set(updatedTouch, { merge: true });

  return { touch: updatedTouch };
}

/** Drop the transient `decision` field before persisting an entry. */
function stripEntry<T extends { decision?: unknown }>(entry: T): Omit<T, "decision"> {
  const rest: Record<string, unknown> = { ...entry };
  delete rest.decision;
  return rest as Omit<T, "decision">;
}

/** Re-run only the Client Intelligence step for a touch that already has an analysis. */
export async function retryClientIntelligence(context: TenantContext, touchId: string) {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firebase Admin must be configured before the Client Intelligence step can run");
  }
  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }
  const postMeeting = touch.postMeeting;
  if (!postMeeting) {
    throw new Error("Analyze the transcript before running the Client Intelligence step.");
  }
  const client = await dataSource.getClientById(touch.clientId);
  if (!client) {
    throw new Error("Monthly touch client is not visible for the current user");
  }
  const env = getServerEnv();
  if (!hasAnyLlmProvider(env)) {
    throw new Error("No AI provider is configured, so the Client Intelligence step can't run.");
  }

  const { name: accountManagerName } = await getAccountManagerIdentity(context);
  let clientIntelligence: ClientIntelligenceReview;
  try {
    clientIntelligence = await generateClientIntelligence(
      context,
      env,
      touch,
      client,
      {
        recapSummary: postMeeting.recapSummary || "",
        extractedCommitments: postMeeting.extractedCommitments || [],
        draftTickets: (postMeeting.draftTickets || []).map((ticket) => ({
          title: ticket.title,
          description: ticket.description,
          department: ticket.department,
        })),
      },
      accountManagerName,
    );
  } catch (error) {
    clientIntelligence = {
      status: "draft_ready",
      report: postMeeting.clientIntelligence?.report || "",
      riskDetected: false,
      analyzedAt: getNowIso(),
      errorMessage: error instanceof Error ? error.message : "Client Intelligence step could not run.",
    };
  }

  const updatedTouch: MonthlyTouchRecord = stripUndefinedDeep({
    ...touch,
    postMeeting: { ...postMeeting, clientIntelligence },
    updatedAt: getNowIso(),
  });
  await db.doc(monthlyTouchPath(context.tenantId, touch.id)).set(updatedTouch, { merge: true });
  return { touch: updatedTouch };
}
