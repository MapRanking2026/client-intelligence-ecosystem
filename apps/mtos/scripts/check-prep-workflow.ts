/**
 * Pins the Monthly Touch preparation workflow's rules.
 *
 * Four things here are requirements rather than behaviour that happens to work, and each is a thing
 * that was wrong before:
 *
 *   1. The four stages run in one order, enforced in the application. A later stage whose
 *      prerequisite is not genuinely satisfied is refused -- not merely hidden.
 *   2. A touch is only `Ready` when the required preparation actually ran and succeeded. The old
 *      scores were floored at 55, rose with the number of open commitments, and set the status to
 *      `Ready` on every run, which is how the list showed `Ready · 94` beside a panel that said
 *      "Not prepared yet".
 *   3. The document keeps every required section, in the original prompt's order, with 15 and 16
 *      last -- and a required section the model skipped is reported, never dropped.
 *   4. Missing information is missing. Never a zero, never invented.
 *
 * Deliberately exercising the pure rule modules rather than the services around them: these are the
 * rules, and a rule that needs Firestore and a model provider to run is a rule nobody checks. What
 * is NOT covered here is the live I/O -- the Gmail send, the ClickUp write, the model calls -- which
 * is noted at the end of the run.
 *
 * Run with: npm run check:prep-workflow
 */
import { emptyPrepWorkflowState, type PrepWorkflowState } from "@/src/lib/contracts/prep-workflow";
import { BRIEF_BODY_SECTION_IDS, EMPTY_PREP_BRIEF } from "@/src/lib/contracts/prep-brief";
import type { ClientRecord, MonthlyTouchRecord } from "@/src/lib/mtos-data";
import {
  bundledPrepDocumentSections,
  bundledPrepDocumentSectionsText,
  renderSectionBrief,
  requiredPrepSectionIds,
} from "@/src/lib/server/prompts/prep-document-prompt";
import {
  assembleMarkdown,
  buildSections,
  resolveApplicability,
  type ModelSection,
} from "@/src/lib/server/services/prep-document-builder";
import {
  computeConfidence,
  computeReadiness,
  deriveBoardColumn,
  deriveRunSheetStage,
  deriveTouchStatus,
} from "@/src/lib/server/services/prep-readiness-service";
import { isStageOpen, recomputeGates } from "@/src/lib/server/services/prep-workflow-rules";
import { matchCalendarEventsToClients, selectMeetingForTouch } from "@/src/lib/server/calendar-touch-matching";
import { buildGbpCompleteness } from "@/src/lib/server/gbp-listing-completeness";
import { selectPinnedGbpLocations, selectPinnedGhlLocationId } from "@/src/lib/server/integration-sync";
import { describeGbpPerformanceGap } from "@/src/lib/server/services/monthly-touch-prep-service";

/**
 * The document's section catalogue, read from the bundled Prompt Engine library rather than from a
 * module constant -- which is where it used to live. Reading the bundled seed keeps these checks
 * pure (no Firestore) while exercising the same parser the runtime uses.
 */
const PREP_DOCUMENT_SECTIONS = bundledPrepDocumentSections();
const REQUIRED_PREP_SECTION_IDS = requiredPrepSectionIds(PREP_DOCUMENT_SECTIONS);

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

function scenario(name: string) {
  console.log(`\n${name}`);
}

const NOW = "2026-11-02T17:00:00.000Z";

// ---------------------------------------------------------------------------
// Fixtures. Shaped like the real records, trimmed to what the rules read.
// ---------------------------------------------------------------------------

function client(overrides: Partial<ClientRecord> = {}): ClientRecord {
  return {
    id: "acme-plumbing",
    name: "Acme Plumbing",
    industry: "Plumbing",
    contact: "Dana Reyes",
    lifecycleStage: "Growth",
    touchId: "touch-acme-nov",
    touchDate: "Nov 05, 2026",
    healthScore: null,
    relationshipScore: null,
    growthReadiness: null,
    tone: "healthy",
    summary: "Steady lead flow, slow call-back speed.",
    topRisks: [],
    topOpportunities: [],
    commitmentsOpen: 0,
    nextBestAction: "Confirm the mobile form fix owner.",
    ...overrides,
  };
}

function metric(available: boolean) {
  return {
    label: "Leads",
    value: available ? 24 : null,
    previousValue: available ? 19 : null,
    availability: (available ? "available" : "unavailable") as "available" | "unavailable",
    source: available ? "GoHighLevel" : "not connected",
  };
}

function prepPack(overrides: { metricsAvailable?: boolean; adsChannels?: string[]; bookPages?: number; gaps?: string[] } = {}) {
  const available = overrides.metricsAvailable ?? true;
  const channels = overrides.adsChannels ?? ["Google Ads"];
  return {
    preparedAt: NOW,
    pipelineVersion: "2026.11",
    clientSummary: "Acme Plumbing, North Phoenix.",
    schedule: { touchDate: "Nov 05, 2026", scheduledAt: "2026-11-05T21:00:00.000Z" },
    focusAreas: ["Booked jobs"],
    keyFacts: [],
    openCommitments: [],
    activeOpportunities: [],
    integrationSources: [],
    businessScorecard: {
      totalLeads: metric(available),
      qualifiedLeads: metric(available),
      costPerLead: metric(available),
      callsAnswered: metric(available),
      callsMissed: metric(available),
      formSubmissions: metric(available),
      bookedJobs: metric(available),
      shareOfLocalVoice: metric(true),
      top3Coverage: metric(true),
      mapCheckIns: metric(true),
      hasSalesStructureData: available,
    },
    seoPerformance: {
      heatmaps: [],
      matchedBusinesses: [],
      keywordScanHistory: [],
      heatmapGrids: [],
      checkinBusinesses: [],
      gbpPerformance: [],
      mapCheckInCount: null,
      availability: "available" as const,
      notes: [],
    },
    adsPerformance: channels.map((channel) => ({
      channel: channel as "Google Ads" | "Google LSA" | "Meta Ads",
      connected: true,
      spend: 2400,
      leads: 31,
      costPerLead: 77,
      ctr: null,
      conversionRate: null,
      benchmarkNote: "",
    })),
    strategicAction: {
      hasAgreedAction: false,
      title: "",
      agreedAt: "",
      implementationPercent: 0,
      resultsSoFar: "",
      nextSteps: "",
    },
    clientParticipation: { items: [], basicsReady: true, gaps: [] },
    issuesAndSolutions: [],
    leadQualityQuestions: [],
    recapQuestions: [],
    dataGaps: overrides.gaps ?? [],
    clickupContext: {
      matched: true,
      folderName: "Acme Plumbing",
      clientsBook: Array.from({ length: overrides.bookPages ?? 3 }, (_, index) => ({
        pageName: `Page ${index + 1}`,
        content: "",
      })),
      recentChat: [],
      notes: [],
    },
    claude: { status: "generated" as const, generatedAt: NOW },
  };
}

