import { Suspense } from "react";

import { ResetPasswordForm } from "@/src/components/reset-password-form";

export const dynamic = "force-dynamic";

export default function ResetPasswordPage() {
  return (
    <main className="wrap" style={{ maxWidth: 480 }}>
      <div style={{ marginBottom: 8 }}>
        <span className="brand-mark">SEOOS</span>{" "}
        <span className="brand-sub">SEO Operations</span>
      </div>
      <h1>Reset password</h1>
      <Suspense fallback={<div className="panel muted">Loading…</div>}>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
