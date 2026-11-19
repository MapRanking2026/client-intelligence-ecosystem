/* eslint-disable @typescript-eslint/no-require-imports -- Local synthetic processing result; no real sends. */
const { build } = require('esbuild'), { chromium } = require('playwright');
const { compile } = require('@tailwindcss/node'), { Scanner } = require('@tailwindcss/oxide');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
(async () => {
  const ids = ['tickets', 'notes', 'risk', 'health', 'recap', 'channel', 'booking'];
  const partial = { steps: ids.map(id => ({ id, status: ['notes', 'recap', 'booking'].includes(id) ? 'warning' : 'done', message: 'Synthetic ' + id })), qc: { created: false, notified: 0, message: 'This touch is already with QC' } };
  const notes = { title: 'Synthetic notes', summary: 'Synthetic summary', nps: 8, npsJustification: '', goalText: '', goalEvidence: '', goalStatus: '', goalQuarter: '', bullets: {}, departments: [], pending: [], clientActions: [] };
  const recap = { recipient: 'client@example.test', decision: 'approved', subject: 'Synthetic recap', html: '<p>A synthetic approved recap with enough body text to pass validation.</p>' };
  const contents = `import React from 'react';import{createRoot}from'react-dom/client';import{FollowThroughFinish}from'./src/components/mtos/follow-through-finish';createRoot(document.getElementById('root')).render(<FollowThroughFinish touchId="synthetic" notes={${JSON.stringify(notes)}} items={[]} trackerCards={[{id:'health',kind:'health',decision:'denied',current:{},next:{}}]} recap={${JSON.stringify(recap)}} processing={${JSON.stringify(partial)}} qaHref="/qa/synthetic/touch"/>);`;
  const bundle = await build({ stdin: { contents, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, outdir: '.next/finish-ui', jsx: 'automatic', plugins: [{ name: 'fixture-link', setup(b) { b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'fixture' })); b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ resolveDir: process.cwd(), contents: 'import React from "react";export default function Link(props){return React.createElement("a",props,props.children)}' })); } }] });
  const compiler = await compile(fs.readFileSync('src/app/globals.css', 'utf8'), { base: path.resolve('src/app'), onDependency() {} });
  const css = compiler.build(new Scanner({ sources: [{ base: path.resolve('src'), pattern: '**/*.{ts,tsx}', negated: false }] }).scan()) + bundle.outputFiles.find(f => f.path.endsWith('.css')).text;
  const requests = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === '/api/monthly-touches/synthetic') {
      let body = ''; for await (const chunk of req) body += chunk;
      requests.push(JSON.parse(body)); res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: { steps: ids.map(id => ({ id, status: 'done', message: 'Synthetic confirmed delivery' })), qc: { created: true, notified: 1, message: 'Synthetic QA handoff' } } })); return;
    }
    res.setHeader('content-type', req.url === '/bundle.js' ? 'application/javascript' : req.url === '/styles.css' ? 'text/css' : 'text/html');
    res.end(req.url === '/bundle.js' ? bundle.outputFiles.find(f => f.path.endsWith('.js')).text : req.url === '/styles.css' ? css : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>body{padding:24px;background:var(--bg)}#root{max-width:1000px;margin:auto}</style><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' }); const page = await browser.newPage({ viewport: { width: 1200, height: 1050 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByText('Follow-through needs attention', { exact: true }).waitFor();
    assert.equal(await page.getByText('This touch is already with QC', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('link', { name: 'Continue to QA' }).count(), 0);
    assert.equal(await page.getByRole('link', { name: 'Review recipient and recap email' }).getAttribute('href'), '#recap');
    assert.ok(await page.getByRole('button', { name: 'Book next Monthly Touch', exact: true }).isVisible());
    await page.screenshot({ path: '.next/follow-through-finish-recovery.png', fullPage: true });
    await page.getByRole('button', { name: 'Run the unfinished steps again' }).click();
    await page.getByText('Follow-through processed', { exact: true }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Continue to QA' }).getAttribute('href'), '/qa/synthetic/touch');
    assert.deepEqual(requests, [{ action: 'process_follow_through' }]); assert.deepEqual(errors, []);
    console.log('PASS partial-run warnings, repair links, inline booking, no premature QA success, explicit retry and successful QA continuation; only mocked processing');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
