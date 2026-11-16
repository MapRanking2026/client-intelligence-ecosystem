import { canDeleteTestTouch } from "@/src/lib/contracts/touch-progress";
import { hasMeetingNotes } from "@/src/lib/contracts/follow-through-notes";
import { StartNewMonthlyTouch } from "@/src/components/mtos/start-new-monthly-touch";
import { TranscriptWaitPanel } from "@/src/components/mtos/transcript-wait-panel";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/src/components/mtos/app-shell";
import { FollowThroughChecklist } from "@/src/components/mtos/follow-through-checklist";
import { FollowThroughGate } from "@/src/components/mtos/follow-through-gate";
import { FollowThroughFinish } from "@/src/components/mtos/follow-through-finish";
import { FollowThroughItems } from "@/src/components/mtos/follow-through-items";
import { FollowThroughNotes } from "@/src/components/mtos/follow-through-notes";
import { FollowThroughRecap } from "@/src/components/mtos/follow-through-recap";
import { FollowThroughTrackers } from "@/src/components/mtos/follow-through-trackers";
import { SectionCard } from "@/src/components/mtos/section-card";
import { resolveTenantContext } from "@/src/lib/auth/resolve-tenant-context";
import { followThroughChecklist } from "@/src/lib/contracts/follow-through-checklist";
import { scoreConfirmed } from "@/src/lib/contracts/follow-through-score";
import {
  listTicketTags,
  readDepartmentOwners,
} from "@/src/lib/server/services/follow-through-items-service";
import { getMonthlyTouchWorkspaceView } from "@/src/lib/server/services/monthly-touch-service";
import { listAssignableMembers } from "@/src/lib/server/services/post-meeting-service";
import { getAccountManagerProfile } from "@/src/lib/server/services/user-service";

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
  const hasTranscript = Boolean(touch.postMeeting?.transcript || touch.postMeeting?.recapSummary) ||
    touch.transcript?.status === "attached" || touch.transcript?.status === "found";
  const hasCapture = Object.values(touch.live?.notes || {}).some((note) => note.trim()) ||
    touch.liveSession?.segments.some((segment) => segment.notes.trim()) || Boolean(touch.liveSession?.closeNotes.trim());
  const hasUsableNotes = hasMeetingNotes(touch.followThrough?.notes);
  const autoPrepare = hasUsableNotes
    ? !touch.followThrough?.items || !touch.followThrough?.trackerCards
    : Boolean(hasTranscript || hasCapture);
  const legacyFiled = touch.postMeeting?.status === "approved" ||
    touch.postMeeting?.draftTickets?.some((ticket) => ticket.clickupTaskId);

  // Read once on the server and handed down, so the ticket forms open on real departments, real
  // people and the tags that actually exist rather than on a dropdown of guesses. Each of these
  // reports its own reason when it comes back empty; none of them throws.
  const [tags, owners, roster] = hasNotes
    ? await Promise.all([listTicketTags(context), readDepartmentOwners(context), listAssignableMembers(context)])
    : [{ tags: [] }, {}, { members: [] }];

  // One document, for one thing: the deadline on the checklist has to be on the AM's own clock,
  // and a time zone cannot be guessed from the server's.
  const profile = await getAccountManagerProfile(context);
  const checklist = followThroughChecklist(touch);

  return (
    <AppShell
      title={`${client.name} — follow-through`}
      subtitle="Everything the call commits us to, drafted for you to approve. Nothing is created in ClickUp, written to a tracker or sent to the client until you finish this screen."
    >
      <div className="mb-4 flex flex-wrap justify-between gap-2">
        <Link href={`/monthly-touch/${touch.id}/summary`} className="ilink text-[0.8rem]">
          Earlier post-meeting screen
        </Link>
        <StartNewMonthlyTouch
          touchId={touch.id}
          current={client.touchId === touch.id}
          canDelete={canDeleteTestTouch(touch)}
        />
      </div>
      {legacyFiled ? (
        <p className="card mb-4">Follow-up was already filed from the earlier screen. Open it to review what was sent.</p>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
      {touch.postMeeting?.transcript && !touch.transcript ? (
        <p className="muted mb-3 text-[0.8rem]">Transcript available from the earlier post-meeting screen.</p>
      ) : (
        <TranscriptWaitPanel
          touchId={touch.id}
          {...(touch.live?.callEndedAt ? { callEndedAt: touch.live.callEndedAt } : {})}
          {...(touch.transcript ? { transcript: touch.transcript } : {})}
        />
      )}
      <SectionCard
        eyebrow="Step 1 of the follow-through"
        title="Score the account"
        subtitle="The score decides what the rest of this page contains, so it comes first. A 6 or below adds the Risk Register row, the playbook and the Manager tag; the Health Tracker row reads it either way."
      >
        <FollowThroughGate autoAnalyze={hasTranscript && !legacyFiled} touchId={touch.id} clientName={client.name} {...(gate ? { gate } : {})} />
      </SectionCard>

      {confirmed ? (
        <div id="notes" className="scroll-mt-20">
        <SectionCard
          eyebrow="Step 2 of the follow-through"
          title="Post Monthly Touch Notes"
          subtitle="The numbering here is the numbering in the Client's Book, so what you read on this screen is what the next AM reads on the account."
        >
          <FollowThroughNotes
            touchId={touch.id}
            autoPrepare={Boolean(autoPrepare) && !legacyFiled}
            {...(touch.followThrough?.notes ? { notes: touch.followThrough.notes } : {})}
          />
        </SectionCard>
        </div>
      ) : null}

      {confirmed && hasNotes ? (
        <div id="tickets" className="scroll-mt-20">
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
        </div>
      ) : null}

      {confirmed && hasNotes ? (
        <div id="trackers" className="scroll-mt-20">
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
        </div>
      ) : null}

      {confirmed && hasNotes ? (
        <div id="recap" className="scroll-mt-20">
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
        </div>
      ) : null}

      {confirmed && hasNotes && !legacyFiled ? (
        <div id="finish" className="scroll-mt-20">
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
        </div>
      ) : null}

        </div>

        {/*
          Section 8 of the notes: what should have happened, answered from the record. Second in the
          DOM so a screen reader and a narrow screen both get the work before the summary of it.
        */}
        <FollowThroughChecklist
          rows={checklist}
          {...(touch.followThrough?.dueAt ? { dueAt: touch.followThrough.dueAt } : {})}
          {...(profile.timeZone ? { timeZone: profile.timeZone } : {})}
        />
      </div>

      <div className="mt-4">
        <Link href={`/monthly-touch/${touch.id}`} className="btn btn-ghost btn-sm">
          <ArrowLeft />
          Back to the call
        </Link>
      </div>
    </AppShell>
  );
}
