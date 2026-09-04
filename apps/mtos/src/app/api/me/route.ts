import { NextResponse } from "next/server";

import type { Role } from "@/src/lib/contracts/mtos";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getFirebaseAdminAuth, getFirebaseAdminDb } from "@/src/lib/server/firebase/admin";
import { tenantUserPath } from "@/src/lib/server/firebase/collections";

const roleLabels: Record<Role, string> = {
  account_manager: "Account Manager",
  manager: "Manager",
  qa_reviewer: "QA Reviewer",
  tenant_admin: "Admin",
};

/** Turn an email local-part into a readable name ("john.doe" -> "John Doe"). */
function nameFromEmail(email: string) {
  const localPart = email.split("@")[0] || "";
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1))
    .join(" ");
}

export async function GET(request: Request) {
  const context = await resolveTenantContext(request);
  const roleLabel = roleLabels[context.role] || "Account Manager";

  let name = "";
  let email = "";

  if (context.userId && context.userId !== "unknown") {
    // Prefer the Firebase Auth display name; fall back to the tenant user doc's stored name/email.
    try {
      const auth = getFirebaseAdminAuth();
      if (auth) {
        const record = await auth.getUser(context.userId);
        name = record.displayName || "";
        email = record.email || "";
      }
    } catch {
      // Ignore -- fall through to the Firestore user doc / email fallback.
    }

    if (!name || !email) {
      try {
        const db = getFirebaseAdminDb();
        if (db) {
          const snapshot = await db.doc(tenantUserPath(context.tenantId, context.userId)).get();
          const data = snapshot.data() as { name?: string; displayName?: string; email?: string } | undefined;
          name = name || data?.name || data?.displayName || "";
          email = email || data?.email || "";
        }
      } catch {
        // Ignore -- the generic fallback below still gives a sensible label.
      }
    }
  }

  const displayName = name || (email ? nameFromEmail(email) : "") || roleLabel;

  return NextResponse.json({
    data: {
      userId: context.userId,
      role: context.role,
      roleLabel,
      name: displayName,
      email,
    },
  });
}
