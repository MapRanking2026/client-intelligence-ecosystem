/** Synthetic fixtures only: tests the application policy, not an actual client's performance. */
import assert from "node:assert/strict";
import JSZip from "jszip";
import { blockedTaskTitles, clientCallGuide, clientEvidence, clientPresentation, completedStatus, internalTaskText } from "@/src/lib/contracts/client-content";
import { completePrepBrief } from "@/src/lib/contracts/prep-brief-quality";
import { EMPTY_PREP_BRIEF } from "@/src/lib/contracts/prep-brief";
import { buildRecapEmailDraft } from "@/src/lib/contracts/follow-through-recap-email";
import { buildAgendaEmailDraft } from "@/src/lib/contracts/agenda-email";
import { visibleSlides, buildGuideParts } from "@/src/lib/contracts/live-call";
import { buildPptx } from "@/src/lib/server/services/pptx-builder";
import type { ClientRecord, MonthlyTouchPrepPack, MonthlyTouchRecord, Presentation } from "@/src/lib/mtos-data";
import type { NotesDraft } from "@/src/lib/contracts/follow-through-notes";

async function main() {
  const prep = {
    preparedAt: "2026-11-17T12:00:00Z", clientSummary: "Synthetic business context", schedule: { touchDate: "Nov 20, 2026" },
    keyFacts: ["Verified active service: local SEO"], integrationSources: [{ providerId: "test", label: "Synthetic test source", syncedAt: "2026-11-17", summary: "Fixture reporting window", bullets: [] }],
    openCommitments: [{ title: "Bi-weekly Google Ads report", owner: "Internal team", status: "Open", dueDate: "Nov 10", category: "Map Ranking" }],
    completedCommitments: [{ title: "Updated service categories", owner: "Team", status: "Completed", dueDate: "Nov 10", category: "Map Ranking" }],
    businessScorecard: { totalLeads: { label: "Leads", value: 12, previousValue: 20, availability: "available", source: "Synthetic source", period: "Fixture period" } },
    seoPerformance: { notes: ["Bi-weekly Google Ads report remains open"], gbpPerformance: [{ calls: 7, previousCalls: 11 }] },
    adsPerformance: [], activeOpportunities: [], issuesAndSolutions: [], leadQualityQuestions: ["How many leads became jobs?"], dataGaps: ["No verified revenue supplied"],
    clickupContext: { clientsBook: [{ pageName: "Private notes", content: "Private backlog instructions" }], recentChat: [{ text: "Do not expose this team message" }] },
  } as unknown as MonthlyTouchPrepPack;
  const touch = { id: "synthetic-touch", clientId: "synthetic-client", prepPack: prep, prepBrief: EMPTY_PREP_BRIEF,
    agenda: ["Account performance", "Review pending tasks"], wins: ["Updated service categories"], review: { declinedSections: [], sectionEdits: {}, coaching: {}, approvedAt: "2026-11-17" } } as unknown as MonthlyTouchRecord;
  const deck: Presentation = { status: "generated", title: "Synthetic account review", slides: [{ layout: "status_list", section: "OUR COMMITMENTS", title: "One item is still open on our side and we will give you a new date", items: [
    { label: "Bi-weekly Google Ads report", status: "OPEN", detail: "Originally due Aug 31 and still open" },
    { label: "Scan refresh", status: "PROPOSED", detail: "A fresh scan is proposed" },
    { label: "Updated service categories", status: "COMPLETED", detail: "Verified completed work" },
  ], presenterNotes: "Discuss pending tasks.\nExplain the completed categories." },
  { layout: "bullets", sectionId: "7", title: "Internal backlog", bullets: ["Private work items"] },
  { layout: "stat_callouts", title: "GBP performance", stats: [{ value: "7", caption: "Calls; previous period 11" }] }] };
  const sanitized = clientPresentation(deck, touch)!;
  assert.equal(sanitized.slides.length, 2);
  assert.equal(sanitized.slides[0].title, "Completed work");
  assert.deepEqual(sanitized.slides[0].items?.map((item) => item.label), ["Updated service categories"]);
  assert.equal(visibleSlides(deck.slides).length, 2, "legacy live/client screens apply the policy too");
  assert.equal(internalTaskText("We will cover account performance"), false, "ordinary meeting language is not a pending task");
  assert.equal(completedStatus("approved"), false); assert.equal(completedStatus("cancelled"), false);
  const unknown = clientPresentation({ ...deck, slides: [{ layout: "status_list", title: "Work", items: [{ label: "Unknown completion", status: "START ME" }] }] })!;
  assert.equal(unknown.slides.length, 0, "unknown and custom unfinished task statuses cannot become completed work");
  console.log("PASS screenshot scenario, completed-only status rows, legacy viewing filters and honest performance declines");

  const evidence = JSON.stringify(clientEvidence(touch));
  assert.ok(!evidence.includes("Bi-weekly Google Ads report"));
  assert.ok(!evidence.includes("Private backlog")); assert.ok(!evidence.includes("Do not expose"));
  assert.ok(evidence.includes("Updated service categories")); assert.ok(evidence.includes('"calls":7'));
  const guide = clientCallGuide({ status: "generated", sections: [
    { title: "Open items", sectionId: "7", minutes: 5, talkingPoints: ["Internal backlog"], clientPrompts: [] },
    { title: "Results", minutes: 10, talkingPoints: ["Bi-weekly Google Ads report", "Calls were 7 versus 11"], clientPrompts: ["Any questions?"] },
  ] }, touch)!;
  assert.equal(guide.sections.length, 1); assert.deepEqual(guide.sections[0].talkingPoints, ["Calls were 7 versus 11"]);
  assert.equal(buildGuideParts({ sections: guide.sections, plannedMinutes: 30 })[0].minutes, 30);
  assert.equal(buildGuideParts({ sections: guide.sections, plannedMinutes: 30 })[0].key, "part-2", "filtering preserves the saved capture-note key");
  assert.equal(sanitized.slides[1].generatedIndex, 2, "slides preserve original capture-note positions too");
  assert.ok(blockedTaskTitles(touch).includes("Bi-weekly Google Ads report"));
  console.log("PASS client generator evidence excludes raw backlog/chat; guides retain performance evidence");

  const client = { name: "Synthetic Client", summary: "Recorded context", industry: "Painting", goals: [], healthScore: null } as unknown as ClientRecord;
  const brief = completePrepBrief(undefined, prep, client);
  for (const id of ["h", ...Array.from({ length: 14 }, (_, i) => String(i + 1))]) assert.ok(brief.sections.some((section) => section.id === id && section.markdown.trim()), `section ${id} is populated`);
  assert.match(brief.sections.find((section) => section.id === "7")!.markdown, /INTERNAL ONLY/);
  assert.match(brief.sections.find((section) => section.id === "7")!.markdown, /Bi-weekly Google Ads report/);
  assert.match(brief.sections.find((section) => section.id === "10")!.markdown, /previous Value|previous value/i);
  assert.ok(!JSON.stringify(brief).includes("Belza")); assert.ok(!JSON.stringify(brief).includes("seasonal"));
  assert.equal(prep.openCommitments[0].status, "Open", "internal source records remain untouched");
  console.log("PASS full first-brief structure, detailed account evidence, explicit missing data and private backlog preservation");

  const notes = { title: "Synthetic notes", summary: "Calls were 7 versus 11 in the supplied fixture.", goalText: "", clientActions: [{ id: "a", what: "Pending client photos", due: "Nov 25" }], departments: [], pending: [] } as unknown as NotesDraft;
  const email = buildRecapEmailDraft({ businessName: "Synthetic Client", contactName: "Test", metLabel: "Nov 17", nextCheckInLabel: "", nextCheckInUrl: "", accountManagerName: "AM", signoff: "Regards, AM", wins: [{ what: "Updated service categories", shipped: "" }] }, notes,
    [{ id: "new-ticket", formType: "ticket", taskName: "Investigate pending task", description: "Unfinished", dueDate: "2026-11-25", decision: "approved" }]);
  assert.ok(!email.html.includes("Investigate pending task")); assert.ok(!email.html.includes("Pending client photos")); assert.ok(email.html.includes("Updated service categories"));
  const agenda = buildAgendaEmailDraft({ channel: "email", whiteLabel: false, subject: "Monthly review", items: ["Performance results", "Review pending tasks"], ask: "Chase overdue ticket", length: "30 minutes", link: "", signoff: "AM", blockingGaps: [] }, { businessName: "Synthetic Client", timeZone: "America/Los_Angeles", timeZoneIsClients: false, accountManagerName: "AM", signoff: "Regards, AM" });
  assert.ok(!agenda.html.includes("pending tasks")); assert.ok(!agenda.html.includes("overdue ticket"));
  console.log("PASS client recap/agenda exclude unfinished approved tickets and client-side asks");

  const bytes = await buildPptx(deck, null);
  const zip = await JSZip.loadAsync(bytes);
  const xml = (await Promise.all(Object.values(zip.files).filter((entry) => entry.name.endsWith(".xml")).map((entry) => entry.async("string")))).join("\n");
  assert.ok(!xml.includes("Bi-weekly Google Ads report")); assert.ok(!xml.includes("Scan refresh")); assert.ok(!xml.includes("pending tasks")); assert.ok(xml.includes("Updated service categories"));
  console.log("PASS actual PowerPoint export and embedded presenter notes omit unfinished task details");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
