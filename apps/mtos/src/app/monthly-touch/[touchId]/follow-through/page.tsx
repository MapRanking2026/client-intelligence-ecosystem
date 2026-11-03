import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { FollowThroughGate } from "@/src/components/mtos/follow-through-gate";
import { SectionCard } from "@/src/components/mtos/section-card";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { scoreConfirmed } from "@/src/lib/contracts/follow-through-score";
import { getMonthlyTouchWorkspaceView } from "@/src/lib/server/services/monthly-touch-service";

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

export default async function FollowThroughPage({
  params,
}: {
  params: Promise<{ touchId: string }>;
}) {
  const { touchId } = await params;
  const payload = await getMonthlyTouchWorkspaceView(await resolveTenantContext(), touchId);

  if (!payload) {
    notFound();
  }

  const { touch, client } = payload;
  const gate = touch.followThrough?.score;
  const confirmed = scoreConfirmed(gate);

  return (
    <AppShell
      title={`${client.name} — follow-through`}
      subtitle="Everything the call commits us to, drafted for you to approve. Nothing is created in ClickUp, written to a tracker or sent to the client until you finish this screen."
    >
      <SectionCard
        eyebrow="Step 1 of the follow-through"
        title="Score the account"
        subtitle="The score decides what the rest of this page contains, so it comes first. A 6 or below adds the Risk Register row, the playbook and the Manager tag; the Health Tracker row reads it either way."
      >
        <FollowThroughGate touchId={touch.id} clientName={client.name} {...(gate ? { gate } : {})} />
      </SectionCard>

      {confirmed ? (
        <SectionCard
          eyebrow="Next"
          title="The notes, the tickets and the recap"
          subtitle="Drafted from this call and this score."
        >
          <p className="muted text-[0.86rem] leading-7">
            The drafting steps are being built. The score above is saved, so this screen will open
            on them as soon as they land.
          </p>
        </SectionCard>
      ) : null}

      <div className="mt-4">
        <Link href={`/monthly-touch/${touch.id}/v2`} className="btn btn-ghost btn-sm">
          <ArrowLeft />
          Back to the call
        </Link>
      </div>
    </AppShell>
  );
}
