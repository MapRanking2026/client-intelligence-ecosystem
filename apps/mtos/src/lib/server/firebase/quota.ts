/**
 * What a page does when Firestore's quota runs out.
 *
 * The project runs on a Firestore plan with a daily read quota, and when it is spent every read
 * fails with `RESOURCE_EXHAUSTED` until the quota rolls over. That is not a fault in the code and
 * it is not permanent, so a screen that happens to be rendered during it should come up with
 * nothing in it rather than an error -- and the production BUILD, which prerenders those same
 * screens, must not fail on it either. One unguarded read is enough to stop a deploy that has
 * nothing to do with the data it was reading.
 *
 * `FirestoreMtosDataSource` has wrapped its own reads this way since before this module existed;
 * this is that behaviour lifted out so the services that read Firestore directly can share it.
 */

/** True for the error Firestore raises when the project's read quota is spent. */
export function isFirestoreQuotaError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.message.includes("RESOURCE_EXHAUSTED") || error.message.includes("Quota exceeded");
}

/**
 * Run a read, and return `fallback` if the quota is spent.
 *
 * Only the quota error is swallowed. Every other failure -- a missing index, a rules rejection, a
 * malformed path -- is a real fault and is rethrown, because hiding those turns a bug into an
 * empty screen nobody can explain.
 */
export async function withQuotaFallback<T>(
  label: string,
  fallback: T,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isFirestoreQuotaError(error)) {
      console.warn(`Firestore quota exceeded while loading ${label}. Returning a safe fallback.`);
      return fallback;
    }

    throw error;
  }
}
