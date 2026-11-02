import type { TenantContext } from "@/src/lib/contracts/mtos";
import { getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantUserPath } from "@/src/lib/server/firebase/collections";

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
    const name = data?.displayName?.trim() || data?.name?.trim() || toFirstName(email);
    return { name, email };
  } catch {
    return { name: "", email: "" };
  }
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
    return {
      email,
      name: data?.displayName?.trim() || data?.name?.trim() || toFirstName(email),
      timeZone: data?.timeZone?.trim() || DEFAULT_ACCOUNT_MANAGER_TIME_ZONE,
    };
  } catch {
    return fallback;
  }
}

/**
 * The handful of per-user preferences the Monthly Touch reads.
 *
 * Stored as one field on the user's own tenant document rather than in a new collection: these are
 * a few booleans and strings belonging to one user, and a collection would need its own rules, its
 * own backfill and its own failure mode. Every field is optional and every reader has a default,
 * so a user who has never opened Settings behaves exactly as before this existed.
 */
export interface AccountManagerPreferences {
  /** Which live format the Approve button prepares by default. */
  liveCallFormat?: "guide" | "deck";
  /** The AM's own sign-off, newline-separated, as it appears at the end of a client email. */
  emailSignoff?: string;
  /** Copy the other client-side attendees on the calendar event into the agenda email. */
  ccOfficeContact?: boolean;
}

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
    if (!raw || typeof raw !== "object") return {};
    const row = raw as Record<string, unknown>;
    const format = row.liveCallFormat;
    return {
      ...(format === "guide" || format === "deck" ? { liveCallFormat: format } : {}),
      ...(typeof row.emailSignoff === "string" ? { emailSignoff: row.emailSignoff } : {}),
      ...(typeof row.ccOfficeContact === "boolean" ? { ccOfficeContact: row.ccOfficeContact } : {}),
    };
  } catch {
    return {};
  }
}

/**
 * Write the preferences the user changed and nothing else.
 *
 * `mergeFields` rather than a whole-document merge, so saving a preference can never touch the
 * email, display name or role on the same document -- those belong to sign-in, not to Settings.
 */
export async function saveAccountManagerPreferences(
  context: TenantContext,
  patch: AccountManagerPreferences,
): Promise<AccountManagerPreferences> {
  const db = getFirebaseAdminDb();
  if (!db) throw new Error("Preferences cannot be saved: this deployment has no database connection.");

  const current = await getAccountManagerPreferences(context);
  const next: AccountManagerPreferences = {
    ...current,
    ...(patch.liveCallFormat ? { liveCallFormat: patch.liveCallFormat } : {}),
    ...(patch.emailSignoff !== undefined ? { emailSignoff: patch.emailSignoff } : {}),
    ...(patch.ccOfficeContact !== undefined ? { ccOfficeContact: patch.ccOfficeContact } : {}),
  };
  await db
    .doc(tenantUserPath(context.tenantId, context.userId))
    .set({ [PREFERENCES_FIELD]: next }, { mergeFields: [PREFERENCES_FIELD] });
  return next;
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