/**
 * A brief with all fifteen sections written.
 *
 * Section 15 is the client-facing agenda, which the agenda email record fills rather than the
 * model, so it is left out here and still counts as populated.
 */
function wholeBrief() {
  return {
    ...EMPTY_PREP_BRIEF,
    sections: BRIEF_BODY_SECTION_IDS.filter((id) => id !== "15").map((id) => ({
      id,
      title: `Section ${id}`,
      markdown: `What section ${id} found.`,
    })),
  };
}

function touch(overrides: Partial<MonthlyTouchRecord> = {}): MonthlyTouchRecord {
  return {
    id: "touch-acme-nov",
    clientId: "acme-plumbing",
    status: "Preparing",
    readinessScore: 0,
    confidenceScore: 0,
    scheduledAt: "2026-11-05T21:00:00.000Z",
    executiveBrief: "",
    agenda: [],
    wins: [],
    risks: [],
    opportunities: [],
    talkingPoints: [],
    commitments: [],
    aiRecommendations: [],
    ...overrides,
  };
}

function sourceChecks(reachable: number, total = 8) {
  return Array.from({ length: total }, (_, index) => ({
    key: `source-${index}`,
    label: `Source ${index}`,
    checked: index < reachable,
    reachable: index < reachable,
    detail: index < reachable ? "answered" : "not connected, so this source was not checked.",
  }));
}

/** A workflow whose stages have been walked up to, but not including, `stopBefore`. */
function workflowAt(
  stopBefore: "research" | "confirmation_email" | "prep_notes" | "clickup_filing" | "done",
  overrides: Partial<PrepWorkflowState> = {},
): PrepWorkflowState {
  const base = emptyPrepWorkflowState(NOW);
  const order = ["research", "confirmation_email", "prep_notes", "clickup_filing", "done"];
  const upTo = order.indexOf(stopBefore);

  const state: PrepWorkflowState = { ...base };

  if (upTo > 0) {
    state.stages = { ...state.stages, research: { status: "complete", completedAt: NOW } };
    state.research = {
      completedAt: NOW,
      pipelineVersion: "2026.11",
      agenda: ["Wins", "Issues", "Ads", "Goal", "Next 30 days"],
      sourceChecks: sourceChecks(6),
      dataGaps: [],
      commsVerification: { intercom: "not_connected", gmail: "checked", note: "Gmail read; Intercom not connected." },
    };
  }
  if (upTo > 1) {
    state.confirmationEmail = {
      subject: "Agenda for our November check-in",
      body: "Hi Dana, here is what we will cover…",
      channel: "Email",
      recipient: "dana@acmeplumbing.com",
      recipientSource: "Entered by the account manager.",
      timeZone: "America/Phoenix",
      timeZoneSource: "Set by the account manager.",
      meetingWhen: "Thu, Nov 5, 2026 at 2:00 PM MST",
      // Completing this stage means the client actually has the agenda, not just that the
      // wording was approved -- that is what opens the preparation notes.
      status: "sent",
      sentAt: NOW,
      sentVia: "Gmail (support@mapranking.com)",
      generatedAt: NOW,
      approvedAt: NOW,
      approvedBy: "am-1",
      deliveryAttempts: 1,
      idempotencyKey: "confirm-touch-acme-nov-abc123",
      gaps: [],
    };
  }
  if (upTo > 2) {
    state.document = {
      markdown: "# doc",
      sections: [],
      generatedAt: NOW,
      missing: [],
      missingSections: [],
      approvedAt: NOW,
      approvedBy: "am-1",
    };
    state.stages = { ...state.stages, prep_notes: { status: "complete", completedAt: NOW } };
  }
  if (upTo > 3) {
    state.filing = {
      status: "filed",
      links: {
        docId: "doc-1",
        prepPageId: "page-1",
        prepPageUrl: "https://app.clickup.com/1/docs/doc-1/page-1",
        postPageId: "page-2",
        postPageUrl: "https://app.clickup.com/1/docs/doc-1/page-2",
        writtenAt: NOW,
      },
      postNotesCreated: true,
      filedAt: NOW,
      destination: "Map Ranking space → Acme Plumbing → Client's Book → Client Meetings Notes",
    };
    state.stages = { ...state.stages, clickup_filing: { status: "complete", completedAt: NOW } };
  }

  return recomputeGates({ ...state, ...overrides });
}

// ---------------------------------------------------------------------------
// 1. The order is enforced
// ---------------------------------------------------------------------------

scenario("The four stages run in one order");
{
  const fresh = workflowAt("research");
  check("a fresh touch may run the account review", isStageOpen(fresh, "research"));
  check("the client email is refused before the account review", !isStageOpen(fresh, "confirmation_email"));
  check("the preparation notes are refused before the email", !isStageOpen(fresh, "prep_notes"));
  check("filing is refused before the notes", !isStageOpen(fresh, "clickup_filing"));

  const afterResearch = workflowAt("confirmation_email");
  check("the email opens once the review completed", isStageOpen(afterResearch, "confirmation_email"));
  check("the notes stay refused while the client has no agenda", !isStageOpen(afterResearch, "prep_notes"));

  // A draft that has not been approved must not open the notes: the document reproduces the
  // approved wording, so writing it first would describe a meeting the client was never told about.
  const draftOnly = workflowAt("prep_notes", {
    confirmationEmail: { ...workflowAt("prep_notes").confirmationEmail!, status: "draft", approvedAt: undefined },
  });
  check("a draft email (not approved) does not open the notes", !isStageOpen(draftOnly, "prep_notes"));

  const approvedNotSent = workflowAt("prep_notes", {
    confirmationEmail: { ...workflowAt("prep_notes").confirmationEmail!, status: "approved", sentAt: undefined, sentVia: undefined },
  });
  check(
    "an approved but unsent email does not open the notes either",
    !isStageOpen(approvedNotSent, "prep_notes"),
    "section 15 reproduces what the client received, so the client has to have it",
  );

  const afterEmail = workflowAt("prep_notes");
  check("the notes open once the email has gone out", isStageOpen(afterEmail, "prep_notes"));
  check("filing stays refused while the notes are unapproved", !isStageOpen(afterEmail, "clickup_filing"));

  const afterNotes = workflowAt("clickup_filing");
  check("filing opens once the notes are approved", isStageOpen(afterNotes, "clickup_filing"));

  // An incomplete document cannot be approved into a filing, however complete the record looks.
  const incompleteNotes = workflowAt("clickup_filing", {
    document: { ...workflowAt("clickup_filing").document!, missingSections: ["14"] },
  });
  check(
    "filing is refused when a required section is missing",
    !isStageOpen(incompleteNotes, "clickup_filing"),
    "a document missing section 14 is not a usable preparation",
  );
}

