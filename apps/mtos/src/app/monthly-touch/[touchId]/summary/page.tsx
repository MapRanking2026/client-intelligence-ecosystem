import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { PostMeetingWorkflow } from "@/src/components/mtos/post-meeting-workflow";
import { SectionCard } from "@/src/components/mtos/section-card";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getMonthlyTouchWorkspaceView } from "@/src/lib/server/services/monthly-touch-service";

export default async function MonthlyTouchSummaryPage({
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

  return (
    <AppShell
      title={`${client.name} Follow-Through`}
      subtitle="The post-meeting workspace turns the transcript into a recap, department-routed tickets, a client email draft, and a QA review -- each gated behind a human approval before anything is created or sent."
    >
      <SectionCard
        eyebrow="Follow-through"
        title="Transcript to execution"
        subtitle="Every draft below is generated only from what's actually in the transcript. Nothing is created in ClickUp or sent to the client until you approve it here."
      >
        <PostMeetingWorkflow touchId={touch.id} postMeeting={touch.postMeeting} qaReview={touch.qaReview} />
      </SectionCard>

      <SectionCard eyebrow="Next step" title="Continue the workflow" subtitle="Move to the next piece of the client relationship once follow-through is filed.">
        <div className="grid gap-3 md:grid-cols-3">
          <Link
            href="/commitments"
            className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/4 px-4 py-4 text-sm text-slate-200 transition hover:bg-white/6"
          >
            Open commitment workspace
            <ArrowRight className="h-4 w-4 text-slate-400" />
          </Link>
          <Link
            href="/opportunities"
            className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/4 px-4 py-4 text-sm text-slate-200 transition hover:bg-white/6"
          >
            Review linked opportunities
            <ArrowRight className="h-4 w-4 text-slate-400" />
          </Link>
          <Link
            href={`/monthly-touch/${touch.id}`}
            className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/4 px-4 py-4 text-sm text-slate-200 transition hover:bg-white/6"
          >
            Return to meeting workspace
            <ArrowRight className="h-4 w-4 text-slate-400" />
          </Link>
        </div>
      </SectionCard>
    </AppShell>
  );
}
