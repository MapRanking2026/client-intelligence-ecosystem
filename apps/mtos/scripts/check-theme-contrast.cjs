/* eslint-disable @typescript-eslint/no-require-imports -- A node script over the stylesheet and the source tree; nothing is rendered and nothing is written. */
/**
 * Every colour the app writes text in has to flip with the theme.
 *
 * Large parts of MTOS were written while it was dark-only, and they still say `text-slate-200`,
 * `text-emerald-100`, `bg-slate-900`. Those are fixed colours out of Tailwind's palette, chosen
 * to sit on a near-black page. The app is light by default now, so each one rendered near-white
 * text on a near-white card: the Missed calls tile on the call report, and a long tail of others,
 * were literally the same colour as the surface behind them.
 *
 * `globals.css` rebinds those palette entries to the app's own tokens, which are defined twice --
 * once for light, once for dark. This check is what keeps that binding complete: it reads every
 * Tailwind colour class the source actually uses and fails on any text colour the stylesheet has
 * not bound. A new `text-indigo-100` in a component is then caught here rather than by somebody
 * squinting at a card.
 *
 * Run with: npm run check:theme-contrast
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const css = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");

let passed = 0;
let failed = 0;
function check(label, condition) {
  if (condition) passed += 1;
  else {
    failed += 1;
    console.error(`FAILED: ${label}`);
  }
}

// --- the tokens exist in both themes ---------------------------------------

const lightBlock = css.slice(css.indexOf(":root {"), css.indexOf(':root[data-theme="dark"]'));
const darkBlock = css.slice(css.indexOf(':root[data-theme="dark"]'), css.indexOf("@theme inline"));

for (const token of ["--good-ink", "--watch-ink", "--risk-ink", "--info-ink", "--violet-ink"]) {
  check(`${token} is defined for the light theme`, lightBlock.includes(`${token}:`));
  check(`${token} is defined for the dark theme`, darkBlock.includes(`${token}:`));
}

// A status colour that reads the same in both themes is one of the two that is wrong.
for (const token of ["--good-ink", "--risk-ink", "--watch-ink", "--info-ink", "--violet-ink", "--text", "--surface"]) {
  const value = (block) => (block.match(new RegExp(`${token}:\\s*([^;]+)`)) || [])[1];
  check(`${token} is a different colour in each theme`, value(lightBlock) !== value(darkBlock));
}

// --- every text colour the source uses is bound ----------------------------

/** Every .ts/.tsx file under src, which is where the class names live. */
function sources(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const FAMILIES =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const used = new Map();
for (const file of sources(path.join(root, "src"))) {
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(new RegExp(`\\btext-(${FAMILIES})-(\\d{2,3})\\b`, "g"))) {
    const name = `${match[1]}-${match[2]}`;
    if (!used.has(name)) used.set(name, file.slice(root.length + 1).replace(/\\/g, "/"));
  }
}

check("the source does use Tailwind palette text classes", used.size > 0);

const unbound = [...used].filter(([name]) => !css.includes(`--color-${name}:`));
for (const [name, where] of unbound) {
  console.error(`FAILED: text-${name} is not bound to a theme token (first seen in ${where})`);
}
check(`every palette text colour in use is bound (${used.size} in use)`, unbound.length === 0);

// --- the white and black veils ---------------------------------------------

// These carry their alpha inside the colour, so `@theme` cannot reach them; they are rebound by
// name instead. Missing one leaves a panel with no edge on a light page.
for (const selector of [".bg-white\\/4", ".border-white\\/8", ".bg-black\\/20", ".text-white:not"]) {
  check(`${selector} is rebound for the light theme`, css.includes(selector));
}

// The three pages that are dark whichever theme is on opt out, and must still say so.
check("the always-dark pages have an opt-out", css.includes(".on-dark .text-white"));
for (const page of ["src/app/sign-in/page.tsx", "src/app/sign-up/page.tsx", "src/app/privacy-policy/page.tsx"]) {
  check(`${page} uses it`, fs.readFileSync(path.join(root, page), "utf8").includes('"on-dark '));
}

// --- the one the user actually reported ------------------------------------

const summary = fs.readFileSync(path.join(root, "src/components/mtos/lead-verification-summary.tsx"), "utf8");
assert.ok(summary.includes("Missed calls"), "the tile this was reported on should still exist");
const tones = [...summary.matchAll(new RegExp(`text-(${FAMILIES})-(\\d{2,3})`, "g"))].map((m) => `${m[1]}-${m[2]}`);
check(
  "the Missed calls tile's text colour is bound",
  tones.length > 0 && tones.every((tone) => css.includes(`--color-${tone}:`)),
);

// --- the binding as Tailwind actually compiles it --------------------------

/**
 * Everything above reads the stylesheet as text. This compiles it.
 *
 * A token can be declared, referenced and still not reach the utility: `@theme` without `inline`
 * emits a copy of the value rather than the var, which would freeze every one of these colours at
 * whatever the light theme said and break the dark toggle silently. The only way to know what
 * `.text-slate-200` ended up meaning is to ask Tailwind.
 */
async function compiled() {
  const { compile } = require("@tailwindcss/node");
  const compiler = await compile(css, { base: path.join(root, "src/app"), onDependency() {} });
  const names = [
    "text-slate-200",
    "text-slate-400",
    "text-emerald-100",
    "text-sky-100",
    "text-amber-200",
    "text-rose-100",
    "bg-slate-900",
  ];
  const out = compiler.build(names);
  for (const name of names) {
    const at = out.indexOf(`.${name} {`);
    const rule = at < 0 ? "" : out.slice(at, out.indexOf("}", at) + 1);
    check(`.${name} compiles to a theme variable`, /var\(--[a-z0-9-]+\)/.test(rule));
    check(`.${name} is not frozen to one theme's colour`, at >= 0 && !/#[0-9a-f]{3,8}|oklch\(/i.test(rule));
  }
}

compiled()
  .catch((error) => {
    failed += 1;
    console.error(`FAILED: the stylesheet does not compile — ${error.message}`);
  })
  .finally(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    console.log("Not covered by these checks:");
    console.log("  - measured contrast ratios; these pin that a colour is theme-bound, not that it passes AA");
    console.log("  - arbitrary values (text-[#0d1625]), which are deliberate one-offs");
    console.log("  - background and border colours other than the white/black veils");
    if (failed) process.exitCode = 1;
  });
