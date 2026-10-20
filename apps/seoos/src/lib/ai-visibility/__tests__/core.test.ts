import { test } from "node:test";
import assert from "node:assert/strict";

import { estimateObservation, costFromUsage, PRICING } from "../cost";
import { filterObservations, observationsCsv, parseViewFilter } from "../filters";
import { computeMetrics, computeTrend, wilson } from "../metrics";
import { checkPrompt, generatePromptDrafts } from "../prompts";
import { buildRecommendations } from "../recommendations";
import { extractAnswer } from "../extract";
import { AivObservationV1, AivProfileV1 } from "../types";
import { backoffMs, csvCell } from "../util";
import { suggestFromHtml } from "../website-suggest";
import * as F from "../__fixtures__/answers";

const now = "2026-10-19T12:00:00.000Z";
const profile = AivProfileV1.parse({
  schemaVersion: 1,
  tenantId: "t",
  projectId: "p",
  clientId: "c",
  status: "active",
  businessName: "Sparkle Pro Cleaning LLC",
  aliases: [{ id: "a", value: "Sparkle Pro" }],
  ownedDomains: [{ id: "d", value: "sparkleprocleaning.com" }],
  services: [{ id: "s1", value: "Deep Cleaning" }, { id: "s2", value: "Move-Out Cleaning" }, { id: "s3", value: "HVAC repair", status: "suggested" }],
  locations: [{ id: "l1", city: "La Vergne", region: "TN" }],
  competitors: [{ id: "comp_1", name: "Music City Maids" }],
  createdAt: now,
  updatedAt: now,
});

function obs(id: string, answer: string, extra: Partial<AivObservationV1> = {}): AivObservationV1 {
  const base = AivObservationV1.parse({
    schemaVersion: 1, id, tenantId: "t", projectId: "p", clientId: "c", scanId: "scan1", channel: "official_api", providerId: "anthropic",
    surface: "x", model: "m", promptGroup: "unbranded_discovery", branded: false, submittedText: "q", language: "en", serviceId: "s1",
    locationId: "l1", locationMode: "explicit_in_text", collectedAt: now, searchExecuted: true, collectionStatus: "success",
    answerText: answer, createdAt: now, updatedAt: now, ...extra,
  });
  return base.collectionStatus === "success" ? { ...base, analysis: extractAnswer(answer, base.citations, F.SUBJECT) } : base;
}

test("prompt generation uses only approved services; unbranded never names client or competitors", () => {
  const drafts = generatePromptDrafts(profile, { groups: ["unbranded_discovery", "branded"], includeNearMe: true });
  assert.ok(drafts.length > 0);
  assert.ok(!drafts.some((d) => /hvac/i.test(d.text)), "suggested service excluded");
  for (const d of drafts.filter((x) => x.group !== "branded")) {
    assert.ok(!/sparkle|music city/i.test(d.text), d.text);
    assert.ok(checkPrompt(d.text, d.group, profile).ok, d.text);
  }
  assert.ok(drafts.some((d) => d.group === "branded" && /Sparkle Pro Cleaning LLC/.test(d.text)));
  assert.ok(drafts.some((d) => d.nearMe && /near me/.test(d.text)));
  assert.ok(drafts.some((d) => d.text.includes("move-out cleaning")));
});

test("checkPrompt rejects client names, domains, competitors, steering hints and URLs", () => {
  assert.equal(checkPrompt("Is Sparkle Pro good for deep cleaning in La Vergne?", "unbranded_discovery", profile).ok, false);
  assert.equal(checkPrompt("Who is better than sparkleprocleaning.com?", "comparison", profile).ok, false);
  assert.equal(checkPrompt("Compare Music City Maids with others in La Vergne", "comparison", profile).ok, false);
  assert.equal(checkPrompt("Best cleaners in La Vergne, such as my company?", "unbranded_discovery", profile).ok, false);
  assert.equal(checkPrompt("Best cleaners https://x.com", "unbranded_discovery", profile).ok, false);
  assert.equal(checkPrompt("Who offers reliable deep cleaning in La Vergne, TN?", "unbranded_discovery", profile).ok, true);
  assert.equal(checkPrompt("Who offers deep cleaning?", "branded", profile).ok, false, "branded must name client");
});

