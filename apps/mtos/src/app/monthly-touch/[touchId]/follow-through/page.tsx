import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { FollowThroughGate } from "@/src/components/mtos/follow-through-gate";
import { FollowThroughFinish } from "@/src/components/mtos/follow-through-finish";
import { FollowThroughItems } from "@/src/components/mtos/follow-through-items";
import { FollowThroughNotes } from "@/src/components/mtos/follow-through-notes";
import { FollowThroughRecap } from "@/src/components/mtos/follow-through-recap";
import { FollowThroughTrackers } from "@/src/components/mtos/follow-through-trackers";
import { SectionCard } from "@/src/components/mtos/section-card";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { scoreConfirmed } from "@/src/lib/contracts/follow-through-score";
import {
  listTicketTags,
  readDepartmentOwners,
} from "@/src/lib/server/services/follow-through-items-service";
import { getMonthlyTouchWorkspaceView } from "@/src/lib/server/services/monthly-touch-service";
import { listAssignableMembers } from "@/src/lib/server/services/post-meeting-service";

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
  const context = await resolveTenantContext();
  const payload = await getMonthlyTouchWorkspaceView(context, touchId);

  if (!payload) {
    notFound();
  }

  const { touch, client } = payload;
  const gate = touch.followThrough?.score;
  const confirmed = scoreConfirmed(gate);
  const hasNotes = Boolean(touch.followThrough?.notes);

  // Read once on the server and handed down, so the ticket forms open on real departments, real
  // people and the tags that actually exist rather than on a dropdown of guesses. Each of these
  // reports its own reason when it comes back empty; none of them throws.
  const [tags, owners, roster] = hasNotes
    ? await Promise.all([listTicketTags(context), readDepartmentOwners(context), listAssignableMembers(context)])
    : [{ tags: [] }, {}, { members: [] }];

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
          eyebrow="Step 2 of the follow-through"
          title="Post Monthly Touch Notes"
          subtitle="The numbering here is the numbering in the Client's Book, so what you read on this screen is what the next AM reads on the account."
        >
          <FollowThroughNotes
            touchId={touch.id}
            {...(touch.followThrough?.notes ? { notes: touch.followThrough.notes } : {})}
          />
        </SectionCard>
      ) : null}

      {confirmed && hasNotes ? (
        <SectionCard
          eyebrow="Step 3 of the follow-through"
          title="Tickets"
          subtitle="Every action from the notes on the real ClickUp form. What you approve here is what gets created, so the form is the whole form."
        >
          <FollowThroughItems
            touchId={touch.id}
            {...(touch.followThrough?.items ? { items: touch.followThrough.items } : {})}
            tags={tags.tags}
            {...(tags.reason ? { tagsReason: tags.reason } : {})}
            members={roster.members.map((member) => member.name)}
            owners={owners}
          />
        </SectionCard>
      ) : null}

      {confirmed && hasNotes ? (
        <SectionCard
          eyebrow="Step 4 of the follow-through"
          title="Tracker rows"
          subtitle="The Health Tracker, the Risk Register and the Stakeholder Map, each shown against the row as it stands today. Every field that changes says what it was."
        >
          <FollowThroughTrackers
            touchId={touch.id}
            {...(touch.followThrough?.trackerCards ? { cards: touch.followThrough.trackerCards } : {})}
          />
        </SectionCard>
      ) : null}

      {confirmed && hasNotes ? (
        <SectionCard
          eyebrow="Step 5 of the follow-through"
          title="Client recap email"
          subtitle="Built from the notes and the tickets you approved, in the same design as the agenda that went out before the call."
        >
          <FollowThroughRecap
            touchId={touch.id}
            {...(touch.followThrough?.recap ? { recap: touch.followThrough.recap } : {})}
          />
        </SectionCard>
      ) : null}

      {confirmed && hasNotes ? (
        <SectionCard
          eyebrow="Step 6 of the follow-through"
          title="Finish and process"
          subtitle="Nothing above has left MTOS yet. This button creates the tickets, files the notes, updates the trackers and sends the email — in that order, and only what you approved."
        >
          <FollowThroughFinish
            touchId={touch.id}
            {...(touch.followThrough?.notes ? { notes: touch.followThrough.notes } : {})}
            {...(touch.followThrough?.items ? { items: touch.followThrough.items } : {})}
            {...(touch.followThrough?.trackerCards ? { trackerCards: touch.followThrough.trackerCards } : {})}
            {...(touch.followThrough?.recap ? { recap: touch.followThrough.recap } : {})}
            {...(touch.followThrough?.processing ? { processing: touch.followThrough.processing } : {})}
            qaHref={`/qa/${touch.clientId}/${touch.id}`}
          />
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
