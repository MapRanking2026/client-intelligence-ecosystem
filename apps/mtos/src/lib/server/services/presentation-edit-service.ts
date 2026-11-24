import type { TenantContext } from "@/src/lib/contracts/mtos";
import {
  EDIT_LIMITS,
  editableSlide,
  normalizeSlide,
  slidesDiffer,
} from "@/src/lib/contracts/presentation-edit";
import type { MonthlyTouchRecord, Presentation, PresentationSlide } from "@/src/lib/mtos-data";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { monthlyTouchPath } from "@/src/lib/server/firebase/collections";
import { getAccountManagerProfile } from "@/src/lib/server/services/user-service";

/**
 * Saving an account manager's edits to a generated deck.
 *
 * The browser sends the slides it has on screen, in the order it has them. This function decides
 * what is allowed to come back from a browser at all, and the answer is: text, structure and
 * order. Three things are reattached here rather than trusted from the request.
 *
 * **The rank comparison.** Its captured image and scan dates are the provider's measurement. The
 * incoming slide carries a `generatedIndex` pointing at the generated slide it came from, and the
 * comparison is copied across from what is already stored under that index. A request that invents
 * one is ignored, because the field is never read off the request.
 *
 * **The generated snapshot.** The first time a slide actually changes, what the model wrote is
 * stored beside it, so the AM can revert that one slide without regenerating the deck. Stored once
 * and never overwritten: the baseline is what the model wrote, not the state before the last edit.
 *
 * **The edited marker.** Derived by comparing against the snapshot, so a slide edited and then put
 * back by hand stops claiming to be edited.
 *
 * `expectedGeneratedAt` is the collision guard. Generating a deck takes minutes, and an AM editing
 * an old deck in another tab must not land their slides on top of a fresh one -- the save is
 * refused and the screen says to reload, rather than silently discarding the new deck.
 */

export interface SavePresentationSlidesResult {
  savedAt: string;
  slides: PresentationSlide[];
  editedCount: number;
}

/** Which of the touch's two decks is being edited. The no-show deck is a separate record. */
export type PresentationTarget = "touch" | "loom";

function presentationOf(touch: Partial<MonthlyTouchRecord>, target: PresentationTarget) {
  return target === "loom" ? touch.noShow?.presentation : touch.presentation;
}

export async function savePresentationSlides(
  context: TenantContext,
  touchId: string,
  options: {
    target: PresentationTarget;
    slides: PresentationSlide[];
    expectedGeneratedAt?: string;
  },
): Promise<SavePresentationSlidesResult> {
  const db = getFirebaseAdminDb();
  if (!db) {
    throw new Error("Firestore is not configured, so these slide edits cannot be saved.");
  }
  if (options.slides.length > EDIT_LIMITS.slides) {
    throw new Error(`A deck holds up to ${EDIT_LIMITS.slides} slides.`);
  }
  if (!options.slides.length) {
    throw new Error("A deck needs at least one slide. Delete the deck by regenerating it instead.");
  }

  const ref = db.doc(monthlyTouchPath(context.tenantId, touchId));
  const savedAt = new Date().toISOString();
  const editedBy = (await getAccountManagerProfile(context)).name || "";

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) {
      throw new Error("Monthly touch not found");
    }
    const current = snapshot.data() as Partial<MonthlyTouchRecord>;
    const stored = presentationOf(current, options.target);
    if (!stored || stored.status !== "generated" || !stored.slides?.length) {
      throw new Error("There is no generated presentation on this touch to edit.");
    }
    if (options.expectedGeneratedAt && stored.generatedAt && options.expectedGeneratedAt !== stored.generatedAt) {
      throw new Error(
        "This deck was regenerated while you were editing. Reload the page to see the new slides — your edits were not saved over it.",
      );
    }

    // Generated slides by their original position, which is how an incoming slide names the one it
    // came from. Later duplicates of the same generated slide legitimately share an entry.
    const byIndex = new Map<number, PresentationSlide>();
    stored.slides.forEach((slide, index) => {
      const key = slide.generatedIndex ?? index;
      if (!byIndex.has(key)) byIndex.set(key, slide);
    });

    const slides = options.slides.map((incoming) => {
      const normalized = normalizeSlide(incoming);
      const origin = normalized.generatedIndex === undefined ? undefined : byIndex.get(normalized.generatedIndex);
      if (!origin) {
        // A slide the AM added: nothing to compare it against and no evidence to reattach.
        return { ...normalized, edited: true };
      }
      const baseline = origin.generatedSnapshot || editableSlide(origin);
      const changed = slidesDiffer(normalized, baseline);
      return {
        ...normalized,
        ...(origin.rankComparison ? { rankComparison: origin.rankComparison } : {}),
        ...(origin.media ? { media: origin.media } : {}),
        ...(changed ? { generatedSnapshot: editableSlide(baseline), edited: true } : {}),
      };
    });

    const editedCount = slides.filter((slide) => slide.edited).length;
    const next: Presentation = {
      ...stored,
      slides,
      ...(editedCount ? { editedAt: savedAt, ...(editedBy ? { editedBy } : {}) } : {}),
    };

    tx.update(ref, options.target === "loom" ? { "noShow.presentation": next } : { presentation: next });
    return { savedAt, slides, editedCount };
  });
}
