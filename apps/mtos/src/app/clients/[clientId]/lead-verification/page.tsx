import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { LeadVerificationTable } from "@/src/components/mtos/lead-verification-table";
import { SectionCard } from "@/src/components/mtos/section-card";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { getClientWorkspaceView } from "@/src/lib/server/services/clients-service";
import { getStoredLeadVerification } from "@/src/lib/server/services/lead-verification-service";

export default async function ClientLeadVerificationPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const context = await resolveTenantContext();
  const workspace = await getClientWorkspaceView(context, clientId);

  if (!workspace) {
    notFound();
  }

  const { client } = workspace;
  const review = await getStoredLeadVerification(context, clientId);

  return (
    <AppShell
      title={`${client.name} — Lead & call verification`}
      subtitle="Every lead, call, and form submission this client received — vetted as real or flagged, attributed to a channel, and reconciled against Google Ads, organic/website, and Meta. All aggregated from GoHighLevel."
    >
      <Link
        href={`/clients/${client.id}`}
        className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to {client.name}
      </Link>

      <SectionCard
        eyebrow="Verification"
        title="Review leads lead-by-lead"
        subtitle="Adjust any verdict by hand — the AI proposes, you decide. Refresh pulls the latest from the connected sources; add or paste leads that live outside them."
      >
        <LeadVerificationTable clientId={client.id} initialReview={review} />
      </SectionCard>
    </AppShell>
  );
}
