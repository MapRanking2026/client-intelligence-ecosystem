import { AppShell } from "@/src/components/mtos/app-shell";
import { SectionCard } from "@/src/components/mtos/section-card";
import { KnowledgeManager } from "@/src/components/mtos/knowledge-manager";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { listKnowledge } from "@/src/lib/server/services/knowledge-service";

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
