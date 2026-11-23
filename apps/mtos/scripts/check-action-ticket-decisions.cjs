/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic transactional ticket review only. */
require('tsx/cjs');
const Module = require('node:module'), assert = require('node:assert/strict'), original = Module._load;
let record = { followThrough: { notes: { summary: 'Keep the saved summary', clientActions: Array.from({ length: 5 }, (_, i) => ({ id: 'a' + i, what: 'Request ' + i, due: 'Friday' })) } } };
const db = { doc: () => ({}), runTransaction: async fn => fn({ get: async () => ({ data: () => record }), set: (_, value, options) => { assert.deepEqual(options.mergeFields, ['followThrough.items', 'followThrough.notes']); record = { followThrough: { ...record.followThrough, ...value.followThrough } }; } }) };
Module._load = function(request, parent, ...rest) {
  if (parent?.filename.endsWith('follow-through-items-service.ts') && request.endsWith('/firebase/admin')) return { getFirebaseAdminDb: () => db };
  return original.call(this, request, parent, ...rest);
};
(async () => {
  try {
    const { saveFollowThroughItems } = require('../src/lib/server/services/follow-through-items-service.ts');
    const items = record.followThrough.notes.clientActions.map(action => ({ id: 'ticket-' + action.id, actionId: action.id, formType: 'ticket', taskName: action.what, decision: 'approved' }));
    await saveFollowThroughItems({ tenantId: 'synthetic' }, 'touch', items);
    assert.ok(record.followThrough.notes.clientActions.every(action => action.decision === 'approved'));
    assert.equal(record.followThrough.notes.summary, 'Keep the saved summary');
    await saveFollowThroughItems({ tenantId: 'synthetic' }, 'touch', items.map(item => item.actionId === 'a0' ? { ...item, decision: 'denied' } : item));
    assert.equal(record.followThrough.notes.clientActions[0].decision, 'denied');
    await saveFollowThroughItems({ tenantId: 'synthetic' }, 'touch', items.map(item => item.actionId === 'a0' ? { ...item, decision: undefined } : item));
    assert.equal(record.followThrough.notes.clientActions[0].decision, undefined);
    assert.equal(Object.hasOwn(record.followThrough.notes.clientActions[0], 'decision'), false);
    console.log('PASS saved approved/denied ticket decisions update matching actions in one transaction, preserve note text, and never auto-approve an undecided linked ticket');
  } finally { Module._load = original; }
})().catch(error => { console.error(error); process.exitCode = 1; });
