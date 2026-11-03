import { AppShell } from "@/src/components/mtos/app-shell";
import { SectionCard } from "@/src/components/mtos/section-card";
import { getPrompts } from "@/src/lib/server/prompt-store";

import { PromptEngineClient } from "./prompt-engine-client";

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

export default async function PromptEnginePage() {
  const prompts = await getPrompts();
  const promptCount = prompts.reduce((total, phase) => total + phase.prompts.length, 0);

  return (
    <AppShell
      title="Prompt Engine"
      subtitle="The single source of truth for every AI-powered workflow in MTOS. Each module resolves its instructions from this library at run time, so changing a prompt here changes platform behaviour everywhere it is used — no code deploy required."
    >
      <SectionCard
        eyebrow="Centralized intelligence layer"
        title="Prompt library"
        subtitle={`${promptCount} prompts across ${prompts.length} workflow stages. Every section is versioned and saved independently, so editing one prompt never disturbs another.`}
      >
        <PromptEngineClient initialPrompts={prompts} />
      </SectionCard>
    </AppShell>
  );
}
