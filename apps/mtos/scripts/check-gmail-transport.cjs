/* eslint-disable @typescript-eslint/no-require-imports -- CJS interception isolates OAuth, Firestore and network calls. */
/* Synthetic accounts and Gmail responses only. No live email is sent. */
require('tsx/cjs');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load, originalFetch = global.fetch;
let records, accounts, deliveries, requests, mode, visible, refreshes, serial = Promise.resolve();
const copy = (value) => value === undefined ? undefined : structuredClone(value);
const db = {
  doc(path) { return { path, async get() { return { exists: records.has(path), data: () => copy(records.get(path)) }; }, async update(patch) { Object.assign(records.get(path), copy(patch)); } }; },
  async runTransaction(fn) {
    const previous = serial; let release; serial = new Promise((resolve) => { release = resolve; }); await previous;
    try { return await fn({ get: (ref) => ref.get(), set: (ref, value) => records.set(ref.path, copy(value)) }); } finally { release(); }
  },
};
const mocks = {
  '@/src/lib/server/integrations': {
    getIntegrationConnection: async (context, provider) => { assert.equal(provider, 'gmail'); return accounts.get(context.userId); },
    getIntegrationCredentials: (connection) => ({ accessToken: connection?.token }),
    refreshIntegration: async (context) => { refreshes++; accounts.get(context.userId).token = context.userId + '-refreshed'; accounts.get(context.userId).tokenExpiresAt = new Date(Date.now() + 3600000).toISOString(); },
  },
  '@/src/lib/server/firebase/admin': { getFirebaseAdminDb: () => db },
  '@/src/lib/server/firebase/collections': { userIntegrationConnectionPath: (tenant, user, provider) => `${tenant}/users/${user}/integrations/${provider}` },
};
Module._load = function (request, parent, ...rest) { if (parent?.filename.endsWith('gmail-transport.ts') && mocks[request]) return mocks[request]; return originalLoad.call(this, request, parent, ...rest); };
const { sendGmailMessage, verifyGmailMessageAccepted, encodeGmailMessage } = require('../src/lib/server/gmail-transport.ts');
const { sendClientEmail } = require('../src/lib/server/services/client-email-service.ts');
const context = { tenantId: 'synthetic-tenant', userId: 'am-a' };
const message = { to: 'client@example.test', cc: ['office@example.test'], subject: 'Actualización — aquí ✓', html: '<p>Resultados verificados ✓</p><p><a href="https://www.loom.com/share/test">Watch update</a></p>', idempotencyKey: 'test-message' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function reset() {
  records = new Map(); deliveries = []; requests = []; mode = 'ok'; visible = true; refreshes = 0;
  accounts = new Map(['am-a', 'am-b'].map((id) => [id, { status: 'connected', scopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'], token: id + '-token', tokenExpiresAt: new Date(Date.now() + 3600000).toISOString(), alias: 'accepted' }]));
}
global.fetch = async (url, init = {}) => {
  assert.ok(String(url).startsWith('https://gmail.googleapis.com/'), 'all transport requests go to Gmail');
  const token = init.headers.authorization.replace('Bearer ', '');
  const user = token.startsWith('am-a') ? 'am-a' : 'am-b';
  const account = accounts.get(user); requests.push({ url: String(url), method: init.method || 'GET', token });
  if (String(url).endsWith('/settings/sendAs')) return json({ sendAs: [{ sendAsEmail: user + '@example.test', isPrimary: true }, ...(account.alias === 'missing' ? [] : [{ sendAsEmail: 'support@mapranking.com', verificationStatus: account.alias }])] });
  if (String(url).endsWith('/messages/send')) {
    if (mode === 'rejected') return json({ error: { message: 'Synthetic send rejection' } }, 403);
    const raw = Buffer.from(JSON.parse(init.body).raw, 'base64url').toString('utf8');
    const header = (name) => raw.split(/\r?\n/).find((line) => line.startsWith(name + ': '))?.slice(name.length + 2).trim();
    const item = { id: 'gmail-' + (deliveries.length + 1), threadId: 'thread-' + (deliveries.length + 1), user, raw, labelIds: ['SENT'], payload: { headers: ['Message-ID', 'X-MTOS-Content-Hash', 'From', 'To', 'Subject'].map((name) => ({ name, value: header(name) })) } };
    deliveries.push(item);
    if (mode === 'ambiguous') throw Error('Synthetic connection lost after acceptance');
    if (mode === 'missing-id') return json({});
    return json({ id: item.id, threadId: item.threadId });
  }
  if (String(url).includes('/messages?')) {
    const q = new URL(String(url)).searchParams.get('q');
    const matches = visible ? deliveries.filter((item) => item.user === user && q.includes(item.payload.headers.find((h) => h.name === 'Message-ID').value)) : [];
    return json({ messages: matches.map((item) => ({ id: item.id })) });
  }
  if (String(url).includes('/messages/')) return json(deliveries.find((item) => item.id === new URL(String(url)).pathname.split('/').at(-1)));
  throw Error('Unexpected request ' + url);
};
(async () => {
  reset();
  let result = await sendGmailMessage(context, message);
  assert.equal(result.sent, true); assert.equal(deliveries.length, 1);
  const raw = deliveries[0].raw;
  assert.match(raw, /^From: support@mapranking.com/m); assert.match(raw, /^Reply-To: support@mapranking.com/m);
  assert.match(raw, /^Cc: office@example.test/m); assert.match(raw, /multipart\/alternative/); assert.match(raw, /Content-Type: text\/html/);
  assert.ok(raw.includes(Buffer.from(message.html, 'utf8').toString('base64').slice(0, 50)));
  const subject = raw.match(/^Subject: =\?UTF-8\?B\?(.*?)\?=/m)[1]; assert.equal(Buffer.from(subject, 'base64').toString('utf8'), message.subject);
  assert.match(result.sentVia, /am-a@example.test/);
  await sendGmailMessage(context, message); assert.equal(deliveries.length, 1);
  console.log('PASS verified support sender, own Gmail token, HTML/text, Unicode, CC and repeat-send deduplication');

  reset(); accounts.get('am-a').alias = 'missing'; result = await sendGmailMessage(context, message); assert.equal(result.sent, false); assert.match(result.detail, /verify support@mapranking.com/); assert.equal(deliveries.length, 0);
  accounts.get('am-a').alias = 'pending'; result = await sendGmailMessage(context, message); assert.equal(result.sent, false); assert.equal(deliveries.length, 0);
  reset(); accounts.get('am-a').scopes = ['https://www.googleapis.com/auth/gmail.readonly']; result = await sendGmailMessage(context, message); assert.equal(result.sent, false); assert.match(result.detail, /sending permission/); assert.equal(requests.length, 0);
  reset(); accounts.delete('am-a'); result = await sendGmailMessage(context, message); assert.equal(result.sent, false); assert.equal(deliveries.length, 0);
  console.log('PASS missing/pending alias, missing send scope and disconnected user block sending without personal-address fallback');

  reset(); accounts.get('am-a').tokenExpiresAt = '2000-01-01T00:00:00Z'; result = await sendGmailMessage(context, message); assert.equal(result.sent, true); assert.equal(refreshes, 1); assert.ok(requests.every((item) => item.token === 'am-a-refreshed'));
  reset(); await sendGmailMessage({ ...context, userId: 'am-b' }, message); assert.ok(requests.every((item) => item.token === 'am-b-token')); assert.ok([...records.keys()].every((path) => path.includes('/users/am-b/')));
  console.log('PASS expired-token refresh and strict per-user Gmail/receipt isolation');

  reset(); mode = 'ambiguous'; result = await sendGmailMessage(context, message); assert.equal(result.sent, false); assert.equal(result.deliveryUncertain, true); assert.equal(deliveries.length, 1);
  visible = false; result = await sendGmailMessage(context, message); assert.equal(result.sent, false); assert.equal(result.deliveryUncertain, true); assert.equal(deliveries.length, 1);
  visible = true; result = await verifyGmailMessageAccepted(context, message.idempotencyKey); assert.equal(result.sent, true); assert.equal(deliveries.length, 1);
  console.log('PASS lost response never blindly resends; read-only Gmail reconciliation recovers the accepted message');

  reset(); mode = 'rejected'; result = await sendGmailMessage(context, message); assert.equal(result.sent, false); assert.ok(!result.deliveryUncertain);
  mode = 'ok'; result = await sendGmailMessage(context, message); assert.equal(result.sent, true); assert.equal(deliveries.length, 1);
  reset(); await Promise.all([sendGmailMessage(context, message), sendGmailMessage(context, message)]); assert.equal(deliveries.length, 1);
  console.log('PASS definitive refusal safely retries; concurrent attempts send once');

  reset(); result = await sendClientEmail(context, { recipient: message.to, subject: 'Monthly update', html: '<p>Pending task: unfinished report</p>', idempotencyKey: 'blocked' }); assert.equal(result.sent, false); assert.equal(requests.length, 0);
  assert.throws(() => encodeGmailMessage({ to: message.to, subject: 'Bad\r\nBcc: other@example.test', body: 'Test' }, '<test@mapranking.com>', 'abc'));
  console.log('PASS client-content policy and header-injection checks still apply before any network request');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => { Module._load = originalLoad; global.fetch = originalFetch; });
