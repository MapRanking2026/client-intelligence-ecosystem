/** Checks the user-approved letter outline using synthetic account facts only. */
import assert from "node:assert/strict";
import { buildRecapEmailDraft, sanitizeRecapEmailHtml, type RecapEmailSource } from "@/src/lib/contracts/follow-through-recap-email";
import type { NotesDraft } from "@/src/lib/contracts/follow-through-notes";
const notes = { summary: "We reviewed visibility.", goalText: "", clientActions: [], departments: [], pending: [] } as unknown as NotesDraft;
const source: RecapEmailSource = {
  businessName: "Synthetic Plumbing", contactName: "Jay", metLabel: "Wed 18 November", nextCheckInLabel: "Friday, December 18, 2026", nextCheckInUrl: "https://calendar.google.com/event?eid=synthetic", accountManagerName: "Synthetic AM", signoff: "Best regards,\nSynthetic AM\nMap Ranking",
  overview: "A short synopsis.",
  narrative: ["We will prioritize **North** while maintaining the other locations.", "We discussed importing completed jobs into **Map Check-Ins** once the integration is connected."],
  locationTargets: [{ location: "North", competitor: "Synthetic Competitor A" }, { location: "South", competitor: "Synthetic Competitor B" }],
  promisedInclusions: [{ text: "What is your quarterly booked-jobs target?", requiresReply: true }],
  meetingCommitments: [{ what: "Import completed jobs after access is provided", due: "" }],
  meetingRequests: [{ what: "Reply with your business-goal answers by Friday", due: "by Friday" }, { what: "Share Client ID, Client Secret and App Key securely. Use the [ServiceTitan Developer Portal](https://developer.servicetitan.io/).", due: "" }],
  highlights: [{ title: "Do not duplicate", detail: "Extra metric dump" }], next30Days: [{ what: "Do not repeat all priorities", due: "" }],
};
const draft = buildRecapEmailDraft(source, notes, []), html = draft.html;
assert.equal(draft.subject, "Monthly Touch Recap & Next Steps | Synthetic Plumbing");
const order = ["Hello Jay,", "Thank you again", "Synthetic Competitor A", "We will prioritize", "Business Goals &amp; Growth Targets", "What is your quarterly booked-jobs target?", "Quick Recap", "What to Expect From Us:", "What We Need From You:", "Our next Monthly Touch is scheduled", "Please reply with your answers", "Synthetic AM"];
let prior=-1;for(const part of order){const index=html.indexOf(part);assert.ok(index>prior,part);prior=index;}
assert.ok(html.includes('<strong>North:</strong>'));assert.ok(html.includes('<strong>Map Check-Ins</strong>'));assert.ok(html.includes('list-style-type:decimal'));assert.ok(html.includes('list-style-type:disc'));assert.ok(html.includes('href="https://developer.servicetitan.io/"'));assert.ok(html.includes('Client Secret'));assert.ok(!html.includes('— <strong>by Friday</strong>'));assert.ok(!html.includes('Extra metric dump'));assert.ok(!html.includes('Do not repeat all priorities'));assert.ok(!html.includes('Where things stand'));assert.ok(!html.includes('Before you go'));assert.ok(html.includes('include them in the same reply'));
const clean=sanitizeRecapEmailHtml(html);assert.ok(clean.includes('<strong>North:</strong>'));assert.ok(clean.includes('list-style-type:decimal'));
const other=buildRecapEmailDraft({...source,businessName:'Other Synthetic Client',contactName:'Mara',narrative:[],locationTargets:[],meetingCommitments:[],meetingRequests:[],promisedInclusions:[],next30Days:[],highlights:[]},notes,[]);
assert.ok(other.html.includes('Hello Mara,'));assert.ok(!other.html.includes('Synthetic Competitor A'));assert.ok(!other.html.includes('What to Expect From Us:'));assert.ok(!other.html.includes('Business Goals &amp; Growth Targets'));assert.ok(!other.html.includes('Jay'));
console.log('PASS letter structure, account-specific content, exact ordered questions, two-sided bullets, deadlines without duplication, editable semantic formatting, links, no report/card repetition and sanitizer preservation');
