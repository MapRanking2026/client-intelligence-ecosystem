import Link from "next/link";

import { resolveSeoAuthz } from "@/src/lib/auth/context";
import { ModuleScaffold } from "@/src/components/module-scaffold";
import { UnauthorizedPage } from "@/src/components/states";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const authz = await resolveSeoAuthz();
  if (!authz) return <UnauthorizedPage />;
  return (
    <ModuleScaffold
      authz={authz}
      title="Reports & Packages"
      subtitle="Immutable package history, previews, exports, and proactive intelligence"
      breadcrumbs={[{ label: "SEOOS" }, { label: "Reports & Packages" }]}
      requiredPermission="seo.package.read"
      phase="Phase 8–9"
      purpose="Package versions with preview/QA/approval/delivery, corrections as new versions, CSV/branded exports where the stack supports it, and proactive alerts for significant changes. The request→package loop is live today in the Request Inbox."
    >
      <p className="muted">
        The working request→package flow is in the{" "}
        <Link href="/requests">Request Inbox</Link>. Full report history and
        exports build on top of it.
      </p>
    </ModuleScaffold>
  );
}