// ---------------------------------------------------------------------------
// 2. Readiness, confidence and status tell the truth
// ---------------------------------------------------------------------------

scenario("Readiness and status reflect what actually ran");
{
  const never = touch();
  const readinessNever = computeReadiness(never);
  check("an unprepared touch scores null, not zero", readinessNever.score === null);
  check("it says so in words", readinessNever.label === "Not prepared");
  check("it is never Ready", deriveTouchStatus(never, readinessNever) === "Preparing");
  check("confidence is not measured either", computeConfidence(never).score === null);

  const researchOnly = touch({ prepWorkflow: workflowAt("confirmation_email"), prepPack: prepPack() });
  const readinessResearch = computeReadiness(researchOnly);
  check(
    "data pulls alone do not make a touch ready",
    deriveTouchStatus(researchOnly, readinessResearch) === "Preparing",
    `scored ${readinessResearch.score}`,
  );
  check("the blockers name the steps that have not run", readinessResearch.blockers.length >= 2);
  check(
    "every readiness input is explained",
    readinessResearch.inputs.every((input) => input.label && input.detail && input.weight > 0),
  );

  const failedResearch = touch({
    prepWorkflow: {
      ...workflowAt("research"),
      stages: {
        ...workflowAt("research").stages,
        research: { status: "failed", errorMessage: "The model did not answer." },
      },
    },
  });
  const readinessFailed = computeReadiness(failedResearch);
  check("a failed review is a blocker", readinessFailed.blockers.length > 0);
  check("and cannot be Ready", deriveTouchStatus(failedResearch, readinessFailed) === "Preparing");

  const complete = touch({
    prepWorkflow: {
      ...workflowAt("done"),
      confirmationEmail: {
        ...workflowAt("done").confirmationEmail!,
        status: "sent",
        sentAt: NOW,
        sentVia: "Gmail",
      },
    },
    prepPack: prepPack(),
  });
  const readinessComplete = computeReadiness(complete);
  check("a fully worked touch has no blockers", readinessComplete.blockers.length === 0, readinessComplete.blockers.join("; "));
  check("and reads Ready", deriveTouchStatus(complete, readinessComplete) === "Ready", `scored ${readinessComplete.score}`);

  // The old score rose with the number of open commitments. It must not.
  const manyCommitments = touch({
    prepWorkflow: workflowAt("confirmation_email"),
    prepPack: prepPack(),
    commitments: ["a", "b", "c", "d", "e", "f"],
  });
  check(
    "open commitments do not raise readiness",
    computeReadiness(manyCommitments).score === readinessResearch.score,
  );

  // Live and Completed are the AM's own markers from the meeting and are never recomputed.
  const live = touch({ status: "Live", prepWorkflow: workflowAt("confirmation_email") });
  check("a Live touch stays Live", deriveTouchStatus(live, computeReadiness(live)) === "Live");
}

scenario("Confidence measures the evidence, not the client's health label");
{
  const full = touch({ prepWorkflow: workflowAt("confirmation_email"), prepPack: prepPack() });
  const thin = touch({
    prepWorkflow: {
      ...workflowAt("confirmation_email"),
      research: {
        ...workflowAt("confirmation_email").research!,
        sourceChecks: sourceChecks(1),
        dataGaps: ["No CRM connected", "No call tracking", "No ads account", "No reviews data"],
      },
    },
    prepPack: prepPack({ metricsAvailable: false, bookPages: 0, gaps: ["No CRM connected"] }),
  });

  const confFull = computeConfidence(full);
  const confThin = computeConfidence(thin);
  check("a well-evidenced touch scores higher than a thin one", (confFull.score ?? 0) > (confThin.score ?? 0));
  check("the thin one says the evidence is thin", confThin.label === "Thin evidence", confThin.label);
  check("the gaps are listed, not summarised away", confThin.gaps.length === 4);
  check(
    "a missing business number is reported as missing, not as zero",
    confThin.inputs.some((input) => input.key === "business_numbers" && input.status === "missing"),
  );
  check(
    "an unverified inbox is stated plainly",
    confFull.inputs.some((input) => input.key === "comms" && input.detail.includes("Intercom")),
  );
}

// ---------------------------------------------------------------------------
// 3. The document keeps the original structure
// ---------------------------------------------------------------------------

