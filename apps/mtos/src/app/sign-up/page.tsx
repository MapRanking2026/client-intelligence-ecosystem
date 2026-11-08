"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { Suspense, useEffect, useState, useTransition } from "react";

import { getFirebaseClientAuth } from "@/src/lib/firebase/client";
import { BrandWordmark } from "@/src/components/mtos/brand-wordmark";
import type { Role } from "@/src/lib/contracts/mtos";
import { SIGNUP_ROLES } from "@/src/lib/contracts/signup-roles";

function getSafeNextPath(nextPath: string | null) {
  if (!nextPath || !nextPath.startsWith("/") || nextPath.startsWith("//")) {
    return "/command-center";
  }

  return nextPath;
}

/**
 * The role options come from `signup-roles.ts`, which the sign-up route reads too.
 *
 * Before, the form listed two options and the route's schema listed the same two separately, so the
 * two descriptions of one privilege boundary could drift. The default is the first option --
 * Account Manager -- because that is what almost everybody signing up is, and a form that opens on
 * the most powerful role invites a careless click.
 */
const DEFAULT_ROLE: Role = SIGNUP_ROLES[0].role;

/** What the server says about each role right now: whether it can be signed up for at all. */
interface RoleAvailability {
  role: Role;
  requiresCode: boolean;
  available: boolean;
}

function SignUpContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedNextPath = searchParams.get("next");
  const nextPath = getSafeNextPath(requestedNextPath);

  const [isPending, startTransition] = useTransition();
  const [tenantId, setTenantId] = useState("");
  const [role, setRole] = useState<Role>(DEFAULT_ROLE);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<RoleAvailability[] | null>(null);

  /*
    What each role needs, asked before anything is created.

    Nothing is refused today: a role with no configured invite code needs none. This is read so
    the invite-code field can say whether it is required, and so the form would know in advance if
    a role were ever gated -- the browser creates the Firebase Auth account before the server sees
    the request, so a late refusal would strand an account whose email is then taken.
  */
  useEffect(() => {
    let active = true;
    fetch("/api/auth/firebase-signup/roles", { headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (active && payload?.data?.roles) setAvailability(payload.data.roles as RoleAvailability[]);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const current = availability?.find((entry) => entry.role === role);

  return (
    <main className="min-h-screen bg-[#223453] bg-[radial-gradient(circle_at_top,rgba(215,245,236,0.10),rgba(3,10,18,1)_55%)] px-6 py-16 text-white">
      <div className="mx-auto w-full max-w-lg">
        <BrandWordmark className="mb-10" />
        <div className="rounded-[28px] border border-[#597f91] bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-8 text-left shadow-[0_30px_80px_rgba(5,10,18,0.22)] backdrop-blur">
          <div className="space-y-2">
            <p className="text-left text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
              ACCESS
            </p>
            <h2 className="text-[35px] font-bold tracking-tight text-white">Create Account</h2>
            <p className="text-sm text-slate-400">
              Create an account for your organization. Pick the role you actually do — it decides
              which screens you get.
            </p>
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

                  if (!tenantId.trim()) {
                    throw new Error("Tenant ID is required.");
                  }


                  const credential = await createUserWithEmailAndPassword(
                    auth,
                    email.trim(),
                    password,
                  );

                  const idToken = await credential.user.getIdToken();
                  const response = await fetch("/api/auth/firebase-signup", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      idToken,
                      tenantId: tenantId.trim(),
                      role,
                      code: code.trim() || undefined,
                    }),
                  });

                  if (!response.ok) {
                    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
                    throw new Error(payload?.error || "Sign-up failed");
                  }

                  router.replace(nextPath);
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : "Sign-up failed");
                }
              });
            }}
          >
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                Tenant ID
              </label>
              <input
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none focus:border-white/20"
                placeholder="map-ranking"
                autoComplete="organization"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Role</label>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
                className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none focus:border-white/20"
              >
                {SIGNUP_ROLES.map((option) => (
                  <option key={option.role} value={option.role}>
                    {option.label}
                  </option>
                ))}
              </select>
              {/* What the chosen role actually gets, so nobody picks one by guessing at its name. */}
              <p className="text-xs leading-5 text-slate-400">
                {SIGNUP_ROLES.find((option) => option.role === role)?.hint}
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Email</label>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none focus:border-white/20"
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
                className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none focus:border-white/20"
                placeholder="Password"
                type="password"
                autoComplete="new-password"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                Invite code{current?.requiresCode ? "" : " (optional)"}
              </label>
              <input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none focus:border-white/20"
                placeholder="If enabled, required for your role"
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
              style={{ color: "#0d1625" }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#d7f5ec] px-4 py-3 text-sm font-semibold text-[#0d1625] transition hover:opacity-90 disabled:opacity-60"
            >
              {isPending ? "Creating account..." : "Create account"}
            </button>

            <Link
              href={requestedNextPath ? `/sign-in?next=${encodeURIComponent(requestedNextPath)}` : "/sign-in"}
              style={{ color: "#0d1625" }}
              className="inline-flex w-full items-center justify-center rounded-2xl border border-white/12 bg-white px-4 py-3 text-sm font-semibold text-[#0d1625] transition hover:bg-[#d7f5ec]"
            >
              Back to sign in
            </Link>
          </form>
        </div>
      </div>
    </main>
  );
}

export default function SignUpPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#223453] text-white">Loading…</div>}>
      <SignUpContent />
    </Suspense>
  );
}
