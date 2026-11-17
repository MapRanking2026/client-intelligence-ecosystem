/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS browser harness. */
/* Isolated browser acceptance checks. All workflow endpoints are intercepted. */
const { build } = require('esbuild');
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const output = path.resolve('.next/no-show-ui-check');
  fs.mkdirSync(output, { recursive: true });
  const bundle = await build({ stdin: { contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import {NoShowPanel} from "./src/components/mtos/no-show-panel"; import {AgendaApprovalPanel} from "./src/components/mtos/agenda-approval-panel"; createRoot(document.getElementById("root")).render(window.location.pathname === "/agenda" ? <AgendaApprovalPanel touchId="test-touch" email={{subject:"Synthetic agenda",html:"<p>Verified account performance and completed work.</p><p>Regards, AM</p>",recipient:"client@example.test",blockingGaps:[]}} sent={false} availableCc={["office@example.test"]} ccEnabled={true} format="guide" approving={14} declined={[]} pageName="Synthetic Monthly Touch"/> : <NoShowPanel touchId="test-touch"/>);', resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, jsx: 'automatic', plugins: [{ name: 'mock-next-router', setup(builder) { builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'router', namespace: 'mock' })); builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export function useRouter(){return {push(value){window.lastNavigation=value},refresh(){}}}' })); } }] });
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', req.url === '/bundle.js' ? 'application/javascript' : 'text/html');
    res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].text : '<!doctype html><html><head><title>No-show acceptance harness</title></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    let state, actions = [], uncertain = false;
    await page.route('**/api/monthly-touches/test-touch/no-show', async (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: { data: { durationMinutes: 30, busy: [], until: new Date(Date.now() + 30 * 86400000).toISOString() } } });
      const body = route.request().postDataJSON(); actions.push(body);
      if (body.action === 'select') state = { resolution: body.resolution, selectedAt: new Date().toISOString(), selectedBy: 'am' };
      if (body.action === 'generate') state = { ...state, script: 'Generated speaking script', presentation: { status: 'generated' } };
      if (body.action === 'save') { state = { ...state, script: body.script, url: body.url }; if (state.email) state.email = { ...state.email, subject: body.subject, html: body.html }; }
      if (body.action === 'email') state.email = { recipient: 'client@example.com', subject: 'Video update', html: '<p><a href="' + state.url + '">Watch your video</a></p>' };
      if (body.action === 'send') {
        assert.equal(body.approved, true);
        if (uncertain) { state.sendStatus = 'unknown'; return route.fulfill({ status: 400, json: { data: state, error: 'Intercom delivery is unresolved' } }); }
        state.sentAt = new Date().toISOString(); state.sendStatus = 'sent';
      }
      if (body.action === 'reconcile') { state.sentAt = new Date().toISOString(); state.sendStatus = 'sent'; }
      if (body.action === 'reschedule') { assert.equal(body.confirmed, true); state.rescheduledAt = new Date().toISOString(); }
      return route.fulfill({ json: { data: state } });
    });
    const address = `http://127.0.0.1:${server.address().port}`;
    await page.goto(address);
    await page.getByRole('button', { name: 'No-Show', exact: true }).click();
    await page.getByRole('button', { name: 'Reschedule Meeting' }).waitFor();
    await page.getByRole('button', { name: 'Send Loom Video Update' }).waitFor();
    assert.equal(actions.length, 0);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(actions.length, 0);
    console.log('PASS chooser has two unselected options; cancel performs no mutation');
    await page.getByRole('button', { name: 'No-Show', exact: true }).click();
    await page.getByRole('button', { name: 'Send Loom Video Update' }).click();
    await page.getByRole('button', { name: 'Generate presentation and script', exact: true }).click();
    await page.getByLabel('Speaking script').fill('AM reviewed speaking script');
    await page.getByLabel('Loom recording URL').fill('https://evil.example/video');
    assert.equal(await page.getByRole('button', { name: 'Generate Email Update' }).isDisabled(), true);
    await page.getByLabel('Loom recording URL').fill('https://www.loom.com/share/abc123');
    await page.getByRole('button', { name: 'Generate Email Update' }).click();
    await page.getByLabel('Email subject').waitFor();
    assert.equal(actions.filter((action) => action.action === 'send').length, 0);
    await page.getByLabel('Email subject').fill('Edited client update');
    await page.getByRole('button', { name: 'Approve & Send' }).click();
    await page.waitForFunction(() => window.lastNavigation?.endsWith('/follow-through'));
    assert.equal(actions.filter((action) => action.action === 'send').length, 1);
    assert.equal(actions.filter((action) => action.action === 'save').at(-1).subject, 'Edited client update');
    console.log('PASS editable script, URL validation, email generation without sending, explicit approval and Follow-Through routing');
    await page.goto(address); actions = []; state = undefined;
    await page.getByRole('button', { name: 'No-Show', exact: true }).click();
    await page.getByRole('button', { name: 'Reschedule Meeting' }).click();
    await page.getByRole('button', { name: 'Check calendar availability' }).click();
    const future = new Date(Date.now() + 7 * 86400000); future.setHours(10, 0, 0, 0);
    const localValue = new Date(future.getTime() - future.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    await page.getByLabel('New meeting date and time').fill(localValue);
    await page.getByRole('button', { name: 'Review rescheduling' }).click();
    assert.equal(actions.some((action) => action.action === 'reschedule'), false);
    await page.screenshot({ path: path.join(output, 'reschedule-confirmation.png'), fullPage: true });
    await page.getByRole('button', { name: 'Confirm rescheduling', exact: true }).click();
    await page.waitForFunction(() => window.lastNavigation?.includes('?step=prep'));
    assert.equal(actions.filter((action) => action.action === 'reschedule').length, 1);
    assert.deepEqual(errors, []);
    console.log('PASS availability check, explicit reschedule confirmation, Preparation routing; no browser errors');
    await page.goto(address); actions = []; state = undefined; uncertain = true;
    await page.getByRole('button', { name: 'No-Show', exact: true }).click();
    await page.getByRole('button', { name: 'Send Loom Video Update' }).click();
    await page.getByRole('button', { name: 'Generate presentation and script', exact: true }).click();
    await page.getByLabel('Loom recording URL').fill('https://www.loom.com/share/abc123');
    await page.getByRole('button', { name: 'Generate Email Update' }).click();
    await page.getByRole('button', { name: 'Approve & Send' }).click();
    await page.getByRole('button', { name: 'Check existing email' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Approve & Send' }).isDisabled(), true);
    await page.getByRole('button', { name: 'Check existing email' }).click();
    await page.waitForFunction(() => window.lastNavigation?.endsWith('/follow-through'));
    assert.equal(actions.filter((action) => action.action === 'send').length, 1);
    console.log('PASS uncertain send displays persisted state, disables resend and offers read-only reconciliation');
    let agendaSends = 0;
    await page.route('**/api/monthly-touches/test-touch', async (route) => {
      const body = route.request().postDataJSON();
      if (body.action === 'send_agenda_email') { agendaSends++; return route.fulfill({ json: { data: { status: 'sent', detail: 'Gmail accepted the approved email from support@mapranking.com.', sentVia: 'Gmail (am@example.test; From support@mapranking.com)', sentAt: new Date().toISOString() } } }); }
      return route.fulfill({ json: { data: { savedAt: new Date().toISOString() } } });
    });
    await page.goto(address + '/agenda');
    const beforeSendText = await page.locator('body').innerText();
    assert.ok(beforeSendText.includes('connected Gmail account'));
    assert.ok(!beforeSendText.includes('through your own Intercom'));
    assert.ok(beforeSendText.includes('office@example.test'));
    assert.equal(agendaSends, 0);
    await page.getByRole('button', { name: 'Approve and Send', exact: true }).click();
    await page.getByText('Gmail accepted the approved email from support@mapranking.com.', { exact: true }).waitFor();
    assert.equal(agendaSends, 1);
    assert.deepEqual(errors, []);
    console.log('PASS screenshot agenda uses Gmail/shared sender, preserves CC and requires explicit approval before sending');

  } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
