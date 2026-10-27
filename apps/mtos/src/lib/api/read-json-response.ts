/**
 * Reads a JSON API response, and fails with something an AM can act on when the body isn't JSON.
 *
 * Our route handlers answer in JSON for every outcome they anticipate, errors included. A body that
 * is not JSON therefore means the request never reached the handler's own error path -- the hosting
 * platform answered instead, in plain text. Calling `response.json()` on that throws
 * `Unexpected token 'A', "An error o"... is not valid JSON`, which names the first character of
 * Vercel's error page and tells the reader nothing about what actually happened.
 *
 * The common case is a function timeout: a long Generate exceeds the platform ceiling and is killed
 * mid-run, so there is no handler left to answer. That is worth saying plainly, because the AM's
 * next move (retry, or fall back to "Refresh data only") depends on knowing it was a timeout rather
 * than a rejected request.
 */

/** Vercel's ceiling, and what `maxDuration` on the touch route is already set to. */
const FUNCTION_CEILING_SECONDS = 300;

function describeNonJsonResponse(response: Response, raw: string): string {
  const body = raw.trim();

  // Vercel names the cause in the body; the status alone is ambiguous (a gateway timeout and a
  // crashed function can both surface as 500).
  if (/FUNCTION_INVOCATION_TIMEOUT/i.test(body) || response.status === 504) {
    const minutes = Math.round(FUNCTION_CEILING_SECONDS / 60);
    return `The server ran out of time (over ${minutes} minutes) and stopped before it could answer. Nothing was saved. Try "Refresh data only" first, then generate again -- or retry in a moment if an upstream service is being slow.`;
  }

  if (/FUNCTION_INVOCATION_FAILED/i.test(body)) {
    return "The server crashed before it could answer. Nothing was saved. Retry, and if it keeps happening the deployment logs will have the reason.";
  }

  if (response.status === 401 || response.status === 403) {
    return "Your session is no longer authorized. Reload the page and sign in again.";
  }

  // Anything else: lead with the status, and carry a little of the body so the real cause is
  // recoverable from a screenshot without digging through logs.
  const excerpt = body.slice(0, 120);
  return excerpt
    ? `The server returned ${response.status} instead of a result: ${excerpt}`
    : `The server returned ${response.status} with an empty body.`;
}

/**
 * Parses `response` as JSON, throwing a readable Error when it isn't. Checking `response.ok` stays
 * the caller's job -- an error body our handlers produced is still JSON, and callers read their own
 * `error` field out of it.
 */
export async function readJsonResponse<T>(response: Response): Promise<T> {
  const raw = await response.text();

  // A handler that answers 204, or ends without a body, is not a failure to report.
  if (!raw.trim() && response.ok) {
    return undefined as T;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(describeNonJsonResponse(response, raw));
  }
}
