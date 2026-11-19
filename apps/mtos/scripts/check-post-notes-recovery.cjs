/* eslint-disable @typescript-eslint/no-require-imports -- Mock ClickUp only; never overwrites live notes. */
require('tsx/cjs');
const Module = require('node:module'), assert = require('node:assert/strict'), fs = require('node:fs');
const original = Module._load, originalFetch = global.fetch;
let content, fail, writes, creates;
const placeholder = '_Nothing filed yet. The post-call write-up lands here after the call._';
Module._load = function(request, parent, ...rest) {
  if (parent?.filename.endsWith('client-book-service.ts')) {
    if (request.endsWith('/server/integrations')) return { getIntegrationConnection: async () => ({ status: 'connected' }), getIntegrationCredentials: () => ({ accessToken: 'synthetic' }) };
    if (request.endsWith('/clickup-client-context')) return { CLICKUP_V3: 'https://synthetic.test', resolveWorkspaceId: async () => 'workspace', findClientFolder: async () => ({ id: 'folder', name: 'Synthetic Client' }), clickupFetch: async url => {
      if (url.includes('/docs?')) return { docs: [{ id: 'doc', name: "Client's Book" }] };
      if (url.includes('/pages?')) return [{ id: 'meetings', name: 'Client Meetings Notes', pages: [{ id: 'prep', name: 'Monthly Touch (11/18/2026)', pages: [{ id: 'post', name: 'Post Monthly Touch Notes 11/18/2026' }] }] }];
      if (url.includes('/pages/post?')) return { id: 'post', content };
      throw Error('Unexpected read ' + url);
    } };
  }
  return original.call(this, request, parent, ...rest);
};
global.fetch = async (url, input) => {
  if (input.method === 'POST') creates++;
  if (input.method === 'PUT') { writes++; assert.ok(url.endsWith('/pages/post')); assert.equal(JSON.parse(input.body).content_edit_mode, 'replace'); }
  return new Response(JSON.stringify(fail ? { err: 'Synthetic refusal' } : { id: 'post' }), { status: fail ? 403 : 200 });
};
(async () => {
  try {
    const { writePostNotesToClientBook } = require('../src/lib/server/services/client-book-service.ts');
    const input = { clientName: 'Synthetic Client', touchDateIso: '2026-11-18T22:00:00Z', markdown: 'Actual generated notes', links: { docId: 'doc', prepPageId: 'prep', prepPageUrl: 'https://synthetic.test/prep', writtenAt: '2026-11-18T00:00:00Z' } };
    writes = creates = 0; fail = false; content = placeholder;
    let result = await writePostNotesToClientBook({}, input);
    assert.equal(result.error, undefined); assert.equal(result.links.postPageId, 'post'); assert.equal(writes, 1); assert.equal(creates, 0);
    content = 'A teammate wrote these notes. Preserve them.';
    result = await writePostNotesToClientBook({}, input);
    assert.ok(result.error); assert.equal(writes, 1); assert.equal(creates, 0);
    content = '';
    result = await writePostNotesToClientBook({}, input);
    assert.ok(result.error); assert.equal(writes, 1);
    fail = true;
    result = await writePostNotesToClientBook({}, { ...input, links: { ...input.links, postPageId: 'post' } });
    assert.match(result.error, /No duplicate page/); assert.equal(creates, 0);
    const approval = fs.readFileSync('src/lib/server/services/touch-approval-service.ts', 'utf8');
    assert.match(approval, /postPageId: filed.links.postPageId/);
    assert.match(approval, /postPageId: approval.clientBook.postPageId/);
    console.log('PASS old MTOS placeholder recovered in place, teammate content and unowned blank pages preserved, saved-page refusal creates no duplicate, approval retains child page IDs');
  } finally { Module._load = original; global.fetch = originalFetch; }
})().catch(error => { console.error(error); process.exitCode = 1; });
