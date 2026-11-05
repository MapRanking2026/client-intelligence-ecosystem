/**
 * Confirm the AM's QA & Coaching page loads against real data, and say plainly when there is none.
 *
 * The acceptance checklist asks that a real client still loads through every screen a phase adds.
 * These screens sit behind a session cookie (`src/proxy.ts` redirects without one) and entering
 * somebody's credentials is not on the table, so this calls the exact services the page calls, for
 * each real user in the tenant, and prints what they return. If the view resolves here, the page
 * renders it there -- the page does no arithmetic the contracts have not already done.
 *
 * Three things it checks that a screenshot would hide:
 *
 *  - **The Firestore query behind the page runs.** `where amId == …` uses the automatic
 *    single-field index, deliberately, and this is where a missing composite index would surface
 *    as FAILED_PRECONDITION rather than in front of an account manager.
 *  - **The coaching bridge resolves** (handoff §6.8): for one real client of each AM, whether
 *    their last submitted QC produces a focus list and proposals for the next call's Review.
 *  - **The dates are the right day.** It prints each touch's date label beside the raw value, so
 *    the calendar-day shift that `qc-dates.ts` exists to prevent would be visible here.
 *  - **The sidebar badge and the Command Center cards resolve** (handoff §6.9). These matter more
 *    than they look: the badge runs an aggregate `count()` and the AM's side filters on two fields
 *    at once. Both are believed to need no composite index, and this is where being wrong about
 *    that shows up as FAILED_PRECONDITION rather than on everybody's sidebar at once.
 *
 * Read-only. It writes nothing anywhere, and it raises no notification.
 *
 *   npx tsx scripts/verify-qc-am.ts
 *   npx tsx scripts/verify-qc-am.ts --tenant map-ranking
 */
import { loadEnvConfig } from "@next/env";

import {
  amHeadline,
  amKpis,
  amSubtitle,
  focusRows,
  historyRows,
  improvedRows,
  latestCard,
  pendingChipLabel,
  trendPoints,
  unreadScoreCount,
} from "@/src/lib/contracts/qc-am";
import { appealCandidates } from "@/src/lib/contracts/qc-appeal-draft";
import { qcDateLabel } from "@/src/lib/contracts/qc-dates";
import { canOpenQcQueue } from "@/src/lib/contracts/qc-access";
import {
  listActiveTenantIds,
  listTenantUserContexts,
} from "@/src/lib/server/services/daily-sync-service";
import { getQcAmView, getLatestQcCoaching } from "@/src/lib/server/services/qc-am-service";
import { getQcBadge } from "@/src/lib/server/services/qc-badge-service";
import { getQcCommandCards } from "@/src/lib/server/services/qc-cards-service";
import { qcCardsHeading } from "@/src/lib/contracts/qc-cards";
import { toastQueue } from "@/src/lib/contracts/notification-toasts";
import { listNotifications } from "@/src/lib/server/services/notification-service";
import { getAccountManagerProfile } from "@/src/lib/server/services/user-service";
import { getMtosDataSource } from "@/src/lib/server/data/seed-mtos-data-source";