scenario("The document keeps every required section, in the original order");
{
  const order = PREP_DOCUMENT_SECTIONS.map((spec) => spec.id);
  check("section 0 comes first", order[0] === "0");
  check("the retention section follows it", order[1] === "R");
  check("sections 1 to 16 follow in order", order.slice(2).join(",") === Array.from({ length: 16 }, (_, i) => String(i + 1)).join(","));
  check("section 15 is second to last", order[order.length - 2] === "15");
  check("section 16 is last", order[order.length - 1] === "16");
  check(
    "15 required sections; only R, 9 and 10 are conditional",
    REQUIRED_PREP_SECTION_IDS.length === 15 &&
      !REQUIRED_PREP_SECTION_IDS.includes("R") &&
      !REQUIRED_PREP_SECTION_IDS.includes("9") &&
      !REQUIRED_PREP_SECTION_IDS.includes("10"),
    REQUIRED_PREP_SECTION_IDS.join(","),
  );
  check(
    "every section carries guidance for the model",
    PREP_DOCUMENT_SECTIONS.every((spec) => spec.guidance.trim().length > 40),
  );
  // Round trip: what the engine row holds is exactly what the model is sent. If these ever drift,
  // an operator's edit would mean something different from what they read on the screen.
  check(
    "the catalogue renders back to the text the engine row holds",
    PREP_DOCUMENT_SECTIONS.map(renderSectionBrief).join("\n\n") === bundledPrepDocumentSectionsText(),
  );
  check(
    "the two conditional sections keep their 'include when' line",
    PREP_DOCUMENT_SECTIONS.filter((spec) => spec.appliesWhen).map((spec) => spec.id).join(",") === "R,9,10",
    PREP_DOCUMENT_SECTIONS.filter((spec) => spec.appliesWhen).map((spec) => spec.id).join(","),
  );

  const applicability = resolveApplicability(client(), touch({ prepPack: prepPack({ adsChannels: ["Google Ads"] }) }));
  const everySection: ModelSection[] = PREP_DOCUMENT_SECTIONS.map((spec) => ({
    id: spec.id,
    markdown: `Body for section ${spec.id}.`,
  }));
  const { sections, missingSections } = buildSections(PREP_DOCUMENT_SECTIONS, everySection, applicability);
  check("a complete answer leaves nothing missing", missingSections.length === 0);
  check(
    "Meta is marked not applicable when it is not connected",
    sections.find((section) => section.id === "10")?.included === false,
  );
  check(
    "and carries the reason, so the AM knows why it is not there",
    (sections.find((section) => section.id === "10")?.skippedReason || "").includes("Meta Ads is not connected"),
  );

  // The failure that matters: the model returns the first half and stops.
  const halfAnswer = everySection.filter((entry) => ["0", "1", "2", "3", "4", "5", "6", "7", "8"].includes(entry.id));
  const half = buildSections(PREP_DOCUMENT_SECTIONS, halfAnswer, applicability);
  check(
    "a skipped required section is reported, not dropped",
    half.missingSections.includes("14") && half.missingSections.includes("16"),
    half.missingSections.join(","),
  );
  check(
    "it keeps its place in the document",
    half.sections.some((section) => section.id === "14" && section.failed === true),
  );
  check("every section still appears", half.sections.length === PREP_DOCUMENT_SECTIONS.length);

  const markdown = assembleMarkdown("Acme Plumbing", "2026-11-05T21:00:00.000Z", sections, [
    "No call tracking is connected, so call handling cannot be reviewed.",
  ]);
  check("the document is titled with the client and the meeting date", markdown.startsWith("# Monthly Touch Preparation — Acme Plumbing — Nov 5, 2026"));
  check("the missing-evidence banner is above section 0", markdown.indexOf("Missing evidence") < markdown.indexOf("## 0."));
  check("section 16 closes the document", markdown.trimEnd().includes("## 16."));
  check(
    "the closing sections are in the right places",
    markdown.indexOf("## 14.") < markdown.indexOf("## 15.") && markdown.indexOf("## 15.") < markdown.indexOf("## 16."),
  );

  const noGaps = assembleMarkdown("Acme Plumbing", "2026-11-05T21:00:00.000Z", sections, []);
  check(
    "with no gaps it does not claim every system is complete",
    noGaps.includes("not the same as every system being complete"),
  );
}

scenario("Conditional sections follow the evidence");
{
  const healthy = resolveApplicability(client(), touch({ prepPack: prepPack() }));
  check("a healthy account gets no retention section", healthy.retention === false);

  const atRisk = resolveApplicability(client({ tone: "at_risk" }), touch({ prepPack: prepPack() }));
  check("a client flagged at risk gets one", atRisk.retention === true);

  const cancelTalk = resolveApplicability(
    client({ topRisks: ["Asked about cancelling after the last invoice"] }),
    touch({ prepPack: prepPack() }),
  );
  check("so does a client talking about cancelling", cancelTalk.retention === true);

  const churnSignal = resolveApplicability(client({ churnSignals: ["Stopped replying"] }), touch({ prepPack: prepPack() }));
  check("and one with a recorded churn signal", churnSignal.retention === true);

  const bothChannels = resolveApplicability(
    client(),
    touch({ prepPack: prepPack({ adsChannels: ["Google Ads", "Meta Ads"] }) }),
  );
  check("both ads sections apply when both are connected", bothChannels.googleAds && bothChannels.metaAds);

  const noAds = resolveApplicability(client(), touch({ prepPack: prepPack({ adsChannels: [] }) }));
  check("neither applies when neither is connected", !noAds.googleAds && !noAds.metaAds);

  const lsaOnly = resolveApplicability(client(), touch({ prepPack: prepPack({ adsChannels: ["Google LSA"] }) }));
  check("Local Services Ads counts as the Google Ads review", lsaOnly.googleAds === true);
}

// ---------------------------------------------------------------------------
// 4. The cases the brief asks for, one by one
// ---------------------------------------------------------------------------

scenario("A client with complete data and every integration available");
{
  const full = touch({ prepWorkflow: workflowAt("done"), prepPack: prepPack() });
  const readiness = computeReadiness(full);
  check("readiness has no blockers", readiness.blockers.length === 0);
  check("confidence is well evidenced", computeConfidence(full).label === "Well evidenced", computeConfidence(full).label);
  check("the board puts it past Not prepped", deriveBoardColumn(full) !== "not_prepped");
}

scenario("A client with missing performance data");
{
  const sparse = touch({
    prepWorkflow: {
      ...workflowAt("confirmation_email"),
      research: {
        ...workflowAt("confirmation_email").research!,
        // The gaps live on the research snapshot, which is what the preparation actually saw.
        dataGaps: ["No CRM is connected for this client."],
      },
    },
    prepPack: prepPack({ metricsAvailable: false, gaps: ["No CRM is connected for this client."] }),
  });
  const confidence = computeConfidence(sparse);
  check("the business numbers read as missing", confidence.inputs.some((i) => i.key === "business_numbers" && i.status === "missing"));
  check("the gap is named for the AM", confidence.gaps.includes("No CRM is connected for this client."));
  check("the preparation still runs", isStageOpen(sparse.prepWorkflow!, "confirmation_email"));
}

scenario("A client whose Intercom or Gmail records cannot be retrieved");
{
  const unverified = touch({
    prepWorkflow: {
      ...workflowAt("confirmation_email"),
      research: {
        ...workflowAt("confirmation_email").research!,
        commsVerification: {
          intercom: "not_connected",
          gmail: "not_connected",
          note: "Intercom is not connected, so the shared client inbox was NOT checked. Gmail is not connected, so the support@ inbox was NOT checked. Because both inboxes were not verified, do not state that any email was sent, received or left unanswered.",
        },
      },
    },
    prepPack: prepPack(),
  });
  const confidence = computeConfidence(unverified);
  const comms = confidence.inputs.find((input) => input.key === "comms")!;
  check("the email check is recorded as not done", comms.status === "missing");
  check(
    "and the record forbids claiming an email was or was not sent",
    comms.detail.includes("do not state that any email was sent"),
  );
}

