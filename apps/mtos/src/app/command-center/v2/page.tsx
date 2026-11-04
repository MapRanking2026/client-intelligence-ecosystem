import CanonicalCommandCenter from "../page";

/**
 * Rendered per request, never prerendered. Declared, not re-exported: see the note on the
 * run-sheet alias -- Next reads this by static analysis and cannot follow a re-exported binding.
 */
export const dynamic = "force-dynamic";

/**
 * `/command-center/v2` -- kept working now that v2 is simply the Command Center.
 *
 * Same reasoning as the run-sheet alias: this address was handed out while the new home screen was
 * being tried, so it stays answerable instead of 404ing on someone's bookmark.
 */
export default CanonicalCommandCenter;
