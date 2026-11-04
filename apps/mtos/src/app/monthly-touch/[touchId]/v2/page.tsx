import CanonicalRunSheet from "../page";

/**
 * Rendered per request, never prerendered.
 *
 * Declared here rather than re-exported from the canonical page: Next reads the route segment
 * config by static analysis, and a re-exported binding is not a literal it can see. Getting this
 * wrong would prerender a tenant's page at build time -- the failure of 2026-11-02.
 */
export const dynamic = "force-dynamic";

/**
 * `/monthly-touch/{id}/v2` -- the address the workflow was built at, kept working.
 *
 * The workflow now answers at `/monthly-touch/{id}`, but this URL is already in places MTOS does
 * not control: ClickUp tickets, Slack threads, bookmarks, and notification rows written before the
 * move. It renders the same page rather than redirecting, because the deep links that matter carry
 * a fragment -- `global-search-service.ts` sends people to `?view=review#brief-{section}` -- and a
 * fragment never reaches the server, so a redirect would land them at the top of the brief and
 * quietly lose the section they clicked.
 */
export default CanonicalRunSheet;
