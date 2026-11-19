/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic tenant profiles and model output only. */
require('tsx/cjs');
const Module = require('node:module'), assert = require('node:assert/strict');
const original = Module._load;
let profile = { name: 'Francisco Quintero', email: 'am@example.test' }, saved, prompt;
const client = { id: 'client', name: 'Synthetic client', accountManager: 'Francisco', contact: 'Jose Castro' };
const touch = { id: 'touch', clientId: 'client', prepPack: {}, presentation: { status: 'generated', clientName: 'Wrong business', preparedBy: 'UNCONFIRMED: Account Manager name needed', slides: [{ layout: 'cover', title: 'Synthetic title' }] } };
Module._load = function(request, parent, ...rest) {
  if (parent?.filename.endsWith('presentation-identity-service.ts')) {
    if (request === './user-service') return { getAccountManagerProfile: async () => profile, getUserDisplayNames: async () => ({ owner: 'Verified owner' }) };
    if (request === './confirmation-email-service') return { resolveConfirmationContact: value => value.contact || '' };
  }
  if (parent?.filename.endsWith('presentation-service.ts')) {
    if (request.endsWith('/seed-mtos-data-source')) return { getMtosDataSource: () => ({ getMonthlyTouchById: async () => touch, getMonthlyTouches: async () => [], getClientById: async () => client }) };
    if (request.endsWith('/firebase/admin')) return { getFirebaseAdminDb: () => ({ doc: () => ({ set: async value => { saved = value; } }) }) };
    if (request.endsWith('/server/env')) return { getServerEnv: () => ({}) };
    if (request.endsWith('/mtos-ai')) return { hasAnyLlmProvider: () => true, getNowIso: () => '2026-11-19T20:00:00Z', stripUndefinedDeep: value => value, callLlmForJson: async options => { prompt = options.userText; return { data: { title: 'Synthetic deck', clientName: 'Invented client', preparedBy: 'UNCONFIRMED', preparedFor: 'Wrong person', slides: Array.from({ length: 8 }, (_, i) => ({ layout: i ? 'bullets' : 'cover', title: 'Synthetic ' + i, bullets: ['Verified fixture result'] })) }, model: 'mock' }; } };
    if (request.endsWith('/live-call-guide-service')) return { buildTouchEvidence: () => ({}) };
    if (request.endsWith('/prompt-store')) return { getPromptText: async () => 'Synthetic prompt' };
    if (request === './presentation-rank-service') return { presentationRankComparisons: async () => [] };
  }
  return original.call(this, request, parent, ...rest);
};
(async () => {
  try {
    const { presentationIdentity, withPresentationIdentity } = require('../src/lib/server/services/presentation-identity-service.ts');
    const context = { tenantId: 'synthetic', userId: 'am', role: 'account_manager' };
    let identity = await presentationIdentity(context, client, touch);
    assert.equal(identity.preparedBy, 'Francisco Quintero');
    const corrected = withPresentationIdentity(touch.presentation, identity);
    assert.equal(corrected.preparedBy, 'Francisco Quintero'); assert.equal(corrected.clientName, 'Synthetic client'); assert.equal(corrected.preparedFor, 'Jose Castro');
    assert.equal(touch.presentation.preparedBy, 'UNCONFIRMED: Account Manager name needed', 'read correction must not mutate stored slides');
    profile = { name: 'Another Reviewer' };
    assert.equal((await presentationIdentity({ ...context, role: 'qa_reviewer' }, client, touch)).preparedBy, 'Francisco');
    assert.equal((await presentationIdentity(context, { ...client, accountManager: '' }, { ...touch, approval: { approvedBy: 'owner' } })).preparedBy, 'Verified owner');
    identity = await presentationIdentity({ ...context, role: 'qa_reviewer' }, { ...client, accountManager: '' }, touch);
    assert.equal(withPresentationIdentity(touch.presentation, identity).preparedBy, undefined, 'no viewer impersonation or placeholder');
    profile = { name: 'Francisco Quintero' };
    const { generatePresentation } = require('../src/lib/server/services/presentation-service.ts');
    await generatePresentation(context, 'touch');
    assert.equal(saved.presentation.preparedBy, 'Francisco Quintero'); assert.equal(saved.presentation.clientName, client.name); assert.equal(saved.presentation.preparedFor, 'Jose Castro');
    assert.ok(prompt.includes('Francisco Quintero'));
    const fs = require('node:fs');
    for (const file of ['src/lib/server/services/monthly-touch-service.ts', 'src/app/api/monthly-touches/[touchId]/presentation.pptx/route.ts', 'src/lib/server/services/presentation-script-service.ts']) assert.match(fs.readFileSync(file, 'utf8'), /withPresentationIdentity/);
    console.log('PASS verified cover identity, same-owner full profile name, another viewer never replaces ownership, recorded approver fallback, no placeholders, model names overridden, existing-view/export/script coverage');
  } finally { Module._load = original; }
})().catch(error => { console.error(error); process.exitCode = 1; });
