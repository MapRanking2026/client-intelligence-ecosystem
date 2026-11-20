/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic touch and model responses; nothing is written and no client is contacted. */
/**
 * "Read the call" always comes back with something to score.
 *
 * The button existed to hand the AM a number and a sentence to argue with, and every path that
 * could not produce one returned findings alone -- so the screen looked identical before and
 * after pressing it, which reads as a button that does nothing. There are four such paths and
 * only one of them is the happy one.
 *
 * The suggestion a flag produces is not a guess: each red flag already carries the ceiling it puts
 * on the score, so the lowest ceiling is the defensible opening bid, and a call with no flags
 * opens at 9. It is still a draft the AM confirms, overrides or clears.
 *
 * Run with: npm run check:score-suggestion
 */
require('tsx/cjs');
const assert = require('node:assert/strict');
const Module = require('node:module');
const original = Module._load;

let model, transcript, touch;

const mocks = {
  '@/src/lib/server/data/seed-mtos-data-source': {
    getMtosDataSource: () => ({
      getMonthlyTouchById: async () => touch,
      getClientById: async () => ({ id: 'client', name: 'Synthetic Plumbing' }),
    }),
  },
  '@/src/lib/server/env': { getServerEnv: () => ({}) },
  '@/src/lib/server/prompt-store': { getPromptText: async () => 'synthetic prompt' },
  '@/src/lib/server/prompt-model-route': { getModelRouteForPrompt: async () => undefined },
  '@/src/lib/server/services/transcript-watch-service': { readTouchTranscriptPayload: async () => transcript },
};

Module._load = function (request, parent, ...rest) {
  if (parent?.filename.endsWith('follow-through-score-service.ts')) {
    if (mocks[request]) return mocks[request];
    if (request === '@/src/lib/server/services/mtos-ai') {
      return {
        getNowIso: () => '2026-11-20T18:00:00.000Z',
        hasAnyLlmProvider: () => model !== 'none',
        callLlmForJson: async () => ({ data: model }),
      };
    }
  }
  return original.call(this, request, parent, ...rest);
};

(async () => {
  try {
    const { analyzeScoreGate } = require('../src/lib/server/services/follow-through-score-service.ts');
    const context = { tenantId: 'synthetic', userId: 'am' };
    const base = { id: 'synthetic', clientId: 'client', scheduledAt: '2026-11-20T17:00:00.000Z' };

    // 1. The happy path still wins: a score the model named is the score that comes back.
    touch = { ...base };
    transcript = 'AM: How has the month felt? Client: Good, no complaints.';
    model = { findings: [], suggestedScore: 9, justificationsByScore: { 9: 'No concerns raised on the call.' } };
    let result = await analyzeScoreGate(context, 'synthetic');
    assert.equal(result.suggested, 9);
    assert.equal(result.justifications['9'], 'No concerns raised on the call.');
    assert.ok(!result.note, 'a clean read needs no explanation');

    // 2. The model read the call and named no score. The flags it found still cap it.
    model = { findings: [{ id: 'money', found: true, evidence: 'Client asked what they are paying for.' }] };
    result = await analyzeScoreGate(context, 'synthetic');
    assert.ok(typeof result.suggested === 'number', 'a score is suggested anyway');
    assert.equal(result.suggested, 8, 'the money flag caps it at 8');
    assert.ok(result.justifications[String(result.suggested)], 'and the box below is filled in');
    assert.match(result.note, /did not come back with a score/i);
    assert.ok(result.findings.find(f => f.id === 'money')?.found, 'the flag it did find survives');

    // 3. The answer came back unusable. Same outcome, different sentence.
    model = { findings: 'not an array' };
    result = await analyzeScoreGate(context, 'synthetic');
    assert.ok(typeof result.suggested === 'number');
    assert.ok(result.justifications[String(result.suggested)]);
    assert.match(result.note, /could not be used/i);

    // 4. No transcript at all -- the case the screenshot showed. The note has to name THAT rather
    // than blame an AI provider, because attaching a transcript is the fix.
    transcript = undefined;
    model = { findings: [], suggestedScore: 8 };
    result = await analyzeScoreGate(context, 'synthetic');
    assert.ok(typeof result.suggested === 'number', 'still something to score');
    assert.ok(result.justifications[String(result.suggested)]);
    assert.match(result.note, /no transcript on this touch/i);
    assert.ok(!/AI provider/i.test(result.note), 'the missing transcript is the reason, not the provider');

    // 5. No provider configured, with a transcript present. Flags from the Risk Register carry
    // over, and the suggestion follows them rather than arriving blank.
    transcript = 'AM: How has the month felt?';
    model = 'none';
    touch = { ...base, postMeeting: { clientIntelligence: { riskRegister: { money: 'Yes', silence: 'No' } } } };
    result = await analyzeScoreGate(context, 'synthetic');
    assert.ok(result.findings.find(f => f.id === 'money')?.found, 'the recorded flag carries over');
    assert.equal(result.suggested, 8, 'and it caps the suggestion at 8');
    assert.match(result.note, /drawn from those flags/i);

    // 6. A clean call with nothing recorded opens at 9 rather than at nothing.
    touch = { ...base };
    result = await analyzeScoreGate(context, 'synthetic');
    assert.equal(result.suggested, 9);

    // 7. An earlier analysis is still preferred over a fresh guess, and still says where it came
    // from -- re-reading must not quietly replace a score the last read already justified.
    model = { findings: [], suggestedScore: 7 };
    touch = {
      ...base,
      postMeeting: {
        analyzedAt: '2026-11-20T19:00:00.000Z',
        clientIntelligence: { healthSuggestion: { suggestedNps: 4, suggestedNpsReason: 'Billing raised twice.' } },
      },
      transcript: { status: 'found', docIds: [], foundAt: '2026-11-20T18:00:00.000Z' },
    };
    result = await analyzeScoreGate(context, 'synthetic');
    assert.equal(result.suggested, 4);
    assert.equal(result.justifications['4'], 'Billing raised twice.');
    assert.match(result.note, /earlier transcript analysis/i);

    console.log('PASS a score and a justification come back from every path: model score, model silence, unusable answer, missing transcript, no provider, clean call, earlier analysis');
  } finally {
    Module._load = original;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
