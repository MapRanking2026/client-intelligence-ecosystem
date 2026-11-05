/**
 * Show, and on request change, who the QC reviewer is.
 *
 * `verify-qc-queue.ts` reports that nobody in the tenant can score a touch, which is true whenever
 * no user holds `qa_reviewer` and `qcReviewerUserIds` is unset. That is a data problem, not a code
 * one, so this is the script that fixes it -- deliberately, in one place, with the change printed
 * before it is made rather than typed into a console by hand.
 *
 * Two things have to be true for a person to work the queue, and this sets both:
 *
 *  - **`role: "qa_reviewer"`** on their tenant user document. `canScoreQc` is a role check, so this
 *    is what lets them submit a score and decide an appeal at all.
 *  - **membership of `qcReviewerUserIds`** in the tenant settings. This is who a finished
 *    follow-through notifies and assigns, and it is a list so that a second reviewer can be added
 *    later without touching anyone's role.
 *
 * It only ever adds to that list -- never removes, never replaces -- and it writes nothing at all
 * without `--apply`. A dry run is the default because a role is the one field on a user document
 * that changes what somebody can see.
 *
 *   npx tsx scripts/set-qc-reviewer.ts                                   # list every user
 *   npx tsx scripts/set-qc-reviewer.ts --email support@mapranking.com    # say what would change
 *   npx tsx scripts/set-qc-reviewer.ts --email support@... --apply       # make the change
 *   npx tsx scripts/set-qc-reviewer.ts --email support@... --name Sady --apply
 *
 * `--name` sets the display name, which is what the queue header and the "Appeal with {name}"
 * label read. A shared mailbox needs it: without one the screens say "Support".
 */
import { loadEnvConfig } from "@next/env";

