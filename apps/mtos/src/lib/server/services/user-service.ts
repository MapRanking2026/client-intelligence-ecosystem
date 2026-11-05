import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantUserPath } from "@/src/lib/server/firebase/collections";
import {
  normalizePreferences,
  type UserPreferences,
} from "@/src/lib/contracts/user-preferences";

function isQuotaExceededError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("RESOURCE_EXHAUSTED") ||
    error.message.includes("Quota exceeded")
  );
}

function toFirstName(email?: string | null) {
  const value = (email || "").trim();
  if (!value) {
    return "";
  }

  const prefix = value.split("@")[0] || "";
  if (!prefix) {
    return "";
  }

  const sanitized = prefix.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  if (!sanitized) {
    return "";
  }

  return sanitized
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function roleLabel(role: TenantContext["role"]) {
  if (role === "account_manager") return "Account Manager";
  if (role === "manager") return "Manager";
  if (role === "tenant_admin") return "Admin";
  if (role === "qa_reviewer") return "QA Reviewer";
  return "User";
}

/**
 * The display name + email of the logged-in user, for attributing work they
 * author (e.g. writing follow-up tickets in the first person). Falls back to a
 * name derived from the email, then to an empty string. Never throws.
 */
export async function getAccountManagerIdentity(
  context: TenantContext,
): Promise<{ name: string; email: string }> {
  const db = getFirebaseAdminDb();
  if (!db) {
    return { name: "", email: "" };
  }
  try {
    const snapshot = await db.doc(tenantUserPath(context.tenantId, context.userId)).get();
    const data = snapshot.exists
      ? (snapshot.data() as { email?: string; displayName?: string; name?: string } | undefined)
      : undefined;
    const email = data?.email?.trim() || "";
    const preferences = normalizePreferences((data as Record<string, unknown> | undefined)?.[PREFERENCES_FIELD]);
    const name =
      preferences.displayName?.trim() || data?.displayName?.trim() || data?.name?.trim() || toFirstName(email);
    return { name, email };
  } catch {
    return { name: "", email: "" };
  }
}

/**
 * Display names for other people in the tenant, keyed by user id.
 *
 * The QC queue needs them: an index row carries `amId`, and "{AM} · Monthly Touch · {date}" needs
 * the name behind it. Ids are deduplicated before any read, so a queue of twenty touches across
 * four AMs costs four reads rather than twenty -- the whole reason the QC index exists is to keep
 * a list page's read count proportional to the people in it, not the rows.
 *
 * Never throws, and never partially fails loudly: a name that cannot be read is simply absent from
 * the map, and the caller shows the row without it. A queue that 500s because one user document is
 * missing would hide every touch waiting to be scored.
 */
export async function getUserDisplayNames(
  tenantId: string,
  userIds: readonly string[],
): Promise<Record<string, string>> {
  const db = getFirebaseAdminDb();
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!db || !unique.length) {
    return {};
  }

  const entries = await Promise.all(
    unique.map(async (userId) => {
      try {
        const snapshot = await db.doc(tenantUserPath(tenantId, userId)).get();
        if (!snapshot.exists) return [userId, ""] as const;
        const data = snapshot.data() as
          | { email?: string; displayName?: string; name?: string }
          | undefined;
        const preferences = normalizePreferences(
          (data as Record<string, unknown> | undefined)?.[PREFERENCES_FIELD],
        );
        const name =
          preferences.displayName?.trim() ||
          data?.displayName?.trim() ||
          data?.name?.trim() ||
          toFirstName(data?.email);
        return [userId, name] as const;
      } catch {
        return [userId, ""] as const;
      }
    }),
  );

  const out: Record<string, string> = {};
  for (const [userId, name] of entries) {
    if (name) out[userId] = name;
  }
  return out;
}

/**
 * The AM's own time zone, used for every deadline and wall-clock label shown to them.
 *
 * Pacific is the fallback rather than the server's zone: the team works Pacific hours, and a
 * deadline rendered in UTC because a profile field was blank is a deadline read eight hours wrong.
 */
export const DEFAULT_ACCOUNT_MANAGER_TIME_ZONE = "America/Los_Angeles";

export interface AccountManagerProfile {
  name: string;
  email: string;
  timeZone: string;
}

/**
 * Name, email and time zone of the logged-in account manager. Never throws: a missing profile
 * document means the defaults, not a failed screen.
 */
export async function getAccountManagerProfile(
  context: TenantContext,
): Promise<AccountManagerProfile> {
  const db = getFirebaseAdminDb();
  const fallback = { name: "", email: "", timeZone: DEFAULT_ACCOUNT_MANAGER_TIME_ZONE };
  if (!db) return fallback;
  try {
    const snapshot = await db.doc(tenantUserPath(context.tenantId, context.userId)).get();
    const data = snapshot.exists
      ? (snapshot.data() as
          | { email?: string; displayName?: string; name?: string; timeZone?: string }
          | undefined)
      : undefined;
    const email = data?.email?.trim() || "";
    // Settings wins over the document's own fields: `mtosPreferences` is what the AM typed, while
    // `displayName` and `timeZone` at the top level are whatever sign-in or an import left there.
    const preferences = normalizePreferences((data as Record<string, unknown> | undefined)?.[PREFERENCES_FIELD]);
    return {
      email,
      name:
        preferences.displayName?.trim() ||
        data?.displayName?.trim() ||
        data?.name?.trim() ||
        toFirstName(email),
      timeZone: preferences.timeZone || data?.timeZone?.trim() || DEFAULT_ACCOUNT_MANAGER_TIME_ZONE,
    };
  } catch {
    return fallback;
  }
}

