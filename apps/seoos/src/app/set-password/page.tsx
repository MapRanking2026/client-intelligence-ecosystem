import { redirect } from "next/navigation";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { SetPasswordForm } from "@/src/components/set-password-form";

export const dynamic = "force-dynamic";

export default async function SetPasswordPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) redirect("/sign-in");
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <SetPasswordForm />
    </main>
  );
}