import { canOpenQcQueue, canScoreQc } from "@/src/lib/contracts/qc-access";
import { getFirebaseAdminAuth, getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import {
  tenantSettingsPath,
  tenantUserPath,
  tenantUsersCollectionPath,
} from "@/src/lib/server/firebase/collections";
import { listActiveTenantIds } from "@/src/lib/server/services/daily-sync-service";
import {
  QC_REVIEWERS_SETTING_ID,
  getConfiguredQcReviewerIds,
} from "@/src/lib/server/services/qc-reviewers-service";

function flagValue(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

interface Row {
  userId: string;
  email: string;
  name: string;
  role: string;
}

async function listUsers(tenantId: string): Promise<Row[]> {
  const db = getFirebaseAdminDb();
  if (!db) throw new Error("No database connection: this environment has no Firebase admin credentials.");
  const snapshot = await db.collection(tenantUsersCollectionPath(tenantId)).get();
  return snapshot.docs.map((doc) => {
    const data = doc.data() as { email?: string; displayName?: string; name?: string; role?: string };
    return {
      userId: doc.id,
      email: (data.email || "").trim(),
      name: (data.displayName || data.name || "").trim(),
      role: String(data.role || "account_manager"),
    };
  });
}

async function main() {
  loadEnvConfig(process.cwd());

  const only = flagValue("--tenant");
  const email = (flagValue("--email") || "").trim().toLowerCase();
  const name = (flagValue("--name") || "").trim();
  const apply = process.argv.includes("--apply");
  const tenantIds = only ? [only] : await listActiveTenantIds();

  if (!tenantIds.length) {
    console.log("No active tenants. Nothing to do.");
    return;
  }

  let matched = 0;

  for (const tenantId of tenantIds) {
    const users = await listUsers(tenantId);
    const configured = await getConfiguredQcReviewerIds(tenantId);

    console.log(`\n══ ${tenantId}`);
    console.log(
      `  qcReviewerUserIds: ${configured.length ? configured.join(", ") : "unset — a handoff falls back to every qa_reviewer"}`,
    );
    for (const row of users) {
      console.log(
        `    ${row.userId} · ${row.email || "no email on the record"} · ${row.name || "no name"} · ${row.role} · queue ${canOpenQcQueue(row.role as never) ? "yes" : "no"} · may score ${canScoreQc(row.role as never) ? "yes" : "no"}`,
      );
    }

    if (!email) continue;

    const target = users.find((row) => row.email.toLowerCase() === email);
    if (!target) {
      // Signing in does not create this document: `api/auth/firebase-session` looks it up and
      // answers 403 "User is not assigned to this tenant" when it is missing. So an address with a
      // Firebase Auth account but no tenant user document cannot get in at all, and the fix is to
      // add the document -- which is what happens below. The Auth account itself is not touched.
      const auth = getFirebaseAdminAuth();
      if (!auth) {
        console.log(`  no user in this tenant has the email ${email}, and Firebase Auth is not configured here`);
        continue;
      }
      const account = await auth.getUserByEmail(email).catch(() => undefined);
      if (!account) {
        console.log(
          `  ${email} has no tenant user document and no Firebase Auth account. The account has to be created first (Firebase console → Authentication), then run this again.`,
        );
        continue;
      }
      matched += 1;
      console.log(`  ${email} has a Firebase Auth account (${account.uid}) but no user document in this tenant.`);
      console.log(`  planned change:`);
      console.log(`    create ${tenantUserPath(tenantId, account.uid)} with role qa_reviewer`);
      console.log(`    qcReviewerUserIds: ${configured.length ? `${configured.join(", ")} + ` : ""}${account.uid}`);
      if (!apply) {
        console.log("  dry run — nothing written. Re-run with --apply to make this change.");
        continue;
      }
      const dbForCreate = getFirebaseAdminDb();
      if (!dbForCreate) throw new Error("No database connection.");
      await dbForCreate.doc(tenantUserPath(tenantId, account.uid)).set(
        {
          email,
          role: "qa_reviewer",
          ...(name || account.displayName ? { displayName: name || account.displayName } : {}),
          createdAt: new Date().toISOString(),
        },
        { merge: true },
      );
      console.log(`    user document created with role qa_reviewer`);
      await dbForCreate.doc(tenantSettingsPath(tenantId, QC_REVIEWERS_SETTING_ID)).set(
        { userIds: [...configured, account.uid], updatedAt: new Date().toISOString() },
        { merge: true },
      );
      console.log(`    added to qcReviewerUserIds`);
      continue;
    }
    matched += 1;

    const alreadyReviewer = target.role === "qa_reviewer";
    const alreadyListed = configured.includes(target.userId);
    // The display name matters more here than on most records: it is what the queue header and the
    // "Appeal with {name}" label say, and without one the screens fall back to the email prefix --
    // so a shared address would have an AM reading "Appeal with Support".
    if (name && target.name !== name) {
      console.log(`  display name: ${target.name || "none"} → ${name}`);
      if (apply) {
        const dbForName = getFirebaseAdminDb();
        if (!dbForName) throw new Error("No database connection.");
        await dbForName.doc(tenantUserPath(tenantId, target.userId)).set({ displayName: name }, { merge: true });
        console.log(`    display name set`);
      }
    }
    if (alreadyReviewer && alreadyListed) {
      console.log(`  ${email} is already the QC reviewer, and already in the list. Nothing to change.`);
      continue;
    }

    console.log(`  planned change for ${email} (${target.userId}):`);
    if (!alreadyReviewer) console.log(`    role: ${target.role} → qa_reviewer`);
    if (!alreadyListed) {
      console.log(`    qcReviewerUserIds: ${configured.length ? `${configured.join(", ")} + ` : ""}${target.userId}`);
    }
    if (target.role === "tenant_admin" || target.role === "manager") {
      // Worth saying out loud: the role is single-valued, so this is a swap and not an addition.
      // They keep the QC queue (`canOpenQcQueue` covers a reviewer too) and lose whatever else
      // their old role opened.
      console.log(
        `    note: ${target.role} is replaced, not added to. They keep the QC queue but lose their ${target.role} rights elsewhere.`,
      );
    }

    if (!apply) {
      console.log("  dry run — nothing written. Re-run with --apply to make this change.");
      continue;
    }

    const db = getFirebaseAdminDb();
    if (!db) throw new Error("No database connection.");
    // Two documents, two writes, merged: the role on the user, the membership on the settings.
    // Not a transaction on purpose -- either write is useful on its own, and a half-applied change
    // is visible in the listing above rather than silently rolled back.
    if (!alreadyReviewer) {
      await db.doc(tenantUserPath(tenantId, target.userId)).set({ role: "qa_reviewer" }, { merge: true });
      console.log(`    role set to qa_reviewer`);
    }
    if (!alreadyListed) {
      await db.doc(tenantSettingsPath(tenantId, QC_REVIEWERS_SETTING_ID)).set(
        { userIds: [...configured, target.userId], updatedAt: new Date().toISOString() },
        { merge: true },
      );
      console.log(`    added to qcReviewerUserIds`);
    }
  }

  if (email && !matched) {
    console.log(
      `\n${email} has no user record in any tenant checked. A record is created the first time somebody signs in with that address, so sign in once and run this again.`,
    );
    process.exit(1);
  }

  console.log("\nNot covered by this script:");
  console.log("  - creating a user or an account; a record appears when that address first signs in");
  console.log("  - anything in Firebase Auth. This only writes the tenant user document and the setting");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
