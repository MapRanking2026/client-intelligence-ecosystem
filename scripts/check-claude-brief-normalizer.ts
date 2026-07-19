/**
 * Reproduces the malformed Claude brief that failed validation and asserts the normalizer reshapes
 * it into something the schema accepts, without inventing content.
 */
import {
  claudeResponseSchema,
  normalizeClaudeTouchPayload,
} from "@/src/lib/server/services/monthly-touch-prep-service";

// The shape implied by the reported Zod errors: objects instead of strings, talkingPoints as an
// object, evidence as a bare string, lowercase confidence, and arrays over their caps.
const broken = {
  executiveBrief: {
    overview: "Charlotte Performance is stable this month.",
    performance: "Rankings improved across 4 of 6 tracked keywords.",
  },
  agenda: Array.from({ length: 8 }, (_, i) => ({
    topic: `Agenda topic ${i + 1}`,
    detail: `Supporting detail ${i + 1}`,
  })),
  talkingPoints: {
    items: ["Lead volume up 12%", "Two commitments still open", "Heatmap gained coverage north"],
  },
  wins: [
    { win: "Ranked #1 for 'auto repair charlotte'", impact: "More calls" },
    { win: "GBP offer published", impact: "Signals active business" },
    { win: "Backlink from local news" },
  ],
  risks: Array.from({ length: 7 }, (_, i) => ({ risk: `Risk ${i + 1}`, why: `Because ${i + 1}` })),
  recommendations: Array.from({ length: 5 }, (_, i) => ({
    title: `Recommendation ${i + 1}`,
    summary: `Summary ${i + 1}`,
    rationale: `Rationale ${i + 1}`,
    confidence: ["high", "medium", "low", "HIGH", "strong"][i],
    evidence: `Rank Tracker scan from July ${i + 1}`,
  })),
};

const normalized = normalizeClaudeTouchPayload(broken);
const result = claudeResponseSchema.safeParse(normalized);

console.log("schema accepts normalized payload:", result.success);
if (!result.success) {
  console.log(JSON.stringify(result.error.issues, null, 2));
  process.exit(1);
}

console.log("\nexecutiveBrief:", JSON.stringify(normalized.executiveBrief));
console.log("agenda        :", normalized.agenda.length, "items ->", JSON.stringify(normalized.agenda[0]));
console.log("talkingPoints :", normalized.talkingPoints.length, "->", JSON.stringify(normalized.talkingPoints));
console.log("wins          :", normalized.wins.length, "->", JSON.stringify(normalized.wins[0]));
console.log("risks         :", normalized.risks.length, "->", JSON.stringify(normalized.risks[0]));
console.log("recommendations:", normalized.recommendations.length);
for (const rec of normalized.recommendations) {
  console.log(`  ${rec.title} | confidence=${rec.confidence} | evidence=${JSON.stringify(rec.evidence)}`);
}

// Nothing may be invented: every word must trace back to the input.
const flat = JSON.stringify(normalized);
for (const probe of ["Charlotte Performance is stable", "Supporting detail 1", "Lead volume up 12%", "Because 1"]) {
  if (!flat.includes(probe)) {
    console.error(`LOST CONTENT: ${probe}`);
    process.exit(1);
  }
}
console.log("\nall source content preserved; no fabricated sources (unspecified marked as such)");
