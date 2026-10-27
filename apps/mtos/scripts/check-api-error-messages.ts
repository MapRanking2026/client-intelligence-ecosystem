/**
 * Pins `describeApiError` against the error bodies our integrations actually receive.
 *
 * This exists because of a real failure: a monthly touch prep showed "Reviews could not be read:
 * Request failed with status 403" with no reason, four times over. Google had explained itself in
 * the response body every time -- the reader tested `typeof payload.error === "string"`, Google
 * sends `error` as an OBJECT, so the explanation was dropped and only the status survived.
 *
 * The fixtures below are the shapes Google and the other integrations really return.
 *
 * Run with: npm run check:api-errors
 */
import { describeApiError } from "@/src/lib/server/integration-sync";

let failures = 0;

function check(label: string, actual: string, expected: string | RegExp) {
  const passed = expected instanceof RegExp ? expected.test(actual) : actual === expected;
  if (!passed) {
    failures += 1;
  }
  console.log(`${passed ? "PASS" : "FAIL"}  ${label}`);
  if (!passed) {
    console.log(`        expected ${expected}`);
    console.log(`        actual   ${actual}`);
  }
}

// The exact body Google returns when an API is not enabled for the Cloud project -- the case that
// produced the bare 403 on reviews, posts and photos.
check(
  "Google: API disabled for the project",
  describeApiError(
    {
      error: {
        code: 403,
        message:
          "Google My Business API has not been used in project 123456789 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/mybusiness.googleapis.com/overview?project=123456789 then retry.",
        status: "PERMISSION_DENIED",
      },
    },
    403,
  ),
  /^Google My Business API has not been used in project 123456789 .*\(PERMISSION_DENIED\)$/,
);

check(
  "Google: caller lacks permission on the location",
  describeApiError(
    { error: { code: 403, message: "The caller does not have permission", status: "PERMISSION_DENIED" } },
    403,
  ),
  "The caller does not have permission (PERMISSION_DENIED)",
);

// What the Q&A endpoint returned: a 404 rather than a 403.
check(
  "Google: resource or service not found",
  describeApiError(
    { error: { code: 404, message: "Requested entity was not found.", status: "NOT_FOUND" } },
    404,
  ),
  "Requested entity was not found. (NOT_FOUND)",
);

check(
  "Google: symbolic reason but no message",
  describeApiError({ error: { code: 429, status: "RESOURCE_EXHAUSTED" } }, 429),
  "RESOURCE_EXHAUSTED (status 429)",
);

// Other integrations report errors as a plain string or a top-level message; both already worked
// and must keep working.
check("string error field", describeApiError({ error: "Team not authorized" }, 401), "Team not authorized");
check("top-level message field", describeApiError({ message: "Oauth token expired" }, 401), "Oauth token expired");

// No usable body at all -- the old generic line is still the right answer here.
check("empty body", describeApiError({}, 500), "Request failed with status 500");
check(
  "error present but unusable",
  describeApiError({ error: { code: 500 } }, 500),
  "Request failed with status 500",
);
check("error is an array", describeApiError({ error: ["nope"] }, 400), "Request failed with status 400");
check("blank strings are not messages", describeApiError({ error: "   ", message: "  " }, 400), "Request failed with status 400");

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll API error-message checks passed.");
