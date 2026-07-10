"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, useTransition } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import Link from "next/link";

import { getFirebaseClientAuth } from "@/src/lib/firebase/client";

function getSafeNextPath(nextPath: string | null) {
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/command-center";
  }

  return nextPath;
}

function getDestinationLabel(nextPath: string | null) {
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return null;
  }

  const pathname = nextPath.split("?")[0];

  if (pathname === "/command-center") return "Command Center";
  if (pathname === "/settings") return "Settings";
  if (pathname === "/clients") return "Clients";
  if (pathname === "/commitments") return "Commitments";
  if (pathname === "/opportunities") return "Opportunities";
  if (pathname === "/monthly-touch") return "Monthly Touch Workspace";
  if (pathname.startsWith("/clients/")) return "Client Workspace";
  if (pathname.endsWith("/summary")) return "Post-Meeting Summary";
  if (pathname.startsWith("/monthly-touch/")) return "Monthly Touch";

  const primarySegment = pathname.split("/").filter(Boolean)[0];
  if (!primarySegment) {
    return null;
  }

  return primarySegment
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function SignInContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const requestedNextPath = searchParams.get("next");
  const nextPath = getSafeNextPath(requestedNextPath);
  const destinationLabel = getDestinationLabel(requestedNextPath);

  return (
    <main className="min-h-screen bg-[#223453] bg-[radial-gradient(circle_at_top,rgba(215,245,236,0.10),rgba(3,10,18,1)_55%)] px-6 py-16 text-white">
      <div className="mx-auto w-full max-w-lg">
        <div className="rounded-[28px] border border-[#597f91] bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-8 text-left shadow-[0_30px_80px_rgba(5,10,18,0.22)] backdrop-blur">
          <div className="space-y-2">
            <p className="text-left text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">ACCESS</p>
            <h1 className="text-2xl font-semibold tracking-tight text-white">Monthly Touch OS</h1>
            <h2 className="text-[35px] font-bold tracking-tight text-white">Welcome Back!</h2>
            <p className="text-sm text-slate-400">Sign in with your organization credentials.</p>
            {destinationLabel ? (
              <div className="rounded-2xl border border-white/10 bg-white/6 px-4 py-3 text-sm text-slate-200">
                Please sign in to continue to {destinationLabel}.
              </div>
            ) : null}
          </div>

          <form
            className="mt-8 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);

              startTransition(async () => {
                try {
                  const auth = getFirebaseClientAuth();
                  if (!auth) {
                    throw new Error("Firebase client is not configured. Check NEXT_PUBLIC_FIREBASE_* env vars.");
                  }

                  const credential = await signInWithEmailAndPassword(auth, email, password);
                  const idToken = await credential.user.getIdToken();
                  const response = await fetch("/api/auth/firebase-session", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ idToken }),
                  });

                  if (!response.ok) {
                    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
                    throw new Error(payload?.error || "Sign-in failed");
                  }

                  router.replace(nextPath);
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : "Sign-in failed");
                }
              });
            }}
          >
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Email</label>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-2xl border border-[#36465b] bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-white/20"
                placeholder="you@company.com"
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                Password
              </label>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-2xl border border-[#36465b] bg-black/50 px-4 py-3 text-sm text-white outline-none focus:border-white/20"
                placeholder="Password"
                type="password"
                autoComplete="current-password"
              />
            </div>

            {error ? (
              <div className="rounded-2xl border border-rose-400/25 bg-rose-500/12 px-4 py-3 text-sm text-rose-100">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isPending}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-[#0d1625] transition hover:opacity-90 disabled:opacity-60"
            >
              {isPending ? "Signing in..." : "Sign in"}
            </button>

            <Link
              href={requestedNextPath ? `/sign-up?next=${encodeURIComponent(requestedNextPath)}` : "/sign-up"}
              className="inline-flex w-full items-center justify-center rounded-2xl border border-white/12 bg-white px-4 py-3 text-sm font-semibold text-[#0d1625] shadow-[0_4px_8px_0_rgba(0,0,0,0.25)] transition hover:bg-[#d7f5ec]"
            >
              Sign up
            </Link>
          </form>
        </div>
      </div>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#223453] text-white">Loading…</div>}>
      <SignInContent />
    </Suspense>
  );
}
