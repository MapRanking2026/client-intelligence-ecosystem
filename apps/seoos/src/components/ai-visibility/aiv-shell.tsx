import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import type { AuthzContextV1 } from "@cie/contracts";

import { AppShell } from "@/src/components/app-shell";
import { UnauthorizedPage } from "@/src/components/states";
import { resolveSeoAuthz } from "@/src/lib/auth/context";
import type { SeoProjectV1 } from "@/src/lib/domain/project";
import { listProjectsForViewer } from "@/src/lib/server/projects-service";

export const AIV_TABS = [
  { key: "overview", label: "Overview", path: "" },
  { key: "setup", label: "Setup", path: "/setup" },
  { key: "prompts", label: "Prompts", path: "/prompts" },
  { key: "scans", label: "Scans", path: "/scans" },
  { key: "results", label: "Results", path: "/results" },
  { key: "competitors", label: "Competitors", path: "/competitors" },
  { key: "citations", label: "Citations", path: "/citations" },
  { key: "recommendations", label: "Recommendations", path: "/recommendations" },
  { key: "manual", label: "Manual", path: "/manual" },
  { key: "report", label: "Report", path: "/report" },
] as const;
export type AivTab = (typeof AIV_TABS)[number]["key"];

/**
 * Server-side page guard: authz + project visibility (listProjectsForViewer).
 * Returns null result handled by the caller via `UnauthorizedPage` / notFound().
 */
export async function pageContext(projectId: string): Promise<{ authz: AuthzContextV1; project: SeoProjectV1 } | { denied: true }> {
  const authz = await resolveSeoAuthz();
  if (!authz) return { denied: true };
  if (!authz.permissions.includes("seo.package.read")) return { denied: true };
  const project = (await listProjectsForViewer(authz)).find((p) => p.id === projectId);
  if (!project) notFound();
  return { authz, project };
}

export function Denied() {
  return <UnauthorizedPage />;
}

export function Disclaimer() {
  return (
    <p className="aiv-disclaimer" role="note">
      <strong>Samples, not guarantees.</strong> Each observation is one answer from an official provider API at a point in time.
      Answers change with time, model, search behavior, location support and personalization. API results are not identical to
      consumer apps (ChatGPT, Claude.ai, Gemini app, Google AI Overviews / AI Mode) and do not cover all AI answers.
    </p>
  );
}

export async function AivShell({
  authz,
  project,
  tab,
  subtitle,
  actions,
  children,
}: {
  authz: AuthzContextV1;
  project: SeoProjectV1;
  tab: AivTab;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const base = `/ai-visibility/${project.id}`;
  return (
    <AppShell
      authz={authz}
      title={`${project.businessName} — AI Visibility`}
      subtitle={subtitle}
      breadcrumbs={[{ label: "SEOOS" }, { label: "AI Visibility", href: "/ai-visibility" }, { label: project.businessName }]}
      actions={actions}
    >
      <nav className="aiv-tabs" aria-label="AI visibility sections">
        {AIV_TABS.map((t) => (
          <Link key={t.key} href={`${base}${t.path}`} aria-current={t.key === tab ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </AppShell>
  );
}
