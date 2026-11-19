/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic browser workflow; no client email or external writes. */
const { build } = require('esbuild');
const { chromium } = require('playwright');
const { compile } = require('@tailwindcss/node');
const { Scanner } = require('@tailwindcss/oxide');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');

(async () => {
  const route = fs.readFileSync('src/app/monthly-touch/[touchId]/follow-through/page.tsx', 'utf8');
  assert.match(route, /<TouchProgressRail[\s\S]*current="follow"[\s\S]*<FollowThroughNavigation/);
  assert.match(route, /<div id="recap" data-follow-section>/);
  assert.match(fs.readFileSync('src/app/monthly-touch/[touchId]/page.tsx', 'utf8'), /if \(step === "follow"\) redirect\(/);
  let saved = { subject: 'Synthetic recap', html: '<p>Hello synthetic client,</p><p>Verified test recap.</p>' };
  const requests = [];
  const sections = ['score', 'notes', 'tickets', 'trackers', 'recap', 'finish'];
  const source = `import React from 'react';import {createRoot} from 'react-dom/client';
    import {TouchProgressRail} from './src/components/mtos/touch-progress-rail';
    import {FollowThroughNavigation} from './src/components/mtos/follow-through-navigation';
    import {FollowThroughRecap} from './src/components/mtos/follow-through-recap';
    const sections=${JSON.stringify(sections)};createRoot(document.getElementById('root')).render(
      <div className="follow-through-workspace"><h1>Synthetic Monthly Touch</h1>
        <TouchProgressRail touchId="synthetic" current="follow" progress="follow">
          <FollowThroughNavigation confirmed hasNotes canFinish/>
        </TouchProgressRail>
        {sections.map(id=><section key={id} id={id} data-follow-section className="card mt-4" style={{minHeight:500}}>
          <h2>{id}</h2>{id==='recap'?<FollowThroughRecap touchId="synthetic" recap={window.fixtureRecap}/>:<p>Synthetic {id} section</p>}
        </section>)}
      </div>);`;
  const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, outdir: '.next/follow-navigation', jsx: 'automatic', plugins: [{ name: 'next-link-fixture', setup(b) {
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ resolveDir: process.cwd(), contents: 'import React from "react";export default function Link(props){return React.createElement("a",props,props.children)}' }));
  } }] });
  const compiler = await compile(fs.readFileSync('src/app/globals.css', 'utf8'), { base: path.resolve('src/app'), onDependency() {} });
  const css = compiler.build(new Scanner({ sources: [{ base: path.resolve('src'), pattern: '**/*.{ts,tsx}', negated: false }] }).scan()) + bundle.outputFiles.find(f => f.path.endsWith('.css')).text;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/api/monthly-touches/synthetic') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw); requests.push(body); assert.equal(body.action, 'save_recap'); saved = body.recap;
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: { recap: saved } })); return;
    }
    res.setHeader('content-type', req.url === '/bundle.js' ? 'application/javascript' : req.url === '/styles.css' ? 'text/css' : 'text/html');
    res.end(req.url === '/bundle.js' ? bundle.outputFiles.find(f => f.path.endsWith('.js')).text : req.url === '/styles.css' ? css : `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>body{padding:24px}#root{max-width:1100px;margin:auto}:root{--topbar-h:0px}h1,h2{font-size:24px}</style><div id="root"></div><script>window.fixtureRecap=${JSON.stringify(saved).replace(/</g, '\\u003c')}</script><script src="/bundle.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/monthly-touch/synthetic/follow-through`);
    const stages = page.getByRole('navigation', { name: 'Monthly Touch stages' });
    assert.equal(await stages.locator('[aria-current="step"]').innerText(), '4. Follow-through\nYou are here');
    assert.equal(await stages.getByRole('link', { name: /4\. Follow-through/ }).getAttribute('href'), '/monthly-touch/synthetic/follow-through');
    assert.equal(await stages.getByRole('link', { name: /5\. QA/ }).count(), 0);
    const nav = page.getByRole('navigation', { name: 'Follow-through sections' });
    await nav.getByRole('link', { name: /Recap email/ }).click();
    await page.waitForTimeout(150);
    assert.equal(await nav.locator('[aria-current="location"]').innerText(), '5\nRecap email');
    assert.ok(await stages.isVisible());
    assert.ok(await page.locator('#recap').evaluate(el => el.getBoundingClientRect().top >= document.querySelector('.stage-rail').getBoundingClientRect().bottom));
    await page.getByLabel('Subject', { exact: true }).fill('Edited recap within workflow');
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await page.getByRole('button', { name: 'Save recap and continue to finish', exact: true }).click();
    await page.waitForURL(url => url.searchParams.get('step') === 'finish' && url.hash === '#finish');
    await page.waitForTimeout(150);
    assert.equal(saved.subject, 'Edited recap within workflow'); assert.equal(saved.decision, 'approved');
    assert.equal(requests.length, 1);
    assert.ok(await stages.isVisible());
    assert.equal(await nav.locator('[aria-current="location"]').innerText(), '6\nFinish');
    await page.setViewportSize({ width: 390, height: 844 });
    await nav.getByRole('link', { name: /Recap email/ }).click(); await page.waitForTimeout(150);
    assert.ok(await stages.isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: '.next/follow-through-navigation-mobile.png' });
    assert.deepEqual(errors, []);
    console.log('PASS persistent five-stage header, canonical Follow-through route, section navigation, sticky anchor clearance, recap approval/save/Finish continuity and mobile layout; no send calls');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
