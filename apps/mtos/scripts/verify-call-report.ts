/**
 * Does the dashboard's arithmetic hold up against a real client's stored calls?
 *
 * `check:call-report` proves the sums are right on data this file wrote by hand. That is not the
 * same question as whether they are right on the pulls actually sitting in Firestore, where
 * timestamps are missing, phone numbers arrive in three spellings, and nobody recorded which
 * tracking line took the call. So this reads the real stored reviews, runs every Phase B function
 * over them, and prints what the dashboard WOULD show -- per client, for a real 30-day window.
 *
 * It also audits two things only live data can answer:
 *
 *  - whether the per-client totals reconcile (tiles, donut and columns must agree to the call), and
 *  - how much of each section has no input yet, so a section is built rather than faked.
 *
 * Read-only. It writes nothing and pulls nothing from GoHighLevel.
 *
 *   npx tsx scripts/verify-call-report.ts
 */
import { loadEnvConfig } from "@next/env";

import { CALL_LABELS, CALL_LABEL_LABEL, CALL_LABEL_TONE } from "@/src/lib/contracts/call-labels";
import { columnLayout, donutArcs } from "@/src/lib/contracts/brief-charts";
import { buildCallTable, withLabelProvenance } from "@/src/lib/contracts/call-dashboard";
import {
  reportRecordings,
  reportSummaryLines,
  toReportRows,
} from "@/src/lib/contracts/call-client-report";
import {
  callMix,
  callsByNumber,
  callsInPeriod,
  callsOverTime,
  comparisonMeasures,
  comparisonPeriod,
  headlineTiles,
  resolvePeriod,
  summariseCallers,
  toCallRecords,
  type CallPeriod,
} from "@/src/lib/contracts/call-report";
import type { LeadVerificationReview } from "@/src/lib/mtos-data";
import { leadVerificationPath } from "@/src/lib/server/firebase/collections";

function percent(value: number | undefined): string {
  return value === undefined ? "—" : `${Math.round(value * 100)}%`;
}

let reportSentences = 0;