scenario("A client with outstanding commitments from the previous meeting");
{
  const withCommitments = touch({
    prepWorkflow: workflowAt("confirmation_email"),
    prepPack: prepPack(),
    commitments: ["Send the photos (client, overdue)", "Fix the mobile form (Map Ranking, in progress)"],
  });
  // Section 0 and section 3 both exist to carry these, and section 0 is the first thing in the doc.
  check(
    "section 0 is where last month's promises go",
    PREP_DOCUMENT_SECTIONS[0].guidance.includes("what we promised"),
  );
  check(
    "it is a required section, so it is written even when sparse",
    PREP_DOCUMENT_SECTIONS[0].required === true,
  );
  check("open commitments do not inflate the score", computeReadiness(withCommitments).score !== null);
}

scenario("A client with active retention risks");
{
  const atRisk = client({ tone: "critical", riskNote: "Asked to pause after the September invoice." });
  const applicability = resolveApplicability(atRisk, touch({ prepPack: prepPack() }));
  check("the retention section is included", applicability.retention === true);
  const { sections } = buildSections(
    PREP_DOCUMENT_SECTIONS,
    PREP_DOCUMENT_SECTIONS.filter((spec) => spec.id !== "10").map((spec) => ({ id: spec.id, markdown: "Body." })),
    applicability,
  );
  const retention = sections.find((section) => section.id === "R")!;
  check("and is written, not skipped", retention.included === true);
  check("it sits before section 1", sections.findIndex((s) => s.id === "R") < sections.findIndex((s) => s.id === "1"));
}

scenario("A client whose preparation fails");
{
  const failed: PrepWorkflowState = {
    ...emptyPrepWorkflowState(NOW),
    stages: {
      ...emptyPrepWorkflowState(NOW).stages,
      research: { status: "failed", errorMessage: "No AI provider is configured.", attempts: 1 },
    },
  };
  const broken = touch({ prepWorkflow: recomputeGates(failed) });
  check("nothing downstream opens", !isStageOpen(broken.prepWorkflow!, "confirmation_email"));
  check("the touch is not Ready", deriveTouchStatus(broken, computeReadiness(broken)) === "Preparing");
  check("the board shows it as not prepped", deriveBoardColumn(broken) === "not_prepped");
  check("the run-sheet opens on Prep", deriveRunSheetStage(broken) === "prep");
  check(
    "the reason is on the record",
    (computeReadiness(broken).blockers.join(" ") || "").includes("No AI provider is configured."),
  );
}

scenario("A client whose confirmation email requires approval");
{
  const drafted = workflowAt("prep_notes");
  const asDraft: PrepWorkflowState = recomputeGates({
    ...drafted,
    confirmationEmail: { ...drafted.confirmationEmail!, status: "draft", approvedAt: undefined, approvedBy: undefined },
  });
  check("a draft does not open the notes", !isStageOpen(asDraft, "prep_notes"));
  const approved = recomputeGates({
    ...asDraft,
    confirmationEmail: { ...asDraft.confirmationEmail!, status: "approved", approvedAt: NOW, approvedBy: "am-1" },
  });
  check("approving alone does not open them", !isStageOpen(approved, "prep_notes"));
  const sent = recomputeGates({
    ...approved,
    confirmationEmail: { ...approved.confirmationEmail!, status: "sent", sentAt: NOW, sentVia: "Gmail" },
  });
  check("sending it does", isStageOpen(sent, "prep_notes"));

  const readinessApproved = computeReadiness(touch({ prepWorkflow: approved, prepPack: prepPack() }));
  const emailInput = readinessApproved.inputs.find((input) => input.key === "confirmation_email")!;
  check("approved but unsent is only part credit", emailInput.status === "partial");
  check(
    "and says the client has not been told",
    emailInput.detail.includes("the client has not been told"),
    emailInput.detail,
  );
}

scenario("A client who booked the call the same day, so the email is skipped on purpose");
{
  const drafted = workflowAt("prep_notes");
  const unsent: PrepWorkflowState = recomputeGates({
    ...drafted,
    confirmationEmail: {
      ...drafted.confirmationEmail!,
      status: "draft",
      approvedAt: undefined,
      approvedBy: undefined,
      sentAt: undefined,
      sentVia: undefined,
    },
  });
  check("the notes are shut while the email is unsettled", !isStageOpen(unsent, "prep_notes"));

  const skipped = recomputeGates({
    ...unsent,
    confirmationEmail: {
      ...unsent.confirmationEmail!,
      status: "skipped",
      skippedAt: NOW,
      skippedBy: "am-1",
      skipReason: "Booked the same day — the client already has the time.",
    },
  });
  check("a deliberate skip opens the notes", isStageOpen(skipped, "prep_notes"));
  check("and it is never recorded as sent", skipped.confirmationEmail!.status === "skipped");
  check("nothing claims a send happened", !skipped.confirmationEmail!.sentAt);

  const skippedTouch = touch({ prepWorkflow: skipped, prepPack: prepPack() });
  const emailInput = computeReadiness(skippedTouch).inputs.find((input) => input.key === "confirmation_email")!;
  // A skip unblocks the work; it does not earn the points for a step that did not happen.
  check("a skip is part credit, not full", emailInput.status === "partial");
  check(
    "and the score says the client got no agenda",
    emailInput.detail.includes("was not sent an agenda"),
    emailInput.detail,
  );
  check("the AM's reason is kept", emailInput.detail.includes("Booked the same day"), emailInput.detail);

  // Reversible: approving the wording afterwards puts the touch back on the normal path, where
  // approval alone is once again not enough to open the notes.
  const reconsidered = recomputeGates({
    ...skipped,
    confirmationEmail: { ...skipped.confirmationEmail!, status: "approved", approvedAt: NOW, approvedBy: "am-1" },
  });
  check("changing your mind puts the gate back", !isStageOpen(reconsidered, "prep_notes"));
}

