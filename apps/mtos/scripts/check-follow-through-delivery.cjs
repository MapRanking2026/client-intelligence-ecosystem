/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic services only; no live deliveries. */
require('tsx/cjs');
const Module = require('node:module'), assert = require('node:assert/strict');
const original = Module._load, originalFetch = global.fetch, clone = value => structuredClone(value);
const context = { tenantId: 'synthetic', userId: 'am' };
let touch, client, filed, sent, comments, reminders, handoffs, rejectMail, booked, lock;
const db = { doc() { return { async set(value) { touch.followThrough = { ...touch.followThrough, ...clone(value.followThrough) }; }, async update() { lock = false; } }; }, async runTransaction(fn) { return fn({ get: async () => ({ data: () => ({ noShowProcessingAt: lock ? new Date().toISOString() : undefined }) }), update() { lock = true; } }); } };
Module._load = function(request, parent, ...rest) {
  if (parent?.filename.endsWith('follow-through-process-service.ts')) {
    if (request.endsWith('/seed-mtos-data-source')) return { getMtosDataSource: () => ({ getMonthlyTouchById: async () => clone(touch), getClientById: async () => clone(client) }) };
    if (request.endsWith('/firebase/admin')) return { getFirebaseAdminDb: () => db };
    if (request.endsWith('/contracts/follow-through-trackers')) return { ...original.call(this, request, parent, ...rest), trackerCardDiffs: () => [] };
    if (request.endsWith('/contracts/follow-through-finish')) {
      const actual = original.call(this, request, parent, ...rest);
      return { ...actual, finishBlockers: () => [] };
    }
    if (request.endsWith('/client-book-service')) return { writePostNotesToClientBook: async (_, input) => { filed++; assert.equal(input.links.postPageId, 'post'); return { pageName: 'Post Monthly Touch Notes', links: { ...input.links, postPageUrl: 'https://example.test/post' } }; } };
    if (request.endsWith('/client-email-service')) return { sendClientEmail: async (_, input) => { sent++; assert.equal(input.recipient, 'jay@example.test'); return rejectMail ? { sent: false, detail: 'Synthetic Gmail refusal' } : { sent: true, detail: 'Sent', messageId: 'message', sentVia: 'gmail' }; } };
    if (request.endsWith('/next-touch-booking-service')) return { readBookedNextMeeting: async () => booked ? { scheduledAt: '2026-12-18T22:00:00Z' } : undefined };
    if (request.endsWith('/integration-permissions-service')) return { hasPermission: async () => true };
    if (request.endsWith('/server/integrations')) return { getIntegrationConnection: async () => ({ status: 'connected' }), getIntegrationCredentials: () => ({ accessToken: 'synthetic' }) };
    if (request.endsWith('/qc-handoff-service')) return { handTouchToQc: async (_, latest) => { handoffs++; assert.ok(latest.followThrough.recap.sentAt); assert.equal(latest.followThrough.notesBookLinks.postPageId, 'post'); return { created: true, notified: [], message: 'Synthetic QA handoff' }; } };
  }
  return original.call(this, request, parent, ...rest);
};
global.fetch = async (url) => {
  if (url.endsWith('/comment')) { comments++; return new Response(JSON.stringify({ id: 'comment' })); }
  if (url.endsWith('/task')) { reminders++; return new Response(JSON.stringify({ id: 'reminder', url: 'https://app.clickup.com/t/reminder' })); }
  throw Error('Unexpected network request: ' + url);
};
function reset() {
  filed = sent = comments = reminders = handoffs = 0; rejectMail = false; booked = false; lock = false;
  client = { id: 'client', name: 'Synthetic client', contact: 'Jay', clickupTaskId: 'client-task' };
  touch = { id: 'touch', clientId: 'client', progress: 'qa', scheduledAt: '2026-11-18T22:00:00Z', agendaEmail: { recipient: 'jay@example.test' }, approval: { clientBook: { docId: 'doc', pageId: 'prep', pageUrl: 'https://example.test/prep', postPageId: 'post' } }, followThrough: { notes: { summary: 'Synthetic meeting summary', nps: 8, departments: [], clientActions: [], pending: [] }, items: [], trackerCards: [{ id: 'risk', kind: 'risk', decision: 'denied' }], recap: { decision: 'approved', subject: 'Synthetic recap', html: '<p>Hello Jay, synthetic recap.</p>' } } };
  Object.assign(touch.followThrough.notes, { title: 'Synthetic touch', npsJustification: 'Synthetic evidence', goalQuarter: '', goalText: '', goalStatus: 'Not recorded', goalEvidence: '', bullets: {} });
  touch.followThrough.processing = { steps: ['tickets', 'health'].map(id => ({ id, status: 'done', message: 'Previously completed' })) };
}
(async () => {
  const previousList = process.env.CLICKUP_GROWTH_PILOT_LIST_ID; process.env.CLICKUP_GROWTH_PILOT_LIST_ID = 'synthetic';
  try {
    const { processFollowThrough } = require('../src/lib/server/services/follow-through-process-service.ts');
    reset(); rejectMail = true;
    let result = await processFollowThrough(context, 'touch');
    assert.equal(filed, 1, JSON.stringify(result.steps)); assert.equal(comments, 1); assert.equal(reminders, 1); assert.equal(handoffs, 0);
    assert.equal(touch.followThrough.finishedAt, undefined); assert.equal(result.steps.find(s => s.id === 'risk').status, 'skipped');
    rejectMail = false;
    result = await processFollowThrough(context, 'touch');
    assert.equal(filed, 1); assert.equal(comments, 1); assert.equal(reminders, 1); assert.equal(sent, 2); assert.equal(handoffs, 0);
    booked = true; touch.nextMeetingBooking = { status: 'booked' };
    result = await processFollowThrough(context, 'touch');
    assert.equal(handoffs, 1); assert.equal(sent, 2); assert.equal(comments, 1); assert.equal(reminders, 1);
    assert.ok(touch.followThrough.finishedAt); assert.ok(result.steps.every(s => ['done', 'skipped'].includes(s.status)));
    reset(); delete touch.agendaEmail;
    await assert.rejects(processFollowThrough(context, 'touch'), /email address/);
    assert.equal(filed + sent + comments + reminders, 0);
    reset(); touch.followThrough.processing = { steps: [{ id: 'booking', status: 'warning', message: 'A reminder ticket was created instead: https://app.clickup.com/t/legacy.' }] };
    await processFollowThrough(context, 'touch'); assert.equal(reminders, 0);
    assert.equal(touch.followThrough.bookingReminderId, 'legacy');
    reset(); lock = true;
    await assert.rejects(processFollowThrough(context, 'touch'), /already processing/); assert.equal(filed, 0);
    console.log('PASS saved notes-page IDs, real recipient resolution, partial-run retry without duplicate notes/comments/reminders/mail, fresh QA evidence, no premature QA, legacy-reminder recovery, missing-recipient preflight and concurrent-run lock');
  } finally { Module._load = original; global.fetch = originalFetch; if (previousList === undefined) delete process.env.CLICKUP_GROWTH_PILOT_LIST_ID; else process.env.CLICKUP_GROWTH_PILOT_LIST_ID = previousList; }
})().catch(error => { console.error(error); process.exitCode = 1; });
