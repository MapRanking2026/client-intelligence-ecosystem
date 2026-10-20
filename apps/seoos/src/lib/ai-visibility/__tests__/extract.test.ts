import { test } from "node:test";
import assert from "node:assert/strict";

import { extractAnswer, safeExtract } from "../extract";
import * as F from "../__fixtures__/answers";

const client = (a: ReturnType<typeof extractAnswer>) => a.entities.find((e) => e.entityKey === "client")!;
const comp = (a: ReturnType<typeof extractAnswer>, k: string) => a.entities.find((e) => e.entityKey === k)!;

test("ordered list: positions come from the list, client recommended at #2", () => {
  const a = extractAnswer(F.ORDERED_LIST, [], F.SUBJECT);
  assert.equal(a.orderedList, true);
  assert.equal(a.orderedListLength, 3);
  assert.equal(client(a).mentioned, true);
  assert.equal(client(a).recommended, true);
  assert.equal(client(a).position, 2);
  assert.equal(comp(a, "comp_1").position, 1);
  const disc = a.entities.find((e) => e.kind === "discovered");
  assert.ok(disc, "discovered business");
  assert.equal(disc!.position, 3);
  assert.match(disc!.name, /Tidy Nest/);
  assert.equal(a.answerClass, "recommendations_present");
});

test("markdown heading list is treated as ordered", () => {
  const a = extractAnswer(F.HEADING_LIST, [], F.SUBJECT);
  assert.equal(a.orderedList, true);
  assert.equal(client(a).position, 2);
});

test("prose alias mention: mentioned + recommended, no ordered position", () => {
  const a = extractAnswer(F.PROSE, [], F.SUBJECT);
  assert.equal(a.orderedList, false);
  assert.equal(client(a).mentioned, true);
  assert.deepEqual(client(a).matchedBy, ["alias"]);
  assert.equal(client(a).recommended, true);
  assert.equal(client(a).position, null);
  assert.equal(client(a).spans[0].text, "Sparkle Pro");
});

test("similarly named business in another state is not counted", () => {
  const a = extractAnswer(F.OTHER_CITY, [], F.SUBJECT);
  assert.equal(client(a).mentioned, false);
  assert.ok(client(a).locationConflict);
  assert.ok(client(a).confidence < 0.5);
  assert.equal(comp(a, "comp_1").mentioned, true);
});

test("no substring matches", () => {
  const a = extractAnswer(F.SUBSTRING_TRAP, [], F.SUBJECT);
  assert.equal(client(a).mentioned, false);
  assert.equal(comp(a, "comp_2").mentioned, false, "Aces/Grace must not match Ace Cleaning Co");
});

test("negative mention is mentioned but not recommended", () => {
  const a = extractAnswer(F.NEGATIVE, [], F.SUBJECT);
  assert.equal(client(a).mentioned, true);
  assert.equal(client(a).sentiment, "negative");
  assert.equal(client(a).recommended, false);
  assert.equal(comp(a, "comp_1").sentiment, "positive");
  assert.equal(comp(a, "comp_1").recommended, true);
});

test("bulleted list: listed = recommended, never a position", () => {
  const a = extractAnswer(F.BULLETS, [], F.SUBJECT);
  assert.equal(a.orderedList, false);
  assert.equal(client(a).recommended, true);
  assert.equal(client(a).position, null);
  assert.equal(comp(a, "comp_2").mentioned, true, "alias Ace Cleaners");
});

test("ordered steps are not a recommendation list", () => {
  const a = extractAnswer(F.STEPS_LIST, [], F.SUBJECT);
  assert.equal(a.orderedList, false);
  assert.equal(client(a).mentioned, true);
  assert.equal(client(a).position, null);
  assert.equal(client(a).recommended, false, "neutral prose mention is not a recommendation");
});

test("refusal classification", () => {
  const a = extractAnswer(F.REFUSAL, [], F.SUBJECT);
  assert.equal(a.answerClass, "refusal");
});

test("domain mention + owned domain citation; duplicates deduplicated upstream", () => {
  const cits = [
    F.cite("https://www.sparkleprocleaning.com/move-out", 1),
    F.cite("https://www.yelp.com/biz/sparkle-pro-cleaning", 2, { title: "Sparkle Pro Cleaning - Yelp" }),
  ];
  const a = extractAnswer(F.DOMAIN_ONLY, cits, F.SUBJECT);
  assert.equal(client(a).mentioned, true);
  assert.deepEqual(client(a).matchedBy, ["domain"]);
  assert.equal(client(a).ownedDomainCited, true);
  assert.deepEqual(client(a).thirdPartyCitationUrls, ["https://yelp.com/biz/sparkle-pro-cleaning"]);
});

test("each entity is counted once per answer even with repeated mentions", () => {
  const text = "Sparkle Pro Cleaning is reliable. Sparkle Pro Cleaning also does move-outs. Sparkle Pro is popular.";
  const a = extractAnswer(text, [], F.SUBJECT);
  assert.equal(a.entities.filter((e) => e.entityKey === "client").length, 1);
  assert.equal(client(a).spans.length, 3);
});

test("malformed provider output yields a recorded analysis failure", () => {
  const a = safeExtract({ not: "text" }, [], F.SUBJECT);
  assert.equal(a.status, "failed");
  assert.match(a.error!, /not a string/);
});

test("live-format regression: bold leads with colons, unordered sections, spacing variants", () => {
  // Shape observed in real Anthropic answers (2026-10-19), names/phones trimmed.
  const text = `No single source ranks La Vergne cleaners, so verify before booking.

**Companies that advertise move-out cleaning**

- **Molly Maid:** A national chain offering move-out cleaning.
- **Hello Cleaners:** Lists deep cleans from $200.
- **Sparkle Pro Cleaning:** Describes a detailed checklist.

**Independent providers with good reviews**

- **Hellocleaners:** Move-out cleaning from $190.
- **Music City Maids:** 4.9 rating on Angi.`;
  const a = extractAnswer(text, [], F.SUBJECT);
  assert.equal(a.orderedList, false);
  const c = a.entities.find((e) => e.entityKey === "client")!;
  assert.equal(c.mentioned, true);
  assert.equal(c.recommended, true);
  assert.equal(c.position, null);
  const disc = a.entities.filter((e) => e.kind === "discovered");
  assert.deepEqual(disc.map((d) => d.name).sort(), ["Hello Cleaners", "Molly Maid"]);
  assert.ok(!a.entities.some((e) => e.name.endsWith(":")));
});
