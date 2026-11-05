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
    Which roles are open, asked before anything is created.

    The browser creates the Firebase Auth account first and only then asks the server for a tenant
    and a role, so a refusal at that point strands an account that can neither sign in nor sign up
    again -- the email is taken. Asking first is what keeps a closed role from costing somebody
    their address. Until the answer arrives the form stays usable; the submit below re-checks.
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

  const statusFor = (value: Role) => availability?.find((entry) => entry.role === value);
  const current = statusFor(role);
  const closed = Boolean(availability && current && !current.available);
  const allClosed = Boolean(availability?.length && availability.every((entry) => !entry.available));

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

                  // Re-checked here, before the account is created, for the reason in the effect
                  // above. The server refuses this role too; this is what stops the refusal
                  // arriving after an email address has already been spent.
                  if (closed) {
                    throw new Error(
                      "Sign-up for this role is closed: no invite code is configured for it. Ask an admin to set it on the deployment.",
                    );
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
                {SIGNUP_ROLES.map((option) => {
                  const status = statusFor(option.role);
                  const shut = Boolean(availability && status && !status.available);
                  return (
                    <option key={option.role} value={option.role}>
                      {option.label}
                      {shut ? " — closed" : ""}
                    </option>
                  );
                })}
              </select>
              {/* What the chosen role actually gets, so nobody picks one by guessing at its name. */}
              <p className="text-xs leading-5 text-slate-400">
                {SIGNUP_ROLES.find((option) => option.role === role)?.hint}
              </p>
              {closed ? (
                <p className="text-xs leading-5 text-amber-200">
                  This role is closed right now — no invite code is configured for it. An admin can
                  open it by setting the code on the deployment.
                </p>
              ) : null}
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

            {allClosed ? (
              <div className="rounded-2xl border border-amber-400/25 bg-amber-500/12 px-4 py-3 text-sm text-amber-100">
                Sign-up is closed for every role: this deployment has no invite codes configured.
                Set MTOS_MANAGER_SIGNUP_CODE and MTOS_ADMIN_SIGNUP_CODE to open it.
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isPending || closed}
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
