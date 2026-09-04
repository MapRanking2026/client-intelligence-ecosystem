import { getServerEnv } from "@/src/lib/server/env";

export const dynamic = "force-dynamic";

/**
 * SEOOS sign-in. Sessions are issued by the shared MTOS auth flow (the same
 * signed cookie verifies in both apps); a dedicated SEOOS credential login is a
 * later step. In seed/dev mode the app is open with a seed identity.
 */
export default function SignInPage() {
  const env = getServerEnv();
  return (
    <main className="wrap">
      <div className="panel">
        <span className="brand-mark">SEOOS</span>
        <h1>Sign in</h1>
        {env.useSeedData ? (
          <p className="muted">
            Seed mode is active — the app is open with a seed identity. Set
            MTOS_USE_SEED_DATA=false to require a real session.
          </p>
        ) : (
          <p className="muted">
            SEOOS uses the shared Client Intelligence Ecosystem session. Sign in
            through MTOS; the same session grants SEOOS access when your account
            has a SEOOS membership. A dedicated SEOOS login is a later step.
          </p>
        )}
      </div>
    </main>
  );
}
