import type { UserPreferences } from "@/src/lib/contracts/user-preferences";

/**
 * Save one or two preferences from wherever the AM changed them.
 *
 * Deliberately swallows its own failure. The callers are the header's two toggles, which have
 * already applied the change to the document; an alert because a preference could not be written
 * would interrupt the AM over something they can simply do again. Settings is the screen that
 * reports a failed save, because there the save is the point.
 */
export async function savePreference(patch: UserPreferences): Promise<boolean> {
  try {
    const response = await fetch("/api/settings/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    return response.ok;
  } catch {
    return false;
  }
}