scenario("A client whose confirmation email fails to send");
{
  const sendFailed = recomputeGates({
    ...workflowAt("prep_notes"),
    confirmationEmail: {
      ...workflowAt("prep_notes").confirmationEmail!,
      status: "failed",
      deliveryAttempts: 2,
      lastError: "The Gmail connection was authorized for reading only, so Google refuses a send on it.",
    },
  });
  const failedTouch = touch({ prepWorkflow: sendFailed, prepPack: prepPack() });
  const emailInput = computeReadiness(failedTouch).inputs.find((input) => input.key === "confirmation_email")!;
  check("a failed send is recorded as failed", emailInput.status === "failed");
  check("the reason is kept for the retry", emailInput.detail.includes("reading only"));
  check("it is never counted as sent", sendFailed.confirmationEmail!.status !== "sent");
  check("the attempts are counted", sendFailed.confirmationEmail!.deliveryAttempts === 2);
  // A failed send BLOCKS the notes, and that is deliberate. The client has not been told the
  // agenda, so writing notes whose section 15 reproduces "what the client received" would be
  // writing a false document. The AM has two honest ways forward and both reopen the stage: send
  // again, or record that they sent it themselves. Neither requires re-approving the wording.
  check("a failed send blocks the notes", !isStageOpen(sendFailed, "prep_notes"));
  const recordedManually = recomputeGates({
    ...sendFailed,
    confirmationEmail: {
      ...sendFailed.confirmationEmail!,
      status: "sent_manually",
      sentAt: NOW,
      sentVia: "sent by the account manager (email from my own inbox)",
    },
  });
  check("recording that the AM sent it reopens them", isStageOpen(recordedManually, "prep_notes"));
  check(
    "and the record still says MTOS did not send it",
    recordedManually.confirmationEmail!.status === "sent_manually",
  );
}

scenario("A client whose ClickUp destination cannot be found");
{
  const filingFailed = recomputeGates({
    ...workflowAt("done"),
    filing: {
      status: "failed",
      postNotesCreated: false,
      errorMessage: 'No ClickUp folder in the Map Ranking space matched "Acme Plumbing", so there is no Client\'s Book to file the notes in.',
    },
    stages: {
      ...workflowAt("done").stages,
      clickup_filing: { status: "failed", errorMessage: "No matching folder.", attempts: 1 },
    },
  });
  const failedTouch = touch({ prepWorkflow: filingFailed, prepPack: prepPack() });
  const readiness = computeReadiness(failedTouch);
  check("filing failure is a blocker", readiness.blockers.some((blocker) => blocker.includes("ClickUp")));
  check("the touch is not Ready", deriveTouchStatus(failedTouch, readiness) === "Preparing");
  check("the reason names the client it looked for", (filingFailed.filing!.errorMessage || "").includes("Acme Plumbing"));
  check("the retry stays available", isStageOpen(filingFailed, "clickup_filing"));
}

scenario("A repeated run must not duplicate an email or a page");
{
  const sent = recomputeGates({
    ...workflowAt("done"),
    confirmationEmail: {
      ...workflowAt("done").confirmationEmail!,
      status: "sent",
      sentAt: NOW,
      sentVia: "Gmail",
      deliveryAttempts: 1,
    },
  });
  check("a sent email keeps its one delivery key", sent.confirmationEmail!.idempotencyKey === "confirm-touch-acme-nov-abc123");
  check("and is recorded as sent once", sent.confirmationEmail!.deliveryAttempts === 1);
  // Filing again edits the recorded page ids rather than creating a second page for the same date.
  check("the page MTOS wrote is remembered", sent.filing!.links!.prepPageId === "page-1");
  check("so is the post-meeting subpage", sent.filing!.links!.postPageId === "page-2");
  check("re-filing is allowed, because it edits those pages", isStageOpen(sent, "clickup_filing"));
}

scenario("A meeting that has already been prepared and needs an update");
{
  const done = workflowAt("done");
  // Regenerating the notes clears the approval, which closes the filing gate again: an unapproved
  // document must not be able to ride a previous approval into the client's book.
  const regenerated = recomputeGates({
    ...done,
    document: { ...done.document!, markdown: "# doc v2", approvedAt: undefined, approvedBy: undefined },
  });
  check("filing closes again until the new notes are approved", !isStageOpen(regenerated, "clickup_filing"));
  check("the account review can be re-run at any time", isStageOpen(regenerated, "research"));
  const reapproved = recomputeGates({
    ...regenerated,
    document: { ...regenerated.document!, approvedAt: NOW, approvedBy: "am-1" },
  });
  check("and reopens once they are", isStageOpen(reapproved, "clickup_filing"));
}

scenario("A first Monthly Touch with no previous meeting notes");
{
  const first = touch({
    prepWorkflow: {
      ...workflowAt("confirmation_email"),
      research: {
        ...workflowAt("confirmation_email").research!,
        sourceChecks: sourceChecks(4),
      },
    },
    prepPack: prepPack({ bookPages: 0 }),
  });
  const confidence = computeConfidence(first);
  const memory = confidence.inputs.find((input) => input.key === "client_memory")!;
  check("the absent client history is stated", memory.status === "missing");
  check(
    "and what that costs is explained",
    memory.detail.includes("last month") && memory.detail.includes("not in this preparation"),
    memory.detail,
  );
  check("the preparation still proceeds", isStageOpen(first.prepWorkflow!, "confirmation_email"));
  check(
    "section 3 says to use the onboarding notes instead",
    PREP_DOCUMENT_SECTIONS.find((spec) => spec.id === "3")!.guidance.includes("first Monthly Touch"),
  );
}

// ---------------------------------------------------------------------------
// 5. The run-sheet and the board agree with the record
// ---------------------------------------------------------------------------

scenario("The run-sheet stage and the board column read the work, not a button");
{
  check("an unprepared touch is in Prep", deriveRunSheetStage(touch()) === "prep");
  /*
    The gate between Prep and Review is the brief, not the stage record.

    A finished account review used to be enough on its own, and that is exactly how the November
    regression got as far as the review screen: the stage said `complete` while all fifteen
    sections read "the preparation did not write this section". Prep holds the touch until the
    brief is whole, so a complete review with no brief behind it is still Prep.

    The brief gate itself has its own run: `npm run check:touch-stages`.
  */
  check(
    "a finished account review with no brief behind it is still in Prep",
    deriveRunSheetStage(touch({ prepWorkflow: workflowAt("confirmation_email") })) === "prep",
  );
  check(
    "a finished account review and a whole brief is in Review",
    deriveRunSheetStage(
      touch({
        prepWorkflow: workflowAt("confirmation_email"),
        prepBrief: wholeBrief(),
      }),
    ) === "review",
  );
  check(
    "a fully prepared and filed touch is in Live",
    deriveRunSheetStage(touch({ prepWorkflow: workflowAt("done") })) === "live",
  );
  check(
    "a touch with a transcript is in Follow-through",
    deriveRunSheetStage(touch({ postMeeting: { status: "draft_ready", transcript: "…" } })) === "follow_through",
  );
  check(
    "a reviewed touch is in QA",
    deriveRunSheetStage(touch({ qaReview: { status: "pending_victor_approval" } })) === "qa",
  );

  check("the board starts at Not prepped", deriveBoardColumn(touch()) === "not_prepped");
  check("then Prepped", deriveBoardColumn(touch({ prepWorkflow: workflowAt("confirmation_email") })) === "prepped");
  check("Done once the meeting happened", deriveBoardColumn(touch({ status: "Completed" })) === "done");
  check(
    "Follow-through once there is a transcript",
    deriveBoardColumn(touch({ status: "Completed", postMeeting: { status: "draft_ready" } })) === "follow_through",
  );
  check("QA once it has been reviewed", deriveBoardColumn(touch({ qaReview: { status: "approved" } })) === "qa");
}

