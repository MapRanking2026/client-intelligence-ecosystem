import { AppShell } from "@/src/components/mtos/app-shell";
import { SectionCard } from "@/src/components/mtos/section-card";
import { KnowledgeManager } from "@/src/components/mtos/knowledge-manager";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { listKnowledge } from "@/src/lib/server/services/knowledge-service";

/**
 * Rendered per request, never prerendered.
 *
 * This page reads one tenant's data behind a session cookie, so a build-time copy of it would
 * be the wrong tenant's page for everyone -- and the build would have to reach Firestore to
 * make it, which is what failed the deploys of 2026-11-02 when the daily read quota ran out.
 * Next cannot infer this on its own here: the session read calls `cookies()` inside a
 * try/catch and skips it entirely when the cookie secret is absent, so on a build without
 * that secret nothing marks the route dynamic and it is prerendered.
 */
export const dynamic = "force-dynamic";

export default async function KnowledgeSettingsPage() {
  const context = await resolveTenantContext();
  const documents = await listKnowledge(context);

  return (
    <AppShell
      title="Knowledge base"
      subtitle="The Map Ranking knowledge layer. Add your playbooks, SOPs, and past monthly touches here; MTOS embeds them and retrieves the most relevant pieces into monthly-touch prep so the AI grounds its strategy in how your team actually works — no model training required."
    >
      <SectionCard
        eyebrow="Retrieval-augmented grounding"
        title="Manage knowledge"
        subtitle="Paste a document to add it, backfill from your past monthly touches in one click, and test what the AI would retrieve for a given question. Requires an embedding provider (OpenAI or Gemini)."
      >
        <KnowledgeManager initialDocuments={documents} />
      </SectionCard>
    </AppShell>
  );
}
