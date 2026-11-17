/* eslint-disable @typescript-eslint/no-require-imports -- Standalone isolated CommonJS browser harness. */
const { build } = require('esbuild');
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const output = path.resolve('.next/client-content-ui-check');
  fs.mkdirSync(output, { recursive: true });
  const fixture = { status: 'generated', title: 'Synthetic test account', slides: [
    { layout: 'status_list', title: 'One item is still open on our side and we will give you a new date', items: [
      { label: 'Bi-weekly Google Ads report', status: 'OPEN', detail: 'Still open' },
      { label: 'Scan refresh', status: 'PROPOSED' },
      { label: 'Updated service categories', status: 'COMPLETED', detail: 'Verified completed work' },
    ] },
    { layout: 'stat_callouts', title: 'GBP performance', stats: [{ value: '7', caption: 'Calls; previous period 11' }] },
  ] };
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {PresentationViewer} from './src/components/mtos/presentation-viewer'; createRoot(document.getElementById('root')).render(<PresentationViewer touchId="synthetic-test" presentation={${JSON.stringify(fixture)}} readOnly/>);`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, jsx: 'automatic' });
  const server = http.createServer((req, res) => { res.setHeader('content-type', req.url === '/bundle.js' ? 'application/javascript' : 'text/html'); res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].text : '<!doctype html><html><head><title>Client content policy test</title></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByText('Updated service categories', { exact: true }).first().waitFor();
    const text = await page.locator('body').innerText();
    assert.ok(!text.includes('Bi-weekly Google Ads report')); assert.ok(!text.includes('Scan refresh')); assert.ok(!text.includes('One item is still open'));
    assert.ok(text.includes('Completed work')); assert.ok(text.includes('COMPLETED'));
    await page.screenshot({ path: path.join(output, 'completed-work.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS actual presentation viewer removes the screenshot’s open/proposed work and renders completed work without browser errors');
  } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