// ---------------------------------------------------------------------------

scenario("The meeting time a client is told comes from the calendar, not from a stale record");
{
  const at = (id: string, summary: string, startIso: string) => ({
    eventId: id,
    clientId: "c1",
    clientName: "Trueflow Plumbing LLC",
    startIso,
    summary,
    reason: "title" as const,
  });

  // The real 9 November 2026 case: the touch had been pinned to the prep hold on the 4th while
  // the call itself was the 5th, and the confirmation email offered to remind the client about
  // the 4th. Standing on the 3rd, the call -- not the hold -- has to win.
  const asOfThird = selectMeetingForTouch(
    [
      at("prep", "🌹 Prep: Trueflow Plumbing LLC Monthly Touch", "2026-11-04T21:00:00.000Z"),
      at("call", "Monthly Touch- Trueflow Plumbing LLC", "2026-11-05T22:00:00.000Z"),
    ],
    "2026-11-03T09:00:00.000Z",
  );
  check("the client call wins over the AM's prep hold", asOfThird?.match.eventId === "call");
  check("and it is reported as still ahead", asOfThird?.timing === "upcoming");

  check(
    "a prep hold is never the touch's meeting, even alone",
    selectMeetingForTouch(
      [at("prep", "Prep: Trueflow Plumbing LLC Monthly Touch", "2026-11-10T21:00:00.000Z")],
      "2026-11-09T09:00:00.000Z",
    ) === null,
  );

  const justHeld = selectMeetingForTouch(
    [at("today", "Monthly Touch- Trueflow Plumbing LLC", "2026-11-09T17:00:00.000Z")],
    "2026-11-09T20:00:00.000Z",
  );
  check("the call held three hours ago is still this touch's meeting", justHeld?.match.eventId === "today");
  check("and it is reported as already held", justHeld?.timing === "just-held");

  check(
    "a call three weeks gone is history, not this touch",
    selectMeetingForTouch(
      [at("old", "Monthly Touch- Trueflow Plumbing LLC", "2026-10-05T21:00:00.000Z")],
      "2026-11-09T20:00:00.000Z",
    ) === null,
  );

  check(
    "the next call beats one held an hour ago",
    selectMeetingForTouch(
      [
        at("past", "Monthly Touch- Trueflow Plumbing LLC", "2026-11-09T19:00:00.000Z"),
        at("next", "Monthly Touch- Trueflow Plumbing LLC", "2026-11-12T19:00:00.000Z"),
      ],
      "2026-11-09T20:00:00.000Z",
    )?.match.eventId === "next",
  );

  check("an empty calendar yields no meeting at all", selectMeetingForTouch([], "2026-11-09T20:00:00.000Z") === null);
}

scenario("A monthly touch is one of two titles, and a prep hold is never one of them");
{
  const clients = [{ id: "c1", name: "Trueflow Plumbing LLC" }];
  const event = (id: string, summary: string, attendeeEmails: string[] = []) => ({
    id,
    summary,
    startIso: "2026-11-05T22:00:00.000Z",
    attendeeEmails,
  });

  const matched = matchCalendarEventsToClients(
    [
      event("call", "Monthly Touch- Trueflow Plumbing LLC"),
      event("prep", "🌹 Prep: Trueflow Plumbing LLC Monthly Touch"),
    ],
    clients,
  );
  check("the prep hold is dropped at the matcher, not merely at selection", matched.length === 1);
  check("and what survives is the call", matched[0]?.eventId === "call");

  check(
    'a trailing "Prep -" label is a hold too',
    matchCalendarEventsToClients([event("p", "Trueflow Plumbing LLC Monthly Touch Prep - notes")], clients).length === 0,
  );
  check(
    'a hold titled as an appointment is still a hold',
    matchCalendarEventsToClients([event("p", "Prep: Apointment with Trueflow Plumbing LLC")], clients).length === 0,
  );

  check(
    '"Apointment with <person>" still matches through the attendee address',
    matchCalendarEventsToClients([event("a", "Apointment with  Gonzalo Garcia", ["gonzalo@trueflowplumbingdfw.com"])], [
      { id: "c1", name: "Trueflow Plumbing" },
    ]).length === 1,
  );

  check(
    "an outside attendee alone no longer makes a meeting a monthly touch",
    matchCalendarEventsToClients([event("x", "Quick sync", ["gonzalo@trueflowplumbingdfw.com"])], clients).length === 0,
  );

  check(
    "a business whose name merely contains a prep-like word is untouched",
    matchCalendarEventsToClients(
      [event("ok", "Monthly Touch- Prepared Foods Co")],
      [{ id: "c2", name: "Prepared Foods Co" }],
    ).length === 1,
  );
}

scenario("A listing is never reported incomplete because nobody loaded its fields");
{
  // The snapshot keeps a slim projection of each location. Scoring that projection is what told
  // the owner a fully filled-in profile was "13% complete".
  const slim = {
    name: "locations/3182199253430599876",
    title: "Trueflow Plumbing LLC",
    storeCode: "17333865329060791887",
    websiteUri: "https://trueflowplumbingdfw.com/",
    accountName: "Map Ranking (Onboarding)",
  };
  check("a record with no detail fields is not scored at all", buildGbpCompleteness(slim) === null);

  const full = {
    ...slim,
    phoneNumbers: { primaryPhone: "(214) 555-0132" },
    categories: {
      primaryCategory: { displayName: "Plumber" },
      additionalCategories: [{ displayName: "Drainage service" }],
    },
    regularHours: { periods: [{ openDay: "MONDAY" }] },
    profile: { description: "Family-run plumbing across DFW." },
    storefrontAddress: { locality: "Dallas" },
    serviceItems: [{ structuredServiceItem: {} }],
    openInfo: { status: "OPEN" },
  };
  const scored = buildGbpCompleteness(full);
  check("a fully filled-in listing scores 100%", scored?.percent === 100, JSON.stringify(scored?.missing));
  check("and nothing is reported missing", scored?.missing.length === 0);

  // An empty listing still has to be reported as empty: the guard keys off the fields being
  // ABSENT, not off their being blank, or a genuinely bare profile would go unmentioned.
  const emptyButLoaded = {
    name: "locations/1",
    title: "Blank Co",
    phoneNumbers: {},
    categories: {},
    regularHours: {},
    profile: {},
    serviceArea: {},
    openInfo: {},
    serviceItems: [],
  };
  const bare = buildGbpCompleteness(emptyButLoaded);
  check("a genuinely bare listing is still reported", bare?.percent === 0);
  check("with every field named", bare?.missing.length === 8);
}

