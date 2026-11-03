/**
 * Trigger the notification run by hand, against real data.
 *
 * The run normally arrives by Vercel Cron every two hours, and the route is behind CRON_SECRET, so
 * there is no way to exercise it from a laptop without this. It exists mostly for the first run:
 * the one where you want to see what it is about to raise before it raises anything.
 *
 * DRY RUN by default, and the dry run is genuinely read-only -- it derives the same candidates from
 * the same records, prints them, and says which ones each AM's preferences would let through, but
 * writes no notification and sends no email. `--apply` performs the real pass, which is the same
 * work the cron does: one document per notification in the AM's own feed, and at most one digest
 * email per AM per day to the AM's own address. Nothing reaches a client either way.
 *
 * Idempotent, like the cron: a second --apply reports the same notifications as `existing` and
 * leaves them alone, read state included.
 *
 *   Dry run (writes nothing):  npx tsx scripts/run-notifications.ts
 *   Apply:                     npx tsx scripts/run-notifications.ts --apply
 *   One tenant only:           npx tsx scripts/run-notifications.ts --tenant map-ranking
 *   Print each AM's feed:      npx tsx scripts/run-notifications.ts --feed
 */
import { loadEnvConfig } from "@next/env";

import { resolvePreferences } from "@/src/lib/contracts/user-preferences";
import {
  digestDue,
  digestKey,
  isNotificationEnabled,
  notificationKey,
} from "@/src/lib/contracts/notifications";
import {
  listActiveTenantIds,
  listTenantUserContexts,
} from "@/src/lib/server/services/daily-sync-service";
import {
  deriveCandidates,
  listNotifications,
  runNotificationsForUser,
} from "@/src/lib/server/services/notification-service";
import {
  getAccountManagerPreferences,
  getAccountManagerProfile,
} from "@/src/lib/server/services/user-service";

/** The two kinds that are also emailed, which is what the dry run has to be explicit about. */
const DIGESTS = ["daily_digest", "weekly_digest"] as const;

async function main() {
  loadEnvConfig(process.cwd());

  const apply = process.argv.includes("--apply");
  const feedOnly = process.argv.includes("--feed");
  const tenantFlag = process.argv.indexOf("--tenant");
  const only = tenantFlag >= 0 ? process.argv[tenantFlag + 1] : undefined;
  const now = new Date();
  const baseUrl = process.env.MTOS_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;

  const tenantIds = only ? [only] : await listActiveTenantIds();
  console.log(`${feedOnly ? "FEED" : apply ? "APPLY" : "DRY RUN"} · ${now.toISOString()}`);
  console.log(`Tenants: ${tenantIds.join(", ") || "(none)"}`);
  console.log(`Digest links resolve against: ${baseUrl || "(not configured — the cron uses the request host)"}\n`);

  for (const tenantId of tenantIds) {
    const contexts = await listTenantUserContexts(tenantId);
    console.log(`── ${tenantId} · ${contexts.length} account manager(s)`);

    for (const context of contexts) {
      const [stored, profile] = await Promise.all([
        getAccountManagerPreferences(context),
        getAccountManagerProfile(context),
      ]);
      const preferences = resolvePreferences(stored);
      console.log(`\n  ${profile.name} <${profile.email || "no address on file"}> · ${context.userId}`);
      console.log(`  time zone ${preferences.timeZone} · prep reminder ${preferences.prepReviewReminder}`);

      if (feedOnly) {
        // The feed in the order the bell shows it: unread first, newest first.
        const feed = await listNotifications(context);
        const unread = feed.filter((row) => !row.readAt).length;
        console.log(`  ${feed.length} in the feed, ${unread} unread`);
        for (const row of feed) {
          console.log(`  ${row.readAt ? "read  " : "unread"} · ${row.id} · ${row.title}`);
          console.log(`      ${row.detail}`);
          console.log(`      ${row.href || "no link"}${row.emailedAt ? " · emailed" : ""}${row.emailSkippedReason ? ` · not emailed: ${row.emailSkippedReason}` : ""}`);
        }
        continue;
      }

      if (apply) {
        const report = await runNotificationsForUser(context, {
          now,
          ...(baseUrl ? { baseUrl } : {}),
        });
        console.log(`  raised ${report.created} · already there ${report.existing}`);
        if (report.skipped.length) console.log(`  switched off: ${report.skipped.join(", ")}`);
        if (report.unavailable.length) console.log(`  could not read: ${report.unavailable.join(", ")}`);
        for (const digest of report.digests) {
          console.log(`  ${digest.kind}: ${digest.emailed ? "emailed" : "NOT emailed"} — ${digest.detail}`);
        }
        continue;
      }

      const { candidates, unavailable } = await deriveCandidates(context, {
        now,
        timeZone: preferences.timeZone,
        prepReviewReminder: preferences.prepReviewReminder,
      });
      if (unavailable.length) console.log(`  could not read: ${unavailable.join(", ")}`);
      if (!candidates.length) console.log("  nothing to raise");

      for (const candidate of candidates) {
        const on = isNotificationEnabled(candidate.kind, stored);
        const id = notificationKey(candidate.kind, candidate.subjectId);
        console.log(`  ${on ? "would raise" : "switched off"} · ${id}`);
        console.log(`      ${candidate.title} — ${candidate.detail}`);
      }

      for (const kind of DIGESTS) {
        if (!isNotificationEnabled(kind, stored)) {
          console.log(`  ${kind}: off`);
          continue;
        }
        if (!digestDue(kind, now, preferences.timeZone)) {
          console.log(`  ${kind}: on, not due in this window`);
          continue;
        }
        console.log(
          `  ${kind}: DUE — would write ${digestKey(kind, now, preferences.timeZone)} and email ${candidates.length} line(s) to ${profile.email || "nobody (no address on file)"}`,
        );
      }
    }
    console.log("");
  }

  if (!apply && !feedOnly) console.log("Nothing was written. Re-run with --apply to perform the pass.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
