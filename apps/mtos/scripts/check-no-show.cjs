/* eslint-disable @typescript-eslint/no-require-imports -- CJS loader interception isolates remote integrations in this test. */
/* Integration orchestration tests with in-memory Firestore and stubbed remote services.
 * No real Calendar events, client emails, or ClickUp documents are changed. */
require('tsx/cjs');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
let records, sends, patches, calendarFails, sendOutcome;
const clone = (x) => structuredClone(x);
const del = { operation: 'delete' };
function apply(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    const path = key.split('.'); let into = target;
    for (const segment of path.slice(0, -1)) into = into[segment] ||= {};
    const leaf = path.at(-1);
    if (value?.operation === 'delete') delete into[leaf];
    else if (value?.operation === 'union') {
      into[leaf] ||= [];
      for (const item of value.values) if (!into[leaf].some((old) => JSON.stringify(old) === JSON.stringify(item))) into[leaf].push(clone(item));
    } else if (value && typeof value === 'object' && !Array.isArray(value)) { into[leaf] = {}; apply(into[leaf], value); }
    else into[leaf] = clone(value);
  }
}
const db = {
  doc(path) { return { path, async get() { return { exists: records.has(path), data: () => clone(records.get(path)) }; },
    async update(patch) { apply(records.get(path), patch); }, async set(value) { const data = {}; apply(data, value); records.set(path, data); },
    collection(name) { return { doc: (id) => db.doc(`${path}/${name}/${id}`) }; } }; },
  async runTransaction(fn) { return fn({ get: (r) => r.get(), update: (r, p) => r.update(p) }); },
  batch() { const operations = []; return { update: (r, p) => operations.push(() => r.update(p)), set: (r, p) => operations.push(() => r.set(p)), delete: (r) => operations.push(() => records.delete(r.path)), async commit() { for (const op of operations) await op(); } }; },
};
const presentation = { status: 'generated', slides: [{ title: 'Performance', sectionId: 'performance', presenterNotes: 'Verified performance and next steps.' }] };
const mocks = {
  'firebase-admin/firestore': { FieldValue: { delete: () => del, arrayUnion: (...values) => ({ operation: 'union', values }) } },
  '@/src/lib/server/data/seed-mtos-data-source': { getMtosDataSource: () => ({ getMonthlyTouchById: async () => clone(records.get('touch')), getClientById: async () => ({ id: 'client', name: 'Test Client' }) }) },
  '@/src/lib/server/firebase/admin': { getFirebaseAdminDb: () => db },
  '@/src/lib/server/firebase/collections': { monthlyTouchPath: () => 'touch', clientPath: () => 'client', monthlyTouchArtifactPath: () => 'artifact' },
  './presentation-service': { generatePresentation: async () => ({ touch: { presentation } }) },
  './google-meet-service': { readRescheduleAvailability: async () => ({ durationMinutes: 30, until: new Date(Date.now() + 30 * 86400000).toISOString(), busy: [] }), rescheduleLinkedEvent: async (_, eventId) => { assert.equal(eventId, 'existing-event'); if (calendarFails) throw Error('Calendar failed'); patches++; } },
  './confirmation-email-service': { resolveRecipient: () => ({ recipient: 'client@example.com' }) },
  './client-email-service': { sendClientEmail: async () => { sends++; return sendOutcome; }, verifyClientEmailAccepted: async () => ({ sent: true, messageId: 'verified-gmail-message' }) },
  './intercom-send-service': { verifyLoomEmailAccepted: async () => 'verified-conversation' },
  './user-service': { getAccountManagerProfile: async () => ({ name: 'AM', timeZone: 'America/Los_Angeles' }), getAccountManagerPreferences: async () => ({ emailSignoff: 'Regards,\nAM' }), clientEmailSenderAddress: async () => 'am@example.com' },
};
Module._load = function (request, parent, ...rest) {
  if (parent?.filename.endsWith('no-show-service.ts') && mocks[request]) return mocks[request];
  return originalLoad.call(this, request, parent, ...rest);
};
const { runNoShowAction } = require('../src/lib/server/services/no-show-service.ts');
const { calendarSlotAvailable, loomReady, loomEvidence, usableLoomUrl } = require('../src/lib/contracts/no-show.ts');
const { followThroughChecklist } = require('../src/lib/contracts/follow-through-checklist.ts');
const context = { tenantId: 'tenant', userId: 'am' };
const run = (action) => runNoShowAction(context, 'touch', action);
function reset() {
  records = new Map([['touch', { id: 'touch', clientId: 'client', progress: 'live', calendarEventId: 'existing-event', prepPack: { finalized: true }, prepBrief: { important: 'Preserved' }, review: { approvedAt: '2026-01-01', declinedSections: [] }, live: { notes: { old: 'Historical note' } } }], ['artifact', { payload: 'Old transcript' }]]);
  sends = patches = 0; calendarFails = false; sendOutcome = { sent: true, messageId: 'gmail-message' };
}
async function prepareLoom() {
  await run({ action: 'select', resolution: 'loom' });
  await run({ action: 'generate' });
  await run({ action: 'save', script: 'Reviewed script', url: 'https://www.loom.com/share/abc123' });
  await run({ action: 'email' });
}
(async () => {
  reset();
  assert.equal(usableLoomUrl('https://loom.com.evil.test/share/a'), false);
  assert.equal(usableLoomUrl('javascript:alert(1)'), false);
  assert.equal(usableLoomUrl('https://user@loom.com/share/a'), false);
  const now = Date.parse('2026-11-17T00:00:00Z');
  const availability = { durationMinutes: 30, until: '2026-12-01T00:00:00Z', timeZone: 'America/Los_Angeles', busy: [{ start: '2026-11-19', end: '2026-11-20' }] };
  assert.equal(calendarSlotAvailable('2026-11-20T02:00:00Z', availability, now), false, 'all-day conflicts use the calendar time zone');
  assert.equal(calendarSlotAvailable('2026-11-20T18:00:00Z', availability, now), true);
  assert.equal(calendarSlotAvailable('2026-12-02T18:00:00Z', availability, now), false);
  assert.equal(loomReady(records.get('touch')), false);
  assert.equal(followThroughChecklist(records.get('touch'))[2].label, 'Transcript');
  assert.equal(followThroughChecklist(records.get('touch'))[2].ok, false);
  records.get('touch').transcript = { status: 'found' };
  assert.equal(followThroughChecklist(records.get('touch'))[2].ok, true);
  assert.equal(loomEvidence(records.get('touch')), undefined);
  console.log('PASS normal meeting transcript checklist remains unchanged');
  reset();
  await run({ action: 'select', resolution: 'reschedule' });
  await run({ action: 'select', resolution: 'reschedule' });
  assert.equal(records.get('touch').noShowHistory.length, 1);
  calendarFails = true;
  const date = new Date(Date.now() + 7 * 86400000).toISOString();
  await assert.rejects(run({ action: 'reschedule', scheduledAt: date, confirmed: true }), /Calendar failed/);
  assert.equal(records.get('touch').progress, 'live');
  assert.ok(records.get('touch').live);
  calendarFails = false;
  await run({ action: 'reschedule', scheduledAt: date, confirmed: true });
  const rescheduled = records.get('touch');
  assert.equal(patches, 1); assert.equal(rescheduled.progress, 'prep');
  assert.equal(rescheduled.calendarEventId, 'existing-event'); assert.equal(rescheduled.scheduledAt, date);
  assert.equal(rescheduled.live, undefined); assert.equal(rescheduled.review.approvedAt, undefined);
  assert.equal(rescheduled.prepBrief.important, 'Preserved'); assert.equal(records.has('artifact'), false);
  assert.ok([...records.keys()].some((key) => key.includes('/attempts/')));
  assert.ok(Date.parse(rescheduled.noShow.standbyUntil) < Date.parse(date));
  console.log('PASS reschedule failure preserves live state; success archives and resets only after event update');
  reset(); await prepareLoom();
  await assert.rejects(run({ action: 'save', script: 'We have pending tasks to discuss.', url: 'https://www.loom.com/share/abc123' }), /unfinished tasks/);
  assert.equal(sends, 0); assert.equal(records.get('touch').progress, 'live');
  assert.match(records.get('touch').noShow.email.html, /loom.com\/share\/abc123/);
  assert.match(records.get('touch').noShow.email.html, /Regards/);
  assert.equal(loomReady(records.get('touch')), false);
  await run({ action: 'send', approved: true });
  assert.equal(sends, 1); assert.equal(records.get('touch').progress, 'follow');
  assert.equal(loomReady(records.get('touch')), true);
  assert.match(loomEvidence(records.get('touch')), /No live meeting took place/);
  assert.equal(followThroughChecklist(records.get('touch'))[2].ok, true);
  assert.equal(followThroughChecklist(records.get('touch'))[2].label, 'No-show / Loom documentation');
  await run({ action: 'send', approved: true }); assert.equal(sends, 1);
  console.log('PASS Loom generation never sends; explicit send routes to Follow-Through and retries do not resend');
  reset(); await prepareLoom();
  sendOutcome = { sent: false, detail: 'Not connected' };
  await assert.rejects(run({ action: 'send', approved: true }), /Not connected/);
  assert.equal(records.get('touch').progress, 'live'); assert.equal(records.get('touch').noShow.sendStatus, 'failed');
  sendOutcome = { sent: true, messageId: 'retry-gmail-message' };
  await run({ action: 'send', approved: true }); assert.equal(sends, 2);
  reset(); await prepareLoom(); sendOutcome = { sent: false, detail: 'Timeout', deliveryUncertain: true };
  await assert.rejects(run({ action: 'send', approved: true }), /Timeout/);
  await assert.rejects(run({ action: 'send', approved: true }), /unresolved/); assert.equal(sends, 1);
  assert.equal(records.get('touch').progress, 'live');
  await run({ action: 'reconcile' });
  assert.equal(records.get('touch').progress, 'follow');
  assert.equal(records.get('touch').noShow.gmailMessageId, 'verified-gmail-message');
  assert.equal(sends, 1, 'read-only reconciliation does not send again');
  console.log('PASS safe failure retries; ambiguous delivery cannot send twice');
  reset(); await prepareLoom(); records.get('touch').noShow.sendStatus = 'unknown';
  await run({ action: 'reconcile' });
  assert.equal(records.get('touch').noShow.conversationId, 'verified-conversation');
  assert.equal(sends, 0, 'historical Intercom reconciliation must never send a new Gmail message');
  console.log('PASS historical Intercom receipts remain reconcilable after the Gmail switch');
  reset(); records.get('touch').noShowBusy = 'in-flight';
  await assert.rejects(run({ action: 'select', resolution: 'loom' }), /in progress/);
  console.log('PASS in-flight claims reject concurrent no-show mutations');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { Module._load = originalLoad; });
