import { Suspense } from "react";
import { getServerEnv } from "@/src/lib/server/env";
import { SignInForm } from "@/src/components/sign-in-form";

export const dynamic = "force-dynamic";

/** SEOOS's own sign-in. Credentials are verified against the SEOOS user store. */
export default function SignInPage() {
  const env = getServerEnv();
  return (
    <main className="wrap" style={{ maxWidth: 480 }}>
      <div style={{ marginBottom: 8 }}>
        <span className="brand-mark">SEOOS</span>{" "}
        <span className="brand-sub">SEO Operations</span>
      </div>
      <h1>Sign in</h1>
      {env.useSeedData ? (
        <div className="panel">
          <span className="badge">Seed mode</span>
          <p className="muted">
            Seed/dev mode is active — the app is open with a seed identity, so a
            password is not required. Set MTOS_USE_SEED_DATA=false to require login.
          </p>
        </div>
      ) : (
        <Suspense fallback={<div className="panel muted">Loading…</div>}>
          <SignInForm />
        </Suspense>
      )}
    </main>
  );
}