function flagValue(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main() {
  loadEnvConfig(process.cwd());

  const only = flagValue("--tenant");
  const tenantIds = only ? [only] : await listActiveTenantIds();
  if (!tenantIds.length) {
    console.log("No active tenants. Nothing to verify.");
    return;
  }

  for (const tenantId of tenantIds) {
    console.log(`\n══ ${tenantId}`);
    const contexts = await listTenantUserContexts(tenantId);
    if (!contexts.length) {
      console.log("  no users in this tenant");
      continue;
    }

    for (const context of contexts) {
      const profile = await getAccountManagerProfile(context);
      const who = `${profile.name || context.userId} · ${context.role}`;

      let view: Awaited<ReturnType<typeof getQcAmView>>;
      try {
        view = await getQcAmView(context, undefined);
      } catch (error) {
        // The failure this script exists to catch. A missing index is not a quota problem and is
        // deliberately not swallowed.
        console.log(
          `  ${who} · PAGE FAILED TO LOAD: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }

      // The badge and the cards, which every page load runs. A failure here is a failure on
      // every screen in the app, so they are checked for every user rather than for one.
      let badge: Awaited<ReturnType<typeof getQcBadge>> | undefined;
      try {
        badge = await getQcBadge(context);
      } catch (error) {
        console.log(
          `  ${who} · BADGE FAILED: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      let cards: Awaited<ReturnType<typeof getQcCommandCards>> | undefined;
      try {
        cards = await getQcCommandCards(context);
      } catch (error) {
        console.log(
          `  ${who} · COMMAND CENTER CARDS FAILED: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const lands = canOpenQcQueue(context.role)
        ? "sees the QC queue at /qa, not this page"
        : "sees this page at /qa";
      console.log(`  ${who} · ${lands}`);
      // The bell's own feed, and which of it would pop up on the next page load. Read-only: it
      // does not stamp `toastedAt`, so running this does not consume anybody's toast.
      const feed = await listNotifications(context).catch(() => []);
      const due = toastQueue(feed);
      console.log(
        `    bell: ${feed.length} row(s) · ${feed.filter((item) => !item.readAt).length} unread · ${due.length} would pop up next load${due.length ? ` (${due.map((toast) => `${toast.eyebrow}: ${toast.cta}`).join(", ")})` : ""}`,
      );
      if (badge) {
        console.log(`    badge: ${badge.count} (${badge.kind}) — "${badge.label}"`);
      }
      if (cards) {
        console.log(
          `    command center: ${cards.cards.length} ${cards.forReviewer ? "work" : "news"} card(s) — ${qcCardsHeading(cards.cards, cards.forReviewer)}`,
        );
        for (const card of cards.cards) {
          console.log(
            `      card: ${card.label} · ${card.client} · ${card.detail}${card.wait ? ` · ${card.wait.text}${card.wait.late ? " (LATE)" : ""}` : ""} → ${card.href}`,
          );
        }
      }
      console.log(
        `    rows: ${view.done.length} scored · ${view.pending.length} with QC · ${unreadScoreCount(view.done)} unread · reviewer ${view.reviewerName || "none configured"}`,
      );

      if (!view.done.length && !view.pending.length) {
        console.log(
          "    nothing to show — correct until a touch of theirs is scored, which is what creates the first record",
        );
        continue;
      }

      console.log(`    headline: ${amHeadline(view.done)}`);
      console.log(`    subtitle: ${amSubtitle(view.done)}`);
      for (const row of view.pending) console.log(`    with QC: ${pendingChipLabel(row)}`);

      const card = latestCard(view.done, view.reviewerName);
      if (card) {
        console.log(
          `    latest: ${card.client} · ${card.dateLabel} · ${card.score ?? "—"} ${card.rating ?? ""} ${card.deltaLabel} · ${card.isNew ? "NEW" : "read"} · by ${card.scoredBy}`,
        );
      }

      for (const kpi of amKpis(view.done)) {
        const shown = kpi.text ?? (kpi.value === null ? "—" : kpi.value);
        console.log(`    kpi: ${kpi.label} = ${shown} (${kpi.sub})`);
      }

      for (const point of trendPoints(view.done, view.selected?.row.touchId)) {
        console.log(
          `    bar: ${point.dateLabel} · ${point.clientShort} · ${point.score} · ${point.onTarget ? "on target" : "below target"}`,
        );
      }

      for (const row of improvedRows(view.done)) {
        console.log(`    improved: ${row.name} ${row.from} → ${row.to}`);
      }
      const focus = focusRows(view.done, view.notesByTouch);
      for (const row of focus) {
        console.log(
          `    focus: ${row.name} ${row.average} avg · ${row.fromRubric ? "no note, using the rubric text" : "note from QC"}`,
        );
      }

      for (const row of historyRows(view.done, view.selected?.row.touchId, view.reviewerName)) {
        console.log(
          `    history: ${row.dateLabel} · ${row.client} · ${row.statusLabel} · ${row.score ?? "—"}${row.delta === null ? "" : ` (${row.delta >= 0 ? "+" : ""}${row.delta})`}`,
        );
      }

      if (view.selected) {
        const { selected } = view;
        const candidates = appealCandidates(selected.qc.crit, selected.qc.notes);
        console.log(
          `    open at /qa?touch=${selected.row.touchId} · raw date ${selected.row.date || "none"} → ${qcDateLabel(selected.row.date)}`,
        );
        console.log(
          `    detail: goal ${selected.qc.goal || "—"} · ${selected.qc.coaching?.length || 0} coaching items · ${candidates.length} criteria could be appealed · appeal ${selected.qc.appeal?.status || "none"} · chat ${selected.qc.chatRequestedAt ? "requested" : "not requested"}`,
        );

        // The §6.8 bridge, run against the same client the selected touch belongs to.
        const coaching = await getLatestQcCoaching(context, {
          clientId: selected.row.clientId,
          excludeTouchId: "none",
        }).catch((error) => {
          console.log(
            `    COACHING BRIDGE FAILED: ${error instanceof Error ? error.message : String(error)}`,
          );
          return undefined;
        });
        if (coaching) {
          console.log(
            `    next Review gets: ${coaching.focus.length} focus · ${coaching.proposals.length} proposals · from ${coaching.source.client} (${coaching.source.dateLabel})${coaching.source.sameClient ? ", same client" : ", another client"}`,
          );
        } else {
          console.log(
            "    next Review gets: nothing from QC — it keeps whatever source the preparation wrote",
          );
        }

        const client = await getMtosDataSource(context)
          .getClientById(selected.row.clientId)
          .catch(() => undefined);
        console.log(
          `    client record still loads: ${client ? `${client.name} (${client.industry || "no industry"})` : "NO — the client could not be read"}`,
        );
      }
    }
  }

  console.log("\nNot covered by this script:");
  console.log("  - how any of it looks on the screen, which needs a signed-in browser");
  console.log("  - appealing, marking as read or requesting a chat, which write real records");
  console.log("  - the notification each of those three raises");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