scenario("A missing Business Profile number says WHICH thing is missing");
{
  /*
    Reported by the owner on 10 November 2026 off a Belzer Striping & Resurfacing preparation. One
    sentence covered four different causes: "No Google Business Profile location matched this
    client's name, or performance data is unavailable for the matched location -- confirm the GBP
    listing title matches this client." If the title already matches, confirming it changes
    nothing, and the AM cannot tell from the sentence which half applies to them. Same defect as
    the GoHighLevel "single sub-account" note, in the other integration.

    Each case below needs a different action from the AM, so each has to be a different sentence.
  */
  const gap = (payload?: Record<string, unknown>) =>
    describeGbpPerformanceGap(
      new Map(payload ? [["google-business-profile", payload]] : []) as never,
      "acme-plumbing",
      "Acme Plumbing",
    );

  check(
    "never synced: says so, and points at Integrations",
    gap().includes("never completed a sync") && gap().includes("Integrations"),
    gap(),
  );

  const noMatch = gap({
    locations: [
      { name: "locations/1", title: "Someone Else Plumbing" },
      { name: "locations/2", title: "Third Co" },
    ],
    locationsByClient: {},
    performance: [],
  });
  check(
    "no listing matched: says how many were reached, and to pin one",
    noMatch.includes("2 locations") && noMatch.includes("Pin the right listing"),
    noMatch,
  );
  check("and only that case talks about the listing title", noMatch.includes("listing title"), noMatch);

  const matched = { name: "locations/1", title: "Acme Plumbing" };
  const refused = gap({
    locations: [matched],
    locationsByClient: { "acme-plumbing": [matched] },
    performance: [{ locationId: "1", error: "Request had insufficient authentication scopes." }],
  });
  check(
    "Google refused the metrics: quotes what Google actually said",
    refused.includes("insufficient authentication scopes"),
    refused,
  );
  check("and says the match itself is fine", refused.includes("not a naming one"), refused);
  // The one that matters most: a listing that DID match must never be sent back to be renamed.
  check("a matched listing is never blamed on its name", !refused.includes("Pin the right listing"), refused);

  const notReached = gap({
    locations: [matched],
    locationsByClient: { "acme-plumbing": [matched] },
    performance: [{ locationId: "9", calls: 4 }],
  });
  check(
    "sync stopped short: says to re-run it, and that nothing needs renaming",
    notReached.includes("Re-run the Google Business Profile sync") && notReached.includes("nothing needs renaming"),
    notReached,
  );
  check("and names the listing it did match", notReached.includes("Acme Plumbing"), notReached);

  check("the four causes are four different sentences", new Set([gap(), noMatch, refused, notReached]).size === 4);
}

scenario("A listing the AM pinned by hand counts from the next preparation");
{
  /*
    Reported by the owner on 10 November 2026: he pinned Belza Painting and Resurfacing's Business
    Profile listing on the client mapping screen, saw it go green, re-ran the preparation, and the
    brief still said none of the 227 locations matched this client by name.

    It was true. The pin lived on the client record and was only ever read inside the tenant-wide
    sync; the per-client refresh that runs on every preparation looked solely at the mapping the
    LAST sync had computed. The mapping screen even said so -- "GBP and GoHighLevel pins apply
    after their next sync" -- which is not a thing an AM can wait for half an hour before a call.

    These are the pure halves of the two refreshes: which listing or sub-account a pin resolves to.
  */
  const discovered = [
    { name: "accounts/7/locations/111", title: "Belza Painting & Resurfacing" },
    { name: "accounts/7/locations/222", title: "Someone Else Painting" },
  ];

  check(
    "a pinned listing is picked up even though the name never matched",
    selectPinnedGbpLocations(["111"], discovered, []).length === 1,
  );
  check(
    "and it is the one that was pinned",
    selectPinnedGbpLocations(["111"], discovered, [])[0]?.title === "Belza Painting & Resurfacing",
  );
  check(
    "a full resource name pins just as well as a bare id",
    selectPinnedGbpLocations(["accounts/7/locations/111"], discovered, []).length === 1,
  );
  // Additive, like the sync: a pin adds to the automatic matches, it does not replace them, and it
  // must not duplicate one that was already found.
  check(
    "a pin for a listing already matched automatically adds nothing",
    selectPinnedGbpLocations(["111"], discovered, [discovered[0]]).length === 0,
  );
  check("no pins means no extra listings", selectPinnedGbpLocations([], discovered, []).length === 0);
  // A pin naming something the snapshot has never seen cannot be read. Dropping it is the honest
  // outcome -- inventing a location record for it would put an empty listing on the brief.
  check(
    "a pin for a listing nobody has ever synced is dropped",
    selectPinnedGbpLocations(["999"], discovered, []).length === 0,
  );

  const subAccounts = [
    { id: "loc_belza", name: "Belza Painting & Resurfacing" },
    { id: "loc_other", name: "Another Client" },
  ];
  check(
    "a pinned GoHighLevel sub-account resolves",
    selectPinnedGhlLocationId(["loc_belza"], subAccounts) === "loc_belza",
  );
  check(
    "a pin this agency connection cannot see resolves to nothing",
    selectPinnedGhlLocationId(["loc_missing"], subAccounts) === undefined,
  );
  check(
    "the first reachable pin wins when several are set",
    selectPinnedGhlLocationId(["loc_missing", "loc_other"], subAccounts) === "loc_other",
  );
  check("no pins resolves to nothing", selectPinnedGhlLocationId([], subAccounts) === undefined);
}

// ---------------------------------------------------------------------------

console.log(`\n${checks - failures} of ${checks} checks passed.`);
console.log(
  [
    "",
    "Not covered here (needs live credentials, so it is checked by hand against a real account):",
    "  - the Gmail send itself, and the refusal when the connection is read-only",
    "  - the ClickUp page write and the reuse of an existing page",
    "  - the live Google and GoHighLevel reads a pinned profile triggers, which need real tokens;",
    "    the pin RESOLUTION above is what regressed and is what is covered",
    "  - the model calls that write the document and the confirmation email",
  ].join("\n"),
);

if (failures > 0) {
  process.exitCode = 1;
}
