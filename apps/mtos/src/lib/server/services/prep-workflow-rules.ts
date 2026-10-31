import {
  PREP_STAGE_LABEL,
  PREP_STAGE_PREREQUISITE,
  type PrepDocumentState,
  type PrepStageId,
  type PrepWorkflowState,
} from "@/src/lib/contracts/prep-workflow";

/**
 * The ordering rules, with nothing else attached.
 *
 * Separated from the service that does the work so the rules can be exercised directly -- the
 * whole point of moving the sequence out of the buttons and into the application is that it can be
 * checked, and a rule that needs Firestore and a model provider to run is a rule nobody checks.
 */

/** A document is complete only when every required section was actually written. */
export function isPrepDocumentComplete(document: PrepDocumentState | undefined): boolean {
  return Boolean(document && document.markdown && document.missingSections.length === 0);
}

/**
 * Recompute which stages are open, from what has actually happened.
 *
 * Derived every time rather than stored as its own decision, so the gates cannot drift from the
 * evidence. A stage that completed and then lost its prerequisite -- notes regenerated after the
 * filing, say -- reopens instead of keeping a stale completion.
 */
export function recomputeGates(workflow: PrepWorkflowState): PrepWorkflowState {
  const stages = { ...workflow.stages };

  const researchDone = stages.research.status === "complete";
  const email = workflow.confirmationEmail;
  /**
   * The gate is the email having actually gone out, not merely having been approved.
   *
   * Step 2 of the workflow is "generate AND send", and section 15 of the preparation notes
   * reproduces the agenda the client received -- so writing the notes while the client has nothing
   * would produce a document that describes a message nobody got. Approval alone is not enough,
   * and approval followed by a failed send is not either; those two must not behave differently.
   *
   * `sent_manually` passes the gate because most tenants' Gmail connection is read-only: the AM
   * sends it from their own inbox and records that, which is a true statement about the client
   * having the agenda. Nothing downstream claims MTOS delivered it.
   */
  const emailDelivered = Boolean(email && (email.status === "sent" || email.status === "sent_manually"));
  const notesApproved = isPrepDocumentComplete(workflow.document) && Boolean(workflow.document?.approvedAt);

  if (!researchDone && stages.research.status !== "failed" && stages.research.status !== "running") {
    stages.research = { ...stages.research, status: "ready" };
  }

  if (!researchDone) {
    stages.confirmation_email = { status: "blocked" };
  } else if (stages.confirmation_email.status === "blocked") {
    stages.confirmation_email = { status: "ready" };
  }

  if (!emailDelivered) {
    // A recorded failure stays visible; otherwise the stage is simply not open yet.
    stages.prep_notes = stages.prep_notes.status === "failed" ? stages.prep_notes : { status: "blocked" };
  } else if (stages.prep_notes.status === "blocked") {
    stages.prep_notes = { status: "ready" };
  }

  if (!notesApproved) {
    stages.clickup_filing =
      stages.clickup_filing.status === "failed" ? stages.clickup_filing : { status: "blocked" };
  } else if (stages.clickup_filing.status === "blocked") {
    stages.clickup_filing = { status: "ready" };
  }

  return { ...workflow, stages };
}

export function isStageOpen(workflow: PrepWorkflowState, stage: PrepStageId): boolean {
  return recomputeGates(workflow).stages[stage].status !== "blocked";
}

/** The sentence an AM reads when a stage is refused. */
export function blockedReason(stage: PrepStageId): string {
  return `${PREP_STAGE_LABEL[stage]} can't run yet. ${PREP_STAGE_PREREQUISITE[stage]}`;
}
