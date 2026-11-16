import { canDeleteTestTouch } from "@/src/lib/contracts/touch-progress";
import { randomUUID } from "node:crypto";
import type { MonthlyTouchRecord } from "@/src/lib/mtos-data";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { clientPath, monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";
import { withVerifiedLeadMix } from "@/src/lib/contracts/lead-mix";

export async function getMonthlyTouchQueueView(context: TenantContext) {
  const dataSource = getMtosDataSource(context);
  const touches = await dataSource.getMonthlyTouches();

  const queue = await Promise.all(
    touches.map(async (touch) => ({
      touch,
      client: (await dataSource.getClientById(touch.clientId)) ?? null,
    })),
  );

  return {
    context,
    queue,
  };
}

export async function getMonthlyTouchWorkspaceView(context: TenantContext, touchId: string) {
  const dataSource = getMtosDataSource(context);
  const touch = await dataSource.getMonthlyTouchById(touchId);

  if (!touch) {
    return null;
  }

  const [client, commitments, opportunities] = await Promise.all([
    dataSource.getClientById(touch.clientId),
    dataSource.getCommitments(touch.clientId),
    dataSource.getOpportunities(touch.clientId),
  ]);

  if (!client) {
    return null;
  }

  /*
    The scorecard's two lead-mix tiles, filled in from the verification review stored on this touch.

    Done on the way out as well as during the preparation, because every touch prepared before
    11 November 2026 has a stored scorecard whose "Form submissions" and "Calls missed" are null --
    they were hard-coded that way -- and an AM looking at one of those briefs should not have to
    sit through another account review to see numbers MTOS already holds. The review is already on
    the touch document (the review screen renders it below the brief), so this costs no extra read.

    Only ever adds: a scorecard that already carries these figures from its own preparation keeps
    them, and a touch with no review is left exactly as it is.
  */
  const touchWithLeadMix =
    touch.prepPack && touch.leadVerification
      ? {
          ...touch,
          prepPack: {
            ...touch.prepPack,
            businessScorecard: withVerifiedLeadMix(touch.prepPack.businessScorecard, touch.leadVerification),
          },
        }
      : touch;

  return {
    context,
    touch: touchWithLeadMix,
    client,
    commitments,
    opportunities,
  };
}

export async function startNewMonthlyTouch(
  context: TenantContext,
  previous: MonthlyTouchRecord,
  options: { scheduledAt: string; timeZone: string; deletePrevious?: boolean | undefined },
) {
  const client = await getMtosDataSource(context).getClientById(previous.clientId);
  const db = getFirebaseAdminDb();
  if (!client || !db) throw new Error("The client or its storage is unavailable.");
  const id = `touch-${randomUUID()}`;
  const clientRef = db.doc(clientPath(context.tenantId, client.id));
  const previousRef = db.doc(monthlyTouchPath(context.tenantId, previous.id));
  const scheduled = new Date(options.scheduledAt);
  const touchDate = new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: options.timeZone,
  }).format(scheduled);
  const dateParts = new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: options.timeZone,
  }).formatToParts(scheduled);
  const localDate = ["year", "month", "day"].map((type) => dateParts.find((part) => part.type === type)?.value).join("-");
  return db.runTransaction(async (transaction) => {
    const current = (await transaction.get(clientRef)).data()?.touchId;
    if (typeof current !== "string") throw new Error("The client has no current Monthly Touch.");
    if (current !== previous.id) return { touchId: current };
    if (options.deletePrevious) {
      const currentTouch = (await transaction.get(previousRef)).data() as MonthlyTouchRecord | undefined;
      if (!currentTouch || !canDeleteTestTouch(currentTouch)) {
        throw new Error("This touch has already been used for approval or delivery and must stay in history.");
      }
      transaction.update(previousRef, { deletedAt: new Date().toISOString() });
    }
    const touch: MonthlyTouchRecord = {
      id,
      clientId: client.id,
      status: "Preparing",
      progress: "prep",
      readinessScore: 0,
      scheduledAt: options.scheduledAt,
      scheduledLocalDate: localDate,
      confidenceScore: 0,
      executiveBrief: "",
      agenda: [],
      wins: [],
      risks: [],
      opportunities: [],
      talkingPoints: [],
      commitments: [],
      aiRecommendations: [],
      updatedAt: new Date().toISOString(),
    };
    transaction.create(db.doc(monthlyTouchPath(context.tenantId, id)), touch);
    transaction.update(clientRef, { touchId: id, touchDate, manualTouchStartAt: options.scheduledAt });
    return { touchId: id };
  });
}

export async function deletePreviousTestTouch(context: TenantContext, touch: MonthlyTouchRecord) {
  const db = getFirebaseAdminDb();
  if (!db) throw new Error("MTOS storage is unavailable.");
  const clientRef = db.doc(clientPath(context.tenantId, touch.clientId));
  const touchRef = db.doc(monthlyTouchPath(context.tenantId, touch.id));
  return db.runTransaction(async (transaction) => {
    const client = (await transaction.get(clientRef)).data();
    const current = (await transaction.get(touchRef)).data() as MonthlyTouchRecord | undefined;
    if (!client || client.touchId === touch.id) throw new Error("Start a new Monthly Touch before deleting this one.");
    if (!current || !canDeleteTestTouch(current)) throw new Error("This touch has approval or delivery history and cannot be deleted as a test.");
    transaction.update(touchRef, { deletedAt: new Date().toISOString() });
    return { touchId: client.touchId as string };
  });
}
