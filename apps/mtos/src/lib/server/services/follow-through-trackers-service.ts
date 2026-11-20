import { loomEvidence } from "@/src/lib/contracts/no-show";
import { readTouchTranscriptPayload } from "@/src/lib/server/services/transcript-watch-service";
import { generateClientIntelligence } from "@/src/lib/server/services/client-intelligence-service";
import { getServerEnv } from "@/src/lib/server/env";
import { hasAnyLlmProvider } from "@/src/lib/server/services/mtos-ai";
import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { ClientRecord, RiskRegisterEntry } from "@/src/lib/mtos-data";
import {
  HEALTH_TRACKER_FIELDS,
  RISK_REGISTER_FIELDS,
  STAKEHOLDER_FIELDS,
  type HealthTrackerRow,
  type TrackerCard,
  diffRow,
  healthFromScore,
  withDerivedRiskFields,
} from "@/src/lib/contracts/follow-through-trackers";
import { riskRegisterRequired } from "@/src/lib/contracts/post-meeting-review";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import {
  getIntegrationConnection,
  getIntegrationCredentials,
} from "@/src/lib/server/integrations";
import {
  fieldValueText,
  findField,
  getListCustomFields,
  getTaskFieldValues,
} from "@/src/lib/server/services/clickup-fields";

/**
 * The three tracker rows this touch would change, each shown against the row as it stands.
 *
 * The "as it stands" half is the point. These rows are live: the Health Tracker is read by people
 * who were not on the call, the Risk Register drives the retention work, and the Stakeholder Map
 * is what the next AM reads before they pick the phone up. Approving a change to one without
 * seeing what it replaces is approving an overwrite blind.
 *
 * So when the current row cannot be read -- ClickUp not connected, no task linked, a field
 * renamed -- that is reported rather than papered over, and every field reads as new. An AM who
 * knows the comparison is missing can decide carefully; one who is shown a confident, empty
 * "was" cannot.
 */

/** Read the client's Health Tracker row as it currently stands in ClickUp. */
export interface CurrentRowResult {
  row?: Partial<HealthTrackerRow>;
  /** Why the current row is unavailable, when it is. Shown on the card. */
  reason?: string;
}

export async function readHealthTrackerRow(
  context: TenantContext,
  client: ClientRecord,
): Promise<CurrentRowResult> {
  const taskId = client.clickupTaskId;
  const listId = process.env.CLICKUP_HEALTH_TRACKER_LIST_ID;
  if (!taskId) {
    return { reason: "This client has no ClickUp task linked, so there is no current row to compare against." };
  }
  if (!listId) {
    return { reason: "No Health Tracker list is configured (set CLICKUP_HEALTH_TRACKER_LIST_ID)." };
  }

  const connection = await getIntegrationConnection(context, "clickup");
  if (!connection || connection.status !== "connected") {
    return { reason: "ClickUp isn't connected for this workspace, so the current row cannot be read." };
  }
  const credentials = getIntegrationCredentials(connection);
  if (!credentials.accessToken) {
    return { reason: "The stored ClickUp connection is missing an access token. Reconnect ClickUp." };
  }

  try {
    const [fields, values] = await Promise.all([
      getListCustomFields(listId, credentials.accessToken),
      getTaskFieldValues(taskId, credentials.accessToken),
    ]);

    const read = (names: string[]): string | undefined => {
      const field = findField(fields, names);
      if (!field) return undefined;
      return fieldValueText(field, values.get(field.id));
    };

    const services = read(["services"]);
    const upsell = read(["services upsell"]);

    const row: Partial<HealthTrackerRow> = {
      ...(read(["client name"]) ? { clientName: read(["client name"]) } : {}),
      ...(read(["start date"]) ? { startDate: read(["start date"]) } : {}),
      ...(read(["assignee"]) ? { assignee: read(["assignee"]) } : {}),
      ...(read(["account manager"]) ? { accountManager: read(["account manager"]) } : {}),
      ...(read(["status"]) ? { status: read(["status"]) } : {}),
      ...(read(["mrr"]) ? { mrr: read(["mrr"]) } : {}),
      ...(read(["email"]) ? { email: read(["email"]) } : {}),
      ...(services ? { services: services.split(",").map((entry) => entry.trim()).filter(Boolean) } : {}),
      ...(upsell ? { servicesUpsell: upsell.split(",").map((entry) => entry.trim()).filter(Boolean) } : {}),
    };

    // The four option fields are only carried across when the stored value is one this app
    // recognises -- a renamed ClickUp option read as a free string would show up as a change.
    const health = read(["health"]);
    if (health === "Good" || health === "Neutral" || health === "Risk") row.health = health;
    const caseStatus = read(["case status"]);
    if (caseStatus === "Watching" || caseStatus === "Working" || caseStatus === "downgraded") {
      row.caseStatus = caseStatus;
    }
    const communication = read(["communication type"]);
    if (communication === "Normal" || communication === "Distant" || communication === "Needy") {
      row.communicationType = communication;
    }
    const upselling = read(["upselling"]);
    if (upselling === "Yes!" || upselling === "Possible" || upselling === "No way") {
      row.upselling = upselling;
    }
    const clientType = read(["client type"]);
    if (clientType === "Direct" || clientType === "White Label") row.clientType = clientType;

    return { row };
  } catch (error) {
    return {
      reason: `The current row could not be read: ${error instanceof Error ? error.message : "unknown error"}.`,
    };
  }
}