test("metrics: failures and refusals are excluded, valid non-mentions count as zero", () => {
  const rows = [
    obs("o1", F.ORDERED_LIST),
    obs("o2", F.PROSE),
    obs("o3", "Music City Maids is a reliable choice in La Vergne."),
    obs("o4", "", { collectionStatus: "timeout" }),
    obs("o5", F.REFUSAL),
    obs("o6", F.BULLETS, { branded: true }),
    obs("o7", F.ORDERED_LIST, { isFixture: true }),
    obs("o8", F.ORDERED_LIST, { channel: "manual" }),
  ];
  const m = computeMetrics(rows, { channel: "official_api", branded: false });
  assert.equal(m.sample.total, 5, "branded, manual and fixture rows are separate");
  assert.equal(m.sample.valid, 3);
  assert.equal(m.sample.not_collected, 1);
  assert.equal(m.sample.refusal, 1);
  assert.deepEqual([m.mentionRate.num, m.mentionRate.den], [2, 3]);
  assert.deepEqual([m.recommendationRate.num, m.recommendationRate.den], [2, 3]);
  assert.deepEqual([m.top3.num, m.top3.den], [1, 1], "top-3 denominator = ordered-list answers only");
  assert.deepEqual(m.positionDistribution.map((p) => [p.position, p.count]), [[2, 1]]);
  const client = m.shareOfMentions.find((s) => s.entityKey === "client")!;
  const comp = m.shareOfMentions.find((s) => s.entityKey === "comp_1")!;
  assert.equal(client.answers, 2);
  assert.equal(comp.answers, 2);
  const total = m.shareOfMentions.reduce((s, r) => s + r.answers, 0);
  assert.equal(total, 5, "client 2 + competitor 2 + discovered 1");
  assert.ok(Math.abs(client.share - 2 / 5) < 1e-9);
  assert.deepEqual([m.collectionSuccessRate.num, m.collectionSuccessRate.den], [4, 5]);
  assert.ok(m.smallSample);
  const ci = m.mentionRate.ci!;
  assert.ok(ci[0] < 2 / 3 && ci[1] > 2 / 3);
});

test("collected-but-unanalyzed answers are excluded and counted", () => {
  const o = { ...obs("o9", F.PROSE), analysis: { ...obs("x", F.PROSE).analysis!, status: "failed" as const, error: "boom" } };
  const m = computeMetrics([o], { channel: "official_api", branded: false });
  assert.equal(m.sample.not_analyzed, 1);
  assert.equal(m.mentionRate.value, null);
  assert.deepEqual([m.analysisCoverage.num, m.analysisCoverage.den], [0, 1]);
});

test("manual corrections override effective findings", () => {
  const o = { ...obs("o10", F.OTHER_CITY), overrides: [{ entityKey: "client", mentioned: true, recommended: true }] };
  const m = computeMetrics([o], { channel: "official_api", branded: false });
  assert.equal(m.mentionRate.num, 1);
});

test("trend flags configuration changes", () => {
  const a = obs("t1", F.ORDERED_LIST, { scanId: "s_a" });
  const b = obs("t2", F.PROSE, { scanId: "s_b" });
  const c = obs("t3", F.PROSE, { scanId: "s_c" });
  const t = computeTrend([a, b, c], { channel: "official_api", branded: false }, [
    { id: "s_a", createdAt: "2026-10-01", configFingerprint: "f1", providerModels: ["anthropic:m"] },
    { id: "s_b", createdAt: "2026-10-08", configFingerprint: "f1", providerModels: ["anthropic:m"] },
    { id: "s_c", createdAt: "2026-10-15", configFingerprint: "f2", providerModels: ["anthropic:m2"] },
  ]);
  assert.deepEqual(t.map((p) => p.comparableToPrevious), [null, true, false]);
  assert.match(t[2].changeNote!, /Model\/provider changed/);
});

