/**
 * Do the five call labels resolve against the leads already stored, which have none of the fields?
 *
 * Phase A added `callLabel`, `labelSource`, `calledNumber` and the rest as optional fields. Every
 * lead stored before 8 November 2026 has none of them, and the dashboard has to read those leads
 * anyway -- the owner should not have to re-pull every client to see a screen. So this reads the
 * real stored reviews and runs the resolver over them, which is where a wrong assumption about a
 * missing field shows up as a crash or an "undefined" label rather than in front of an AM.
 *
 * It also reports what the stored data genuinely cannot answer yet: the called number, which only
 * a fresh pull captures. That number is the per-number breakdown's whole input, so knowing how
 * many stored calls lack it is the difference between building that section and pretending to.
 *
 * Read-only. It writes nothing and pulls nothing from GoHighLevel.
 *
 *   npx tsx scripts/verify-call-labels.ts
 */
import { loadEnvConfig } from "@next/env";

import { CALL_LABEL_LABEL, CALL_LABEL_SOURCE_LABEL, resolveCallLabel, isInboundCall, hasRecordedDirection } from "@/src/lib/contracts/call-labels";
import type { CallLabel, CallLabelSource, LeadVerificationReview } from "@/src/lib/mtos-data";
import { leadVerificationPath, tenantUsersCollectionPath } from "@/src/lib/server/firebase/collections";

async function main() {
  loadEnvConfig(process.cwd());
  const { getFirebaseAdminDb } = await import("@/src/lib/server/firebase/admin");
  const db = getFirebaseAdminDb();
  if (!db) {
    console.log("No Firestore admin credentials here — nothing to read.");
    process.exit(1);
  }

  const tenantIds = (await db.collection("tenants").get()).docs.map((doc) => doc.id);
  let reviewsRead = 0;
  let callsSeen = 0;
  let withCalledNumber = 0;
  let withTranscript = 0;
  let withRecordedDirection = 0;
  let inbound = 0;
  const byLabel: Partial<Record<CallLabel, number>> = {};
  const bySource: Partial<Record<CallLabelSource, number>> = {};
  const failures: string[] = [];

  for (const tenantId of tenantIds) {
    // The collection the per-client reviews live in, derived from one document's path.
    const sample = leadVerificationPath(tenantId, "x");
    const collectionPath = sample.slice(0, sample.lastIndexOf("/"));
    const reviews = await db.collection(collectionPath).get();
    console.log(`\n== tenant ${tenantId}: ${reviews.size} stored review(s)`);

    for (const doc of reviews.docs) {
      const review = doc.data() as LeadVerificationReview;
      reviewsRead += 1;
      const calls = (review.leads || []).filter((lead) => lead.type === "call");
      if (!calls.length) {
        console.log(`   ${doc.id}: ${(review.leads || []).length} lead(s), no calls`);
        continue;
      }

      for (const call of calls) {
        callsSeen += 1;
        if (call.calledNumber) withCalledNumber += 1;
        if (call.transcript) withTranscript += 1;
        if (hasRecordedDirection(call.callDirection)) withRecordedDirection += 1;
        if (isInboundCall(call.callDirection)) inbound += 1;

        try {
          const resolved = resolveCallLabel(call);
          if (!resolved.label || !CALL_LABEL_LABEL[resolved.label]) {
            failures.push(`${doc.id}/${call.id}: resolved to a label with no display name`);
          }
          if (!resolved.reason || resolved.reason.length < 10) {
            failures.push(`${doc.id}/${call.id}: resolved with no usable reason`);
          }
          byLabel[resolved.label] = (byLabel[resolved.label] || 0) + 1;
          bySource[resolved.source] = (bySource[resolved.source] || 0) + 1;
        } catch (error) {
          failures.push(`${doc.id}/${call.id}: threw — ${error instanceof Error ? error.message : "unknown"}`);
        }
      }
      console.log(`   ${doc.id}: ${calls.length} call(s) of ${(review.leads || []).length} lead(s), window ${review.window?.since?.slice(0, 10) ?? "?"} → ${review.window?.until?.slice(0, 10) ?? "?"}`);
    }
  }

  console.log(`\n==================== what the stored data supports ====================`);
  console.log(`reviews read:              ${reviewsRead}`);
  console.log(`calls seen:                ${callsSeen}`);
  if (callsSeen) {
    console.log(`every call resolved:       ${failures.length === 0 ? "yes" : `NO — ${failures.length} problem(s)`}`);
    console.log(`\nby label:`);
    for (const [label, count] of Object.entries(byLabel)) {
      console.log(`   ${CALL_LABEL_LABEL[label as CallLabel].padEnd(12)} ${count}  (${Math.round((count / callsSeen) * 100)}%)`);
    }
    console.log(`\ndecided by:`);
    for (const [source, count] of Object.entries(bySource)) {
      console.log(`   ${CALL_LABEL_SOURCE_LABEL[source as CallLabelSource].padEnd(14)} ${count}`);
    }
    console.log(`\nfields the per-number and topic sections need:`);
    console.log(`   called number present:  ${withCalledNumber}/${callsSeen} — only a fresh pull captures this`);
    console.log(`   transcript present:     ${withTranscript}/${callsSeen} — needed for Job seeker and spam-by-wording`);
    console.log(`   direction recorded:     ${withRecordedDirection}/${callsSeen} (${inbound} counted as inbound, the rest assumed)`);
  }

  if (failures.length) {
    console.log(`\nproblems:`);
    for (const failure of failures.slice(0, 20)) {
      console.log(`   ${failure}`);
    }
    process.exit(1);
  }

  console.log(
    `\nNot covered by this check: whether these labels match what an AM would call the same call (that needs somebody listening), and whether a fresh pull really does populate the called number — only running one shows that.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