/**
 * The per-user preferences every screen reads.
 *
 * Stored as one field on the user's own tenant document rather than in a new collection: these
 * belong to exactly one user, and a collection would need its own rules, its own backfill and its
 * own failure mode. The shape, the defaults and what is allowed in each field all live in
 * `@/src/lib/contracts/user-preferences`, so the screen and this service cannot disagree.
 *
 * `AccountManagerPreferences` is kept as the name the Monthly Touch services already import. It is
 * the same type -- widened, not replaced, so nothing that read `liveCallFormat` or `emailSignoff`
 * before this had to change.
 */
export type AccountManagerPreferences = UserPreferences;

const PREFERENCES_FIELD = "mtosPreferences";

/** Never throws: a missing document or a Firestore wobble means the defaults, not a failed screen. */
export async function getAccountManagerPreferences(
  context: TenantContext,
): Promise<AccountManagerPreferences> {
  const db = getFirebaseAdminDb();
  if (!db) return {};
  try {
    const snapshot = await db.doc(tenantUserPath(context.tenantId, context.userId)).get();
    const raw = snapshot.exists
      ? (snapshot.data() as Record<string, unknown> | undefined)?.[PREFERENCES_FIELD]
      : undefined;
    return normalizePreferences(raw);
  } catch {
    return {};
  }
}

/**
 * Write the preferences the user changed and nothing else.
 *
 * `mergeFields` rather than a whole-document merge, so saving a preference can never touch the
 * email, display name or role on the same document -- those belong to sign-in, not to Settings.
 *
 * The patch is normalized before it is merged, so a field MTOS does not recognise, or a value it
 * cannot use, is dropped here rather than stored and read back later as if it were a choice the
 * AM made. An empty string IS a choice -- it clears the field -- so it survives normalization.
 */
export async function saveAccountManagerPreferences(
  context: TenantContext,
  patch: AccountManagerPreferences,
): Promise<AccountManagerPreferences> {
  const db = getFirebaseAdminDb();
  if (!db) throw new Error("Preferences cannot be saved: this deployment has no database connection.");

  const current = await getAccountManagerPreferences(context);
  const clean = normalizePreferences(patch);
  const next: AccountManagerPreferences = {
    ...current,
    ...clean,
    // Notifications are merged flag by flag: the screen may post one switch, and the four it did
    // not mention are still the AM's own choices.
    ...(clean.notifications
      ? { notifications: { ...(current.notifications || {}), ...clean.notifications } }
      : {}),
  };
  await db
    .doc(tenantUserPath(context.tenantId, context.userId))
    .set({ [PREFERENCES_FIELD]: next }, { mergeFields: [PREFERENCES_FIELD] });
  return next;
}

/**
 * Put every preference back to its default.
 *
 * The field is written as an empty object rather than deleted: `mergeFields` on a deleted field
 * needs a sentinel value, and an empty object reads back through `normalizePreferences` as "no
 * stored preferences", which is exactly the state a new AM is in. Nothing else on the document
 * is touched, so this can never clear a sign-in.
 */
export async function resetAccountManagerPreferences(
  context: TenantContext,
): Promise<AccountManagerPreferences> {
  const db = getFirebaseAdminDb();
  if (!db) throw new Error("Preferences cannot be reset: this deployment has no database connection.");
  await db
    .doc(tenantUserPath(context.tenantId, context.userId))
    .set({ [PREFERENCES_FIELD]: {} }, { mergeFields: [PREFERENCES_FIELD] });
  return {};
}

/**
 * The address client email is sent as.
 *
 * Their "client emails send through" preference when they have set one, otherwise the address they
 * sign in with. Intercom matches the sender by email address (see `findAdminByEmail`), so this is
 * the single answer to "whose seat does this go out from" -- and sending as somebody else is the
 * one failure the send path refuses rather than guesses at.
 */
export async function clientEmailSenderAddress(context: TenantContext): Promise<string> {
  const [profile, preferences] = await Promise.all([
    getAccountManagerProfile(context),
    getAccountManagerPreferences(context),
  ]);
  return preferences.clientEmailsSendThrough?.trim() || profile.email;
}

export async function getUserGreeting(context: TenantContext) {
  const db = getFirebaseAdminDb();
  const roleText = roleLabel(context.role);
  if (!db) {
    return {
      label: `Welcome (${roleText})`,
    };
  }

  try {
    const snapshot = await db.doc(tenantUserPath(context.tenantId, context.userId)).get();
    const data = snapshot.exists ? (snapshot.data() as { email?: string } | undefined) : undefined;
    const firstName = toFirstName(data?.email);

    if (!firstName) {
      return {
        label: `Welcome (${roleText})`,
      };
    }

    return {
      label: `Welcome, ${firstName} (${roleText})`,
    };
  } catch (error) {
    if (isQuotaExceededError(error)) {
      console.warn(
        `Firestore quota exceeded while loading user greeting for ${context.tenantId}/${context.userId}. Falling back to a generic greeting.`,
      );
      return {
        label: `Welcome (${roleText})`,
      };
    }

    throw error;
  }
}