async function main() {
  loadEnvConfig(process.cwd());
  const { getFirebaseAdminDb } = await import("@/src/lib/server/firebase/admin");
  const db = getFirebaseAdminDb();
  if (!db) {
    console.log("No Firestore admin credentials here — nothing to read.");
    process.exit(1);
  }

  const tenantIds = (await db.collection("tenants").get()).docs.map((doc) => doc.id);

  let clientsWithCalls = 0;
  let totalCalls = 0;
  let placeableCalls = 0;
  let droppedNoTimestamp = 0;
  let droppedNoCallEvidence = 0;
  let typedAsCalls = 0;
  let callsWithNumber = 0;
  let callsWithContact = 0;
  let callsWithPhone = 0;
  let reconciliationFailures = 0;
  let handDecided = 0;
  let handCredited = 0;
  let handOverruled = 0;
  const problems: string[] = [];

  for (const tenantId of tenantIds) {
    const sample = leadVerificationPath(tenantId, "x");
    const collectionPath = sample.slice(0, sample.lastIndexOf("/"));
    const reviews = await db.collection(collectionPath).get();

    for (const doc of reviews.docs) {
      const review = doc.data() as LeadVerificationReview;
      const leads = review.leads || [];
      const { calls, skippedNoTimestamp, skippedNoCallEvidence } = toCallRecords(leads);
      droppedNoTimestamp += skippedNoTimestamp;
      droppedNoCallEvidence += skippedNoCallEvidence;
      typedAsCalls += leads.filter((lead) => lead.type === "call").length;
      if (!calls.length) continue;

      clientsWithCalls += 1;
      totalCalls += calls.length;
      placeableCalls += calls.length;
      callsWithNumber += calls.filter((call) => call.calledNumber).length;
      callsWithContact += calls.filter((call) => call.contactId).length;
      callsWithPhone += calls.filter((call) => call.callerPhone).length;

      // The window the stored pull actually covers, so the figures are not all zero. Falling back
      // to a rolling 30 days from the newest stored call, because a pull from August must still
      // produce a readable dashboard.
      const newest = calls.reduce((max, call) => Math.max(max, Date.parse(call.at)), 0);
      const period: CallPeriod =
        review.window?.since && review.window?.until
          ? { start: review.window.since, end: review.window.until }
          : resolvePeriod("last_30_days", new Date(newest));

      const inPeriod = callsInPeriod(calls, period);
      const earlier = comparisonPeriod(period, "previous_period")!;
      const before = callsInPeriod(calls, earlier);

      // A stored pull covers ONE window, so `before` is empty because nothing was ever pulled for
      // it -- not because nobody rang. Passing that empty array as history would report every
      // caller as new, for ever. See the note on `summariseCallers`.
      const history = before.length > 0 ? before : undefined;

      const tiles = headlineTiles(inPeriod, before.length > 0 ? before : undefined);
      const mix = callMix(inPeriod);
      const columns = callsOverTime(inPeriod, period);
      const callers = summariseCallers(inPeriod, history);
      const numbers = callsByNumber(inPeriod);
      const measures = comparisonMeasures(inPeriod, before.length > 0 ? before : undefined);

      // Phase C's two shapes, built from this client's real calls. The geometry is unit-tested on
      // made-up numbers in check:brief-charts; what live data adds is the awkward cases those
      // fixtures do not have -- a client with a single label, a 31-day window, a quiet fortnight.
      const donut = donutArcs(
        mix.slices.map((slice) => ({ label: slice.name, value: slice.count, color: slice.tone })),
      );
      const stacked = columnLayout({
        legend: CALL_LABELS.map((label) => ({
          key: label,
          label: CALL_LABEL_LABEL[label],
          color: CALL_LABEL_TONE[label],
        })),
        buckets: columns.buckets.map((bucket) => ({
          key: bucket.key,
          label: bucket.label,
          segments: CALL_LABELS.map((label) => ({
            key: label,
            label: CALL_LABEL_LABEL[label],
            value: bucket.counts[label],
            color: CALL_LABEL_TONE[label],
          })),
        })),
      });

      const donutShare = donut.reduce((sum, arc) => sum + arc.share, 0);
      if (donut.length && Math.abs(donutShare - 1) > 1e-9) {
        reconciliationFailures += 1;
        problems.push(`${doc.id}: the donut's slices sum to ${donutShare}, not 1`);
      }
      if (donut.some((arc) => !arc.path.startsWith("M ") || !arc.path.trim().endsWith("Z"))) {
        reconciliationFailures += 1;
        problems.push(`${doc.id}: a donut arc is not a closed path, so its fill would leak`);
      }
      if (donut.reduce((sum, arc) => sum + arc.value, 0) !== inPeriod.length) {
        reconciliationFailures += 1;
        problems.push(`${doc.id}: the donut holds a different number of calls than the tiles`);
      }
      const tallest = Math.max(
        0,
        ...stacked.buckets.map((bucket) =>
          bucket.segments.reduce((sum, segment) => sum + segment.heightPercent, 0),
        ),
      );
      if (tallest > 100.0001) {
        reconciliationFailures += 1;
        problems.push(`${doc.id}: a stacked column reaches ${tallest}% of the panel, so it overflows`);
      }
      if (stacked.buckets.reduce((sum, bucket) => sum + bucket.total, 0) !== inPeriod.length) {
        reconciliationFailures += 1;
        problems.push(`${doc.id}: the columns hold a different number of calls than the tiles`);
      }
      const labelled = stacked.buckets.filter((bucket) => bucket.showLabel).length;
      // Phase D's table, from the same real calls.
      const table = withLabelProvenance(
        buildCallTable(calls, period, {}, { everPulled: true, limit: 250 }),
        review.leads || [],
      );
      const tabSum = table.tabs.slice(1).reduce((sum, tab) => sum + tab.count, 0);
      if (tabSum !== table.tabs[0].count) {
        reconciliationFailures += 1;
        problems.push(`${doc.id}: the filter tabs sum to ${tabSum} but All says ${table.tabs[0].count}`);
      }
      if (table.tabs[0].count !== inPeriod.length) {
        reconciliationFailures += 1;
        problems.push(`${doc.id}: the table's All tab says ${table.tabs[0].count}, the tiles say ${inPeriod.length}`);
      }
      if (table.state !== "rows" && inPeriod.length > 0) {
        reconciliationFailures += 1;
        problems.push(`${doc.id}: ${inPeriod.length} calls in the period but the table reports "${table.state}"`);
      }
      // A row must never show a label with no display name, and never a bare snake_case word.
      const badLabel = table.rows.find((row) => !row.labelName || row.labelName.includes("_"));
      if (badLabel) {
        reconciliationFailures += 1;
        problems.push(`${doc.id}: row ${badLabel.id} would show the label "${badLabel.labelName}"`);
      }
      const noReason = table.rows.filter((row) => !row.reason || row.reason.length < 10).length;
      if (noReason) {
        reconciliationFailures += 1;
        problems.push(`${doc.id}: ${noReason} row(s) would show a label with no reason behind it`);
      }
      const byHand = table.rows.filter((row) => row.overridden).length;
      // Of the rows a person decided, how many the who-decided-it column credits to them. The gap
      // is rows where a recorded no-answer overruled the person, which is correct -- it is counted
      // separately rather than hidden. Before 9 November 2026 every hand-set VERDICT sat in that
      // gap and read "Automatic rule", so the loop below fails on any other reason for being there.
      const creditedToPerson = table.rows.filter((row) => row.source === "manual").length;
      const overruled = table.rows.filter((row) => row.overridden && row.source !== "manual");
      handDecided += byHand;
      handCredited += creditedToPerson;
      handOverruled += overruled.length;
      for (const row of overruled) {
        if (!/Nobody answered/.test(row.reason || "")) {
          reconciliationFailures += 1;
          problems.push(`${doc.id}: row ${row.id} was set by hand but credited to "${row.sourceName}"`);
        }
      }
      const withRecording = table.rows.filter((row) => row.recordingUrl).length;
      const withTopic = table.rows.filter((row) => row.topic).length;

      // Phase E's client report, from the same real rows. The setting is read live further down;
      // here both answers are exercised, because the one that must never leak is the default.
      const reportRowsOff = toReportRows(table.rows, false);
      const serialisedOff = JSON.stringify(reportRowsOff);
      if (serialisedOff.includes("recording") || serialisedOff.includes("messageId")) {
        reconciliationFailures += 1;
        problems.push(`${doc.id}: a recording URL survived into the report with recordings switched off`);
      }
      if (serialisedOff.includes("sourceName") || serialisedOff.includes("\"reason\"")) {
        reconciliationFailures += 1;
        problems.push(`${doc.id}: the report rows still carry our own label provenance`);
      }
      const reportRowsOn = toReportRows(table.rows, true);
      if (reportRowsOn.filter((row) => row.recordingUrl).length !== withRecording) {
        reconciliationFailures += 1;
        problems.push(`${doc.id}: switching recordings on did not carry all ${withRecording} through`);
      }
      // Off must be silent, not withheld-and-announced. On a client with recordings this is the
      // check that would catch a sentence like "89 of these calls were recorded" coming back.
      const sectionOff = reportRecordings(reportRowsOff, false);
      if (sectionOff.note !== undefined || sectionOff.available !== 0 || sectionOff.rows.length) {
        reconciliationFailures += 1;
        problems.push(`${doc.id}: the report would mention recordings with the setting off`);
      }
      const sectionOn = reportRecordings(reportRowsOn, true);
      if (withRecording > 0 && sectionOn.available !== withRecording) {
        reconciliationFailures += 1;
        problems.push(`${doc.id}: switching recordings on offered ${sectionOn.available} of ${withRecording}`);
      }
      const summary = reportSummaryLines({
        mix,
        tiles,
        callers,
        periodLabel: "Last 30 days",
        comparisonLabel: undefined,
      });
      const prose = [summary.headline, ...summary.lines].join(" ");
      if (/NaN|undefined|Infinity|\$\{/.test(prose)) {
        reconciliationFailures += 1;
        problems.push(`${doc.id}: the report's own sentences read "${prose.slice(0, 120)}"`);
      }
      if (inPeriod.length === 0 && summary.goodCallRate !== undefined) {
        reconciliationFailures += 1;
        problems.push(`${doc.id}: a good-call rate of ${summary.goodCallRate} over no calls at all`);
      }
      if (inPeriod.length > 0 && !summary.headline.includes(inPeriod.length.toLocaleString("en-US"))) {
        reconciliationFailures += 1;
        problems.push(`${doc.id}: the report headline "${summary.headline}" does not count ${inPeriod.length} calls`);
      }
      reportSentences += summary.lines.length;


      // The three views of the same calls must agree, or a client sees one figure in a tile and a
      // different one in the chart below it.
      const tileTotal = tiles[0].value;
      const labelSum = tiles.slice(1).reduce((sum, tile) => sum + tile.value, 0);
      const columnSum = columns.buckets.reduce((sum, bucket) => sum + bucket.total, 0);
      const sliceSum = mix.slices.reduce((sum, slice) => sum + slice.count, 0);
      const agrees =
        tileTotal === labelSum &&
        tileTotal === columnSum &&
        tileTotal === sliceSum &&
        tileTotal === inPeriod.length;
      if (!agrees) {
        reconciliationFailures += 1;
        problems.push(
          `${doc.id}: tiles ${tileTotal}, labels ${labelSum}, columns ${columnSum}, slices ${sliceSum}, calls ${inPeriod.length} — these must all match`,
        );
      }

      // Callers can never exceed calls: a cycle holds at least one call.
      if (callers.uniqueCallers > inPeriod.length) {
        reconciliationFailures += 1;
        problems.push(`${doc.id}: ${callers.uniqueCallers} unique callers from ${inPeriod.length} calls — impossible`);
      }
      // Nor can the per-number blocks hold calls that were not in the period.
      const blockSum = numbers.blocks.reduce((sum, block) => sum + block.total, 0);
      if (blockSum + numbers.callsWithoutNumber !== inPeriod.length) {
        reconciliationFailures += 1;
        problems.push(
          `${doc.id}: ${blockSum} calls in blocks + ${numbers.callsWithoutNumber} with no line ≠ ${inPeriod.length} calls`,
        );
      }

      const topLabels = tiles
        .slice(1)
        .filter((tile) => tile.value > 0)
        .sort((a, b) => b.value - a.value)
        .map((tile) => `${tile.label} ${tile.value}`)
        .join(" · ");

      console.log(`\n== ${doc.id}`);
      console.log(
        `   window ${period.start.slice(0, 10)} → ${period.end.slice(0, 10)}  ·  ${inPeriod.length} call(s) in period, ${before.length} in the one before`,
      );
      console.log(`   tiles:     Calls ${tileTotal}  ·  ${topLabels || "no labels at all"}`);
      console.log(`   donut:     good-call rate ${percent(mix.goodCallRate)} over ${mix.slices.length} slice(s)`);
      console.log(`   columns:   ${columns.buckets.length} ${columns.size} bucket(s), ${columnSum} call(s) placed`);
      console.log(
        `   callers:   ${callers.uniqueCallers} unique  ·  ${callers.repeatCallers} rang again  ·  ${callers.savedCallers} saved in the CRM  ·  ${callers.newCallers ?? "—"} new  ·  ${callers.unidentifiedCalls} call(s) with no caller`,
      );
      console.log(`   numbers:   ${numbers.blocks.length} line(s), ${numbers.callsWithoutNumber} call(s) with no line recorded`);
      if (numbers.warning) console.log(`              banner: ${numbers.warning.slice(0, 110)}…`);
      const rate = measures.find((row) => row.key === "good_rate");
      console.log(
        `   measures:  ${measures.length} row(s)  ·  good-call rate ${percent(rate?.value)} vs ${percent(rate?.previous)} before`,
      );
      console.log(
        `   shapes:    donut ${donut.length} arc(s) summing to ${Math.round(donutShare * 100)}%  ·  ${stacked.buckets.length} column(s), tallest ${Math.round(tallest)}% of the panel, ${labelled} labelled`,
      );
      console.log(
        `   table:     ${table.rows.length} row(s) of ${inPeriod.length}, state "${table.state}"  ·  ${byHand} set by hand, ${creditedToPerson} credited to a person  ·  ${withRecording} playable  ·  ${withTopic} with a topic`,
      );
      console.log(`   reconciles: ${agrees ? "yes" : "NO"}`);
    }
  }

  console.log(`\n==================== across every stored pull ====================`);
  console.log(`clients with calls:            ${clientsWithCalls}`);
  console.log(`calls the dashboard can place: ${placeableCalls}`);
  console.log(`leads typed "call" in storage:  ${typedAsCalls}`);
  console.log(`  set aside, no call recorded: ${droppedNoCallEvidence}  — no duration, status, direction or recording`);
  console.log(`  set aside, no timestamp:     ${droppedNoTimestamp}`);
  console.log(`every client reconciles:       ${reconciliationFailures === 0 ? "yes" : `NO — ${reconciliationFailures} client(s)`}`);
  console.log(`report sentences written:     ${reportSentences}, none of them over a figure that was not measured`);
  console.log(
    `labels a person decided:       ${handDecided}, of which ${handCredited} credited to the person and ${handOverruled} overruled by a recorded no-answer`,
  );
  if (totalCalls) {
    console.log(`\nwhat each section has to work with:`);
    console.log(
      `   per-number breakdown:  ${callsWithNumber}/${totalCalls} call(s) recorded a tracking line — only a fresh pull captures it`,
    );
    console.log(
      `   callers, saved:        ${callsWithContact}/${totalCalls} call(s) belong to a CRM contact`,
    );
    console.log(
      `   callers, by number:    ${callsWithPhone}/${totalCalls} call(s) carry a caller's number`,
    );
  }

  if (problems.length) {
    console.log(`\nproblems:`);
    for (const problem of problems.slice(0, 20)) console.log(`   ${problem}`);
    process.exit(1);
  }

  console.log(
    [
      "",
      "Not covered by this check: whether the window a stored pull claims matches what GoHighLevel",
      "would return for it today, whether the comparison window has a real pull behind it (an empty",
      "earlier window and a quiet earlier month look identical here), and whether the labels",
      `themselves are right — ${Object.values(CALL_LABEL_LABEL).length} words chosen by a rule, not by somebody listening.`,
    ].join("\n"),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
