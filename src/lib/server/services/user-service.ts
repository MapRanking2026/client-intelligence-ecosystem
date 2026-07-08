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