export interface TrackerCardsResult {
  cards: TrackerCard[];
  /** Field-by-field comparison per card id, computed on the server so both sides agree. */
  diffs: Record<string, ReturnType<typeof diffRow>>;
  /** Why the current rows are missing, when they are. */
  reason?: string;
}

/**
 * Build the cards this touch would write.
 *
 * The Health Tracker row every time, the Risk Register row only when the confirmed score is 6 or
 * below, and one Stakeholder card per person the call told us something new about.
 */
export async function buildTrackerCards(
  context: TenantContext,
  touchId: string,
): Promise<TrackerCardsResult> {
  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);
  if (!touch) {
    throw new Error("Monthly touch not found");
  }
  const client = await dataSource.getClientById(touch.clientId);
  if (!client) {
    throw new Error("The client for this touch is not visible to you.");
  }

  const gate = touch.followThrough?.score;
  if (!gate?.confirmedAt) {
    throw new Error("Confirm the account health score before building the tracker rows.");
  }
  const score = gate.score ?? null;
  const notes = touch.followThrough?.notes;
  const legacy = touch.postMeeting;
  const newerTranscript = touch.transcript?.foundAt &&
    touch.transcript.foundAt > (legacy?.analyzedAt || "");
  const alternative = loomEvidence(touch);
  if (touch.noShow?.resolution === "loom" && !alternative) throw new Error("Send the approved Loom update before drafting trackers.");
  let intelligence = alternative || newerTranscript ? undefined : legacy?.clientIntelligence;
  let intelligenceError: string | undefined;
  const env = getServerEnv();
  if (notes && !intelligence?.stakeholderMap && !touch.followThrough?.trackerCards?.length && hasAnyLlmProvider(env)) {
    try {
      const transcript = alternative ? undefined : await readTouchTranscriptPayload(context, touchId, touch.postMeeting?.transcript);
      intelligence = await generateClientIntelligence(context, env, touch, client, {
        ...(transcript ? { transcript } : {}),
        recapSummary: alternative ? `${notes.summary}\n\n${alternative}` : notes.summary,
        extractedCommitments: notes.clientActions.map((action) => action.what),
        draftTickets: notes.departments.flatMap((group) => group.actions.map((action) => ({
          title: action.what,
          description: group.clientFeedback,
          department: group.department,
        }))),
      }, client.accountManager || "");
    } catch {
      intelligenceError = "MTOS could not draft the tracker details from the call. Review the available fields before approving.";
    }
  }
  const existing = touch.followThrough?.trackerCards || [];
  /**
   * A card the AM has already worked on, by id AND kind.
   *
   * The kind is part of the lookup rather than an afterthought: the stored list is a union, and a
   * card found by id alone could be any of the three, which would let a Risk Register row be
   * spread into the Health Tracker card's place.
   */
  function kept<K extends TrackerCard["kind"]>(
    id: string,
    kind: K,
  ): Extract<TrackerCard, { kind: K }> | undefined {
    const match = existing.find((card) => card.id === id && card.kind === kind);
    return match as Extract<TrackerCard, { kind: K }> | undefined;
  }

  const current = await readHealthTrackerRow(context, client);

  // --- the Health Tracker row -------------------------------------------------
  /**
   * The row as it stands wins over anything MTOS could work out, on every column it already has.
   *
   * Client Name is the clearest case. That column holds the person we deal with -- "Eunjee Song"
   * -- and this used to overwrite it with the business name on every touch, which both lost the
   * contact's name and showed up as a "changed" field the AM had to approve or undo each month.
   * Where the tracker has nothing, the contact is the next best answer and the business name the
   * last, because an account that trades under its own name is a business name legitimately.
   *
   * Assignee, Account Manager and Start date work the same way: carried from the row, and only
   * filled from what MTOS knows when the row is actually empty. Nothing here is invented -- a
   * column with no source stays blank for the AM to fill.
   */
  const healthNext: Partial<HealthTrackerRow> = {
    ...current.row,
    clientName: current.row?.clientName?.trim() || client.contact?.trim() || client.name,
    ...(current.row?.accountManager?.trim() || client.accountManager
      ? { accountManager: current.row?.accountManager?.trim() || client.accountManager! }
      : {}),
    ...(current.row?.assignee?.trim() || client.accountManager
      ? { assignee: current.row?.assignee?.trim() || client.accountManager! }
      : {}),
    nps: score,
    ...(healthFromScore(score) ? { health: healthFromScore(score) } : {}),
    ...(client.mrr ? { mrr: client.mrr } : {}),
    // Written from the call rather than carried over: a "latest comment" that is three months old
    // is worse than an empty one, because it reads as current.
    ...(notes?.summary.trim() ? { latestComment: notes.summary.trim() } : {}),
  };

  const cards: TrackerCard[] = [];
  const keptHealth = kept("health", "health");
  cards.push(
    keptHealth
      ? { ...keptHealth, ...(current.row ? { current: current.row } : {}) }
      : {
          id: "health",
          kind: "health",
          ...(current.row ? { current: current.row } : { isNewRow: true }),
          next: healthNext,
        },
  );

  // --- the Risk Register row --------------------------------------------------
  if (riskRegisterRequired(score) || intelligence?.riskDetected || intelligence?.riskRegister || existing.some((card) => card.kind === "risk")) {
    const meetingDay = touch.scheduledLocalDate || touch.scheduledAt?.slice(0, 10);
    const fromFlags: RiskRegisterEntry = {
      ...(intelligence?.riskRegister || {}),
      ...(healthNext.accountManager || client.accountManager
        ? { accountManager: healthNext.accountManager || client.accountManager! }
        : {}),
      dateFlagged: meetingDay || new Date().toISOString().slice(0, 10),
      ...Object.fromEntries(
        (gate.findings || [])
          .filter((finding) => finding.found)
          .map((finding) => [finding.id, "Yes" as const]),
      ),
      ...(meetingDay ? { lastMonthlyTouch: meetingDay } : {}),
      ...(gate.justification ? { latestComments: gate.justification } : {}),
    };
    cards.push(
      kept("risk", "risk") || {
        id: "risk",
        kind: "risk",
        ...(intelligence?.riskRegister && intelligence.riskRegisterTaskUrl
          ? { current: intelligence.riskRegister }
          : { isNewRow: true }),
        next: withDerivedRiskFields(fromFlags),
      },
    );
  }

  // --- the Stakeholder cards --------------------------------------------------
  const stakeholder = intelligence?.stakeholderMap;
  const keptStakeholder = existing.find((card) => card.kind === "stakeholder");
  cards.push(keptStakeholder || {
    id: "stakeholder",
    kind: "stakeholder",
    isNewRow: true,
    next: {
      ...(client.contact ? { clientName: client.contact } : {}),
      ...(healthNext.assignee ? { assignee: healthNext.assignee } : {}),
      ...(healthNext.clientType ? { clientType: healthNext.clientType } : {}),
      ...stakeholder,
    },
  });

  const diffs: TrackerCardsResult["diffs"] = {};
  for (const card of cards) {
    const fields =
      card.kind === "health"
        ? HEALTH_TRACKER_FIELDS
        : card.kind === "risk"
          ? RISK_REGISTER_FIELDS
          : STAKEHOLDER_FIELDS;
    // The casts are the price of one diff function over three different row shapes; the field
    // list and the row always come from the same branch, so they cannot mismatch.
    diffs[card.id] = diffRow(
      card.current as Record<string, unknown> | undefined,
      card.next as Record<string, unknown>,
      fields as never,
    );
  }

  const reason = [current.reason, intelligenceError].filter(Boolean).join(" ");
  return { cards, diffs, ...(reason ? { reason } : {}) };
}

export async function saveTrackerCards(
  context: TenantContext,
  touchId: string,
  cards: TrackerCard[],
): Promise<TrackerCard[]> {
  const db = getFirebaseAdminDb();
  if (db) {
    await db
      .doc(monthlyTouchPath(context.tenantId, touchId))
      .set({ followThrough: { trackerCards: cards } }, { mergeFields: ["followThrough.trackerCards"] });
  }
  return cards;
}
