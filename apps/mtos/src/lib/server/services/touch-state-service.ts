import type { TenantContext } from "@/src/lib/contracts/mtos";
import type { TouchDraftPatch } from "@/src/lib/contracts/touch-draft";
import {
  advanceProgress,
  followThroughDueAt,
  isTouchStep,
  type TouchStep,
} from "@/src/lib/contracts/touch-progress";
import type {
  MonthlyTouchRecord,
  TouchAgendaEmailState,
  TouchLiveState,
  TouchReviewState,
} from "@/src/lib/mtos-data";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import { getAccountManagerProfile } from "@/src/lib/server/services/user-service";

/**
 * Where a touch has got to, and the autosave behind every edit on its screens.
 *
 * Two things are kept apart here on purpose.
 *
 * `progress` is the furthest step reached. It moves only forward, and only when a step is actually
 * completed -- approving the brief, starting the call, finishing the follow-through. Navigating
 * back to read something never moves it, so the step a touch resumes at is the step the AM was
 * working in rather than the last page they happened to look at.
 *
 * The drafts (`review`, `agendaEmail`, `live`) are saved continuously as the AM types. Each save
 * merges into whatever is already stored, inside a transaction, because two of these screens
 * autosave while a background job may be writing the same document -- a plain overwrite would drop
 * whichever half lost the race, and what it would drop is text somebody typed.
 */

export interface TouchStateResult {
  progress: TouchStep;
  savedAt: string;
  /** Present once the call has ended: 24 business hours later, on the AM's own clock. */
  followThroughDueAt?: string;
}

/** Firestore rejects undefined; a patch built from form state is full of it. */
function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function requireDb() {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firestore is not configured, so this touch's progress cannot be saved.");
  }
  return db;
}

/**
 * Move the touch's marker forward to `step`.
 *
 * A request to move it backwards is not an error and is not a no-op either: it returns the stored
 * step, so a caller that has drifted behind (an older tab, a retried request) is corrected rather
 * than allowed to rewind a touch whose call has already happened.
 */
export async function advanceTouchProgress(
  context: TenantContext,
  touchId: string,
  step: TouchStep,
): Promise<TouchStateResult> {
  if (!isTouchStep(step)) {
    throw new Error(`"${step}" is not a step of a Monthly Touch.`);
  }
  const db = requireDb();
  const ref = db.doc(monthlyTouchPath(context.tenantId, touchId));
  const savedAt = new Date().toISOString();

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      throw new Error("Monthly touch not found");
    }
    const current = snapshot.data() as Partial<MonthlyTouchRecord>;
    const progress = advanceProgress(current.progress, step);
    tx.set(
      ref,
      { progress, progressUpdatedAt: savedAt },
      { mergeFields: ["progress", "progressUpdatedAt"] },
    );
    return {
      progress,
      savedAt,
      ...(current.followThrough?.dueAt ? { followThroughDueAt: current.followThrough.dueAt } : {}),
    };
  });
}

/**
 * Save an edit from one of the touch's screens.
 *
 * Returns the step and the save time so the screen can show "last saved" without a second request
 * -- an autosave that has to be followed by a read to be believed is an autosave the AM watches
 * instead of working through.
 *
 * Setting `live.callEndedAt` is the one patch with a consequence beyond itself: it starts the only
 * clock in the touch, so the follow-through deadline is computed here, from the AM's own time zone,
 * rather than on whichever screen happens to render the countdown.
 */
export async function saveTouchDraft(
  context: TenantContext,
  touchId: string,
  patch: TouchDraftPatch,
): Promise<TouchStateResult> {
  const db = requireDb();
  const ref = db.doc(monthlyTouchPath(context.tenantId, touchId));
  const savedAt = new Date().toISOString();
  const timeZone = (await getAccountManagerProfile(context)).timeZone;

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      throw new Error("Monthly touch not found");
    }
    const current = snapshot.data() as Partial<MonthlyTouchRecord>;
    const update: Record<string, unknown> = {};
    const fields: string[] = [];

    if (patch.review) {
      const next: TouchReviewState = {
        declinedSections: [],
        sectionEdits: {},
        coaching: {},
        ...current.review,
        ...defined(patch.review),
        savedAt,
      };
      update.review = next;
      fields.push("review");
    }

    if (patch.agendaEmail) {
      const next: TouchAgendaEmailState = {
        subject: "",
        html: "",
        ...current.agendaEmail,
        ...defined(patch.agendaEmail),
        savedAt,
      };
      update.agendaEmail = next;
      fields.push("agendaEmail");
    }

    let dueAt = current.followThrough?.dueAt;
    if (patch.live) {
      const next: TouchLiveState = {
        format: "guide",
        notes: {},
        ...current.live,
        ...defined(patch.live),
        savedAt,
      };
      update.live = next;
      fields.push("live");

      // The deadline is set once, from the first recorded end of the call. Recomputing it on every
      // later save would quietly move the deadline whenever the AM edited a note afterwards.
      if (next.callEndedAt && !dueAt) {
        dueAt = followThroughDueAt(next.callEndedAt, timeZone);
        if (dueAt) {
          update.followThrough = { ...current.followThrough, dueAt };
          fields.push("followThrough");
        }
      }
    }

    if (!fields.length) {
      throw new Error("Nothing to save.");
    }

    tx.set(ref, update, { mergeFields: fields });
    return {
      progress: current.progress && isTouchStep(current.progress) ? current.progress : "prep",
      savedAt,
      ...(dueAt ? { followThroughDueAt: dueAt } : {}),
    };
  });
}
