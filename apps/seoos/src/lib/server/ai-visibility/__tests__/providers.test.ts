/** Provider response parsing against documented response shapes (FIXTURES, no network). */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseAnthropicContent } from "../providers/anthropic";
import { parseGeminiSteps } from "../providers/gemini";
import { parseOpenAIOutput } from "../providers/openai";
import { httpError, redact } from "../providers/types";

test("anthropic: final answer excludes pre-search narration; citations deduped with spans", () => {
  const content = [
    { type: "text", text: "I'll search for cleaners." },
    { type: "server_tool_use", id: "srv1", name: "web_search", input: { query: "deep cleaning La Vergne TN" } },
    { type: "web_search_tool_result", tool_use_id: "srv1", content: [{ type: "web_search_result", url: "https://www.yelp.com/x", title: "Yelp", encrypted_content: "abc", page_age: "2026" }] },
    { type: "text", text: "Here are options: " },
    { type: "text", text: "Sparkle Pro Cleaning is well reviewed.", citations: [{ type: "web_search_result_location", url: "https://www.yelp.com/x", title: "Yelp", cited_text: "Sparkle Pro…" }] },
    { type: "text", text: " Also see Yelp.", citations: [{ type: "web_search_result_location", url: "https://yelp.com/x/", title: "Yelp", cited_text: "dup" }] },
  ];
  const r = parseAnthropicContent(content);
  assert.equal(r.answer.startsWith("Here are options"), true);
  assert.deepEqual(r.queries, ["deep cleaning La Vergne TN"]);
  assert.equal(r.searchOk, 1);
  assert.equal(r.citations.length, 1, "www/trailing-slash duplicates merged");
  assert.equal(r.citations[0].answerSpans.length, 2);
  assert.equal(r.answer.slice(r.citations[0].answerSpans[0].start, r.citations[0].answerSpans[0].end), "Sparkle Pro Cleaning is well reviewed.");
});

test("anthropic: search error object is recorded, not treated as results", () => {
  const r = parseAnthropicContent([
    { type: "server_tool_use", name: "web_search", input: { query: "q" } },
    { type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "unavailable" } },
    { type: "text", text: "From memory: …" },
  ]);
  assert.equal(r.searchOk, 0);
  assert.deepEqual(r.searchErrors, ["unavailable"]);
});

test("openai: message annotations map to answer spans; search calls counted", () => {
  const r = parseOpenAIOutput([
    { type: "web_search_call", status: "completed", action: { type: "search", query: "deep cleaning la vergne", sources: [{ url: "https://a.com" }] } },
    { type: "web_search_call", status: "completed", action: { type: "open_page" } },
    {
      type: "message",
      content: [{ type: "output_text", text: "1. Music City Maids\n2. Sparkle Pro", annotations: [{ type: "url_citation", url: "https://a.com/p?utm_source=x", title: "A", start_index: 3, end_index: 19 }] }],
    },
  ]);
  assert.equal(r.searchCalls, 1, "open_page is not a billed search");
  assert.equal(r.citations[0].normalizedUrl, "https://a.com/p");
  assert.equal(r.answer.slice(r.citations[0].answerSpans[0].start, r.citations[0].answerSpans[0].end), "Music City Maids");
  assert.deepEqual(r.sources, [{ url: "https://a.com" }]);
});

test("gemini: model_output annotations + google_search_call queries", () => {
  const r = parseGeminiSteps([
    { type: "thought" },
    { type: "google_search_call", arguments: { queries: ["deep cleaning la vergne tn"] } },
    { type: "google_search_result", is_error: false },
    { type: "model_output", content: [{ type: "text", text: "Sparkle Pro Cleaning serves La Vergne.", annotations: [{ type: "url_citation", url: "https://b.com", title: "b.com", start_index: 0, end_index: 20 }] }] },
  ]);
  assert.equal(r.calls, 1);
  assert.deepEqual(r.queries, ["deep cleaning la vergne tn"]);
  assert.equal(r.answer.slice(0, 20), "Sparkle Pro Cleaning");
  assert.equal(r.citations[0].answerSpans[0].end, 20);
});

test("http error classification", () => {
  const h = new Headers({ "retry-after": "7" });
  assert.equal(httpError("X", 429, "rate_limit_error", h).errorClass, "rate_limited");
  assert.equal(httpError("X", 429, "rate_limit_error", h).extra.retryAfterMs, 7000);
  assert.equal(httpError("X", 429, "rate_limit_error", h).retryable, true);
  const billing = httpError("X", 400, '{"message":"Your credit balance is too low to access the Anthropic API."}', new Headers());
  assert.equal(billing.errorClass, "auth_error");
  assert.equal(billing.retryable, false);
  assert.equal(httpError("X", 429, "You exceeded your current quota", new Headers()).errorClass, "auth_error");
  assert.equal(httpError("X", 529, "overloaded", new Headers()).retryable, true);
  assert.equal(httpError("X", 401, "invalid x-api-key", new Headers()).errorClass, "auth_error");
});

test("secrets are redacted from error text", () => {
  const s = redact("bad key sk-ant-api03-ABCDEFGHIJKLMNOP and AIzaSyA1234567890123456789012 and https://x?key=SECRET123");
  assert.ok(!s.includes("ABCDEFGHIJ"));
  assert.ok(!s.includes("AIzaSyA123"));
  assert.ok(!s.includes("SECRET123"));
});
