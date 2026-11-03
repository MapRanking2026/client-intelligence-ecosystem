/**
 * The rule that keeps a spent Firestore quota from failing a production build.
 *
 * Pure checks only: these exercise the predicate and the wrapper, not Firestore.
 */
import { isFirestoreQuotaError, withQuotaFallback } from "@/src/lib/server/firebase/quota";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean) {
  if (condition) {
    passed += 1;
    return;
  }
  failed += 1;
  console.error(`FAILED: ${label}`);
}

async function main() {
  // The two shapes Firestore actually raises. The gRPC error carries the status name; the message
  // Vercel printed in the build log was "8 RESOURCE_EXHAUSTED: Quota exceeded."
  check(
    "the gRPC status name is recognised",
    isFirestoreQuotaError(new Error("8 RESOURCE_EXHAUSTED: Quota exceeded.")),
  );
  check("the plain wording is recognised", isFirestoreQuotaError(new Error("Quota exceeded.")));

  // Everything else is a real fault and must not be mistaken for the quota.
  check("a missing index is not the quota", !isFirestoreQuotaError(new Error("9 FAILED_PRECONDITION: The query requires an index.")));
  check("a rules rejection is not the quota", !isFirestoreQuotaError(new Error("7 PERMISSION_DENIED: Missing or insufficient permissions.")));
  check("a thrown string is not the quota", !isFirestoreQuotaError("RESOURCE_EXHAUSTED"));
  check("undefined is not the quota", !isFirestoreQuotaError(undefined));

  check(
    "a read that works is returned untouched",
    (await withQuotaFallback("a list", [], async () => ["one"])).join() === "one",
  );

  const dropped = await withQuotaFallback("a list", ["fallback"], async () => {
    throw new Error("8 RESOURCE_EXHAUSTED: Quota exceeded.");
  });
  check("a spent quota returns the fallback", dropped.join() === "fallback");

  // The load-bearing half: a bug must still surface. Swallowing this would turn a broken query
  // into a screen that is silently empty for everyone.
  let rethrown = "";
  try {
    await withQuotaFallback("a list", ["fallback"], async () => {
      throw new Error("9 FAILED_PRECONDITION: The query requires an index.");
    });
  } catch (error) {
    rethrown = error instanceof Error ? error.message : "";
  }
  check("every other failure is rethrown", rethrown.includes("FAILED_PRECONDITION"));

  // The fallback is whatever the caller's return type is, including the nulls and zeroes the
  // services pass -- a falsy fallback must not be confused with "no fallback given".
  check("null is a usable fallback", (await withQuotaFallback("a doc", null, async () => {
    throw new Error("Quota exceeded.");
  })) === null);
  check("zero is a usable fallback", (await withQuotaFallback("a count", 0, async () => {
    throw new Error("Quota exceeded.");
  })) === 0);

  console.log(`\n${passed} passed, ${failed} failed`);
  console.log(
    "Not covered: a real Firestore read, and whether the production build prerenders these pages.",
  );
  if (failed) process.exit(1);
}

void main();