test("export rows match dashboard filter + drill-down", () => {
  const rows = [obs("e1", F.ORDERED_LIST), obs("e2", "Music City Maids is reliable."), obs("e3", F.PROSE, { branded: true })];
  const f = parseViewFilter(new URLSearchParams("flag=mentioned"));
  const filtered = filterObservations(rows, f);
  assert.deepEqual(filtered.map((o) => o.id), ["e1"]);
  const m = computeMetrics(rows, { channel: "official_api", branded: false });
  assert.equal(filtered.length, m.mentionRate.num, "drill-down count equals metric numerator");
  const csv = observationsCsv(filtered, profile);
  assert.equal(csv.split("\r\n").length, 2);
  assert.match(csv, /^observation_id,/);
});

test("CSV cells neutralize formula injection", () => {
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
});

test("wilson interval + backoff jitter bounds", () => {
  assert.equal(wilson(0, 0), null);
  const [lo, hi] = wilson(5, 10)!;
  assert.ok(lo > 0.2 && hi < 0.8);
  for (let i = 1; i < 6; i += 1) {
    const ms = backoffMs(i, { baseMs: 1000, capMs: 8000, random: () => 0.999 });
    assert.ok(ms <= 8000 && ms >= 250);
  }
  assert.equal(backoffMs(1, { retryAfterMs: 5000, random: () => 0 }), 5000);
});

test("cost: calculated from usage; estimate upper bound ≥ expected", () => {
  const p = PRICING["anthropic:claude-sonnet-5-5"];
  assert.equal(costFromUsage(p, { inputTokens: 1_000_000, outputTokens: 0, searchRequests: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }), 2);
  assert.equal(costFromUsage(p, { inputTokens: 0, outputTokens: 0, searchRequests: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }), 1);
  const e = estimateObservation(p, 3, 1500);
  assert.ok(e.upperBoundUsd >= e.expectedUsd);
});

test("website suggestions are suggestions with evidence; nothing invented", () => {
  const html = `<html><head><title>Deep Cleaning | Sparkle Pro Cleaning</title>
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"HouseCleaningService LocalBusiness","name":"Sparkle Pro Cleaning LLC","areaServed":["La Vergne, TN",{"@type":"City","name":"Smyrna, TN"}],"address":{"addressLocality":"La Vergne","addressRegion":"TN"}}</script>
  </head><body><nav><a href="/">Home</a><a href="/move-out">Move-Out Cleaning</a><a href="/contact">Contact</a></nav><h2>Deep Cleaning in La Vergne</h2><p>Proudly serving Murfreesboro, TN and nearby.</p><script>evil()</script></body></html>`;
  const s = suggestFromHtml(html, "https://sparkleprocleaning.com/");
  assert.ok(s.names.some((n) => n.value === "Sparkle Pro Cleaning LLC"));
  assert.ok(s.services.some((x) => x.value === "Move-Out Cleaning"));
  assert.ok(s.services.some((x) => x.value === "Deep Cleaning"));
  assert.ok(!s.services.some((x) => /home|contact/i.test(x.value)));
  const cities = s.locations.map((l) => `${l.city}|${l.region}`);
  assert.ok(cities.includes("La Vergne|TN"));
  assert.ok(cities.includes("Smyrna|TN"));
  assert.ok(cities.includes("Murfreesboro|TN"));
  assert.equal(s.phone, undefined, "no phone invented");
  assert.equal(s.address, undefined, "partial address not promoted to full address");
});

test("recommendations separate observed gap from hypothesis and cite evidence", () => {
  const rows = [1, 2, 3, 4, 5, 6].map((i) =>
    obs(`r${i}`, "1. **Music City Maids** - top rated\n2. **Tidy Nest Cleaning Services** - reliable", {
      citations: [{ url: "https://www.yelp.com/search?x=1", normalizedUrl: "https://yelp.com/search?x=1", domain: "yelp.com", order: 1, answerSpans: [] }],
    }),
  );
  const recs = buildRecommendations(rows, profile);
  const gap = recs.find((r) => r.rule === "service_location_gap")!;
  assert.ok(gap);
  assert.equal(gap.priority, "high");
  assert.equal(gap.evidenceObsIds.length, 6);
  assert.equal(gap.actionIsHypothesis, true);
  const dir = recs.find((r) => r.rule === "cited_third_party_source")!;
  assert.match(dir.title, /yelp\.com/);
  assert.ok(dir.limitations.some((l) => /does not guarantee/.test(l)));
});
