/* eslint-disable @typescript-eslint/no-require-imports -- Browser and export fixtures only, no client records modified. */
require('tsx/cjs');
const { build } = require('esbuild'), { chromium } = require('playwright');
const { compile } = require('@tailwindcss/node'), { Scanner } = require('@tailwindcss/oxide');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const JSZip = require('jszip');
const { buildPptx } = require('../src/lib/server/services/pptx-builder.ts');
const { normalizeSlide } = require('../src/lib/contracts/presentation-edit.ts');
(async () => {
  let deck = { status: 'generated', clientName: 'Synthetic Client', preparedBy: 'Verified Manager', generatedAt: 'synthetic-version', slides: [{ layout: 'cover', title: 'Synthetic cover', subtitle: 'Verified evidence fixture' }, { layout: 'bullets', title: 'Synthetic results', bullets: ['Verified result one', 'Verified result two'] }] };
  const source = `import React from 'react';import{createRoot}from'react-dom/client';import{PresentationViewer}from'./src/components/mtos/presentation-viewer';createRoot(document.getElementById('root')).render(<PresentationViewer touchId="synthetic" toolsOnly presentation={window.fixture}/>);`;
  const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, jsx: 'automatic', outdir: '.next/studio-test' });
  const compiler = await compile(fs.readFileSync('src/app/globals.css', 'utf8'), { base: path.resolve('src/app'), onDependency() {} });
  const css = compiler.build(new Scanner({ sources: [{ base: path.resolve('src'), pattern: '**/*.{ts,tsx}', negated: false }] }).scan()) + bundle.outputFiles.find(f => f.path.endsWith('.css')).text;
  let saves = 0;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/api/monthly-touches/synthetic') {
      let body = ''; for await (const chunk of req) body += chunk;
      const input = JSON.parse(body); assert.equal(input.action, 'save_presentation_slides'); saves++;
      deck = { ...deck, slides: input.slides.map(normalizeSlide) };
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ slides: deck.slides })); return;
    }
    res.setHeader('content-type', req.url === '/bundle.js' ? 'application/javascript' : req.url === '/styles.css' ? 'text/css' : 'text/html');
    res.end(req.url === '/bundle.js' ? bundle.outputFiles.find(f => f.path.endsWith('.js')).text : req.url === '/styles.css' ? css : `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>body{padding:24px}#root{max-width:1100px;margin:auto}</style><div id="root"></div><script>window.fixture=${JSON.stringify(deck).replace(/</g, '\\u003c')}</script><script src="/bundle.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } }); const errors = [], dialogs = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.accept(); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('button', { name: 'Edit slides', exact: true }).click();
    let modal = page.getByRole('dialog', { name: 'Edit presentation slides' }); await modal.waitFor();
    assert.ok(await modal.evaluate(el => { const box = el.getBoundingClientRect(); return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight; }));
    await modal.getByText('Advanced slide design', { exact: true }).click();
    await modal.getByLabel('Title size', { exact: true }).fill('60');
    await modal.getByLabel('Font', { exact: true }).selectOption('Georgia');
    await modal.getByLabel('Alignment', { exact: true }).selectOption('center');
    await modal.getByLabel('Text scale', { exact: true }).selectOption('1.15');
    await modal.getByLabel('Background', { exact: true }).fill('#f0f5fa');
    await modal.getByLabel('Accent color', { exact: true }).fill('#0d9488');
    const title = modal.locator('.presentation-edit-preview h1');
    assert.equal(await title.evaluate(el => getComputedStyle(el).fontSize), '60px');
    assert.equal(await title.evaluate(el => getComputedStyle(el).textAlign), 'center');
    assert.match(await title.evaluate(el => getComputedStyle(el).fontFamily), /Georgia/);
    await modal.getByRole('button', { name: 'Undo', exact: true }).click();
    await modal.getByRole('button', { name: 'Redo', exact: true }).click();
    await page.screenshot({ path: '.next/presentation-studio-desktop.png' });
    await modal.getByRole('button', { name: 'Save slides', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('dialog[open]'));
    assert.equal(saves, 1); assert.deepEqual(dialogs, [], 'successful save should not warn about unsaved changes');
    assert.equal(deck.slides[0].design.accentColor, '#0d9488');
    await page.getByRole('button', { name: 'Edit slides', exact: true }).click();
    modal = page.getByRole('dialog', { name: 'Edit presentation slides' });
    await modal.getByRole('button', { name: 'Next slide', exact: true }).click();
    await modal.getByLabel('Title', { exact: true }).fill('Edited second slide');
    await modal.getByRole('button', { name: 'Undo', exact: true }).click();
    assert.equal(await modal.getByLabel('Title', { exact: true }).inputValue(), 'Synthetic results');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await modal.evaluate(el => el.getBoundingClientRect().width <= innerWidth));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: '.next/presentation-studio-mobile.png' });
    const bytes = await buildPptx(deck, null), zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('ppt/slides/slide1.xml').async('string');
    assert.match(xml, /typeface="Georgia"/); assert.match(xml, /val="0d9488"/); assert.match(xml, /val="f0f5fa"/); assert.match(xml, /algn="ctr"/);
    assert.deepEqual(errors, []);
    console.log('PASS viewport-fitted studio at desktop/mobile sizes, live advanced formatting, per-slide editing, undo/redo, save/reload without false warnings, and design retained in actual PowerPoint XML');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
