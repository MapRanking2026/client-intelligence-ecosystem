"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { signOut } from "firebase/auth";

import { getFirebaseClientAuth } from "@/src/lib/firebase/client";

/** Signs the user out of Firebase, clears the MTOS session cookie, and returns to sign-in. */
export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      const auth = getFirebaseClientAuth();
      if (auth) await signOut(auth);
    } catch {
      // ignore — still clear the server session below
    }
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore — still redirect
    }
    router.push("/sign-in");
    router.refresh();
  }

  return (
    <button type="button" className="logout-btn" onClick={logout} disabled={busy} aria-label="Log out">
      <LogOut />
      <span>{busy ? "Signing out…" : "Log out"}</span>
    </button>
  );
}
