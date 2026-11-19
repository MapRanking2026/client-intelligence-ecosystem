/* eslint-disable @typescript-eslint/no-require-imports -- A browser check: synthetic items, no API writes. */
/**
 * The ticket list is a working copy, and it is not the only writer.
 *
 * Saving the notes re-derives the tickets and stores them, so the page re-renders with a
 * different `items` while this list is on screen. A working copy initialised once from that prop
 * would keep showing the old list, and the next "Save tickets" would write it back over the
 * rebuilt one -- resurrecting whatever the rebuild dropped, including the redundant
 * recap-email ticket the task policy exists to suppress.
 *
 * Three behaviours, all of them from the real component with the prop swapped underneath it the
 * way a server re-render swaps it:
 *
 *   1. nothing unsaved  -> the rebuilt list is adopted, silently;
 *   2. something unsaved -> neither version is discarded, and the AM is told;
 *   3. and they can take the rebuilt list from that notice.
 *
 * Run with: npm run check:follow-through-items-sync
 */
const assert = require("node:assert/strict");
const http = require("node:http");
const { build } = require("esbuild");
const { chromium } = require("playwright");

const RECAP = "Send post-call recap email";
const KEPT = "Fix the recap email template";
const ADDED = "Review location visibility";

const ticket = (id, taskName) => ({
  id, formType: "ticket", taskName, description: "Synthetic", department: "SEO",
  assignee: "Synthetic owner", priority: "normal", timeEstimateMinutes: 30,
});

// What storage held when the page rendered, and what the rebuild leaves behind: the recap ticket
// is gone, a new action has one, and the ticket that only sounds like the recap survives.
const before = [ticket("t-recap", RECAP), ticket("t-kept", KEPT)];
const after = [ticket("t-kept", KEPT), ticket("t-added", ADDED)];

const entry = `
  import React, { useState } from "react";
  import { createRoot } from "react-dom/client";
  import { FollowThroughItems } from "./src/components/mtos/follow-through-items";
  function Harness() {
    const [items, setItems] = useState(${JSON.stringify(before)});
    return (
      <>
        <button type="button" onClick={() => setItems(${JSON.stringify(after)})}>Simulate rebuild</button>
        <FollowThroughItems touchId="synthetic" items={items} tags={[]} members={["Synthetic owner"]} owners={{}} />
      </>
    );
  }
  createRoot(document.getElementById("root")).render(<Harness />);
`;

const row = (page, name) => page.getByRole("button", { name: new RegExp(name) });
const notice = (page) => page.getByText("The tickets were rebuilt from the saved notes", { exact: true });

async function main() {
  const bundle = await build({
    stdin: { contents: entry, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true,
    write: false,
    jsx: "automatic",
    plugins: [{
      name: "mock-router",
      setup(builder) {
        builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "mock" }));
        builder.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ contents: "export const useRouter = () => ({ refresh() {} });" }));
      },
    }],
  });

  const server = http.createServer((request, response) => {
    const js = request.url === "/bundle.js";
    response.setHeader("content-type", js ? "application/javascript" : "text/html");
    response.end(js ? bundle.outputFiles[0].text : '<!doctype html><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Nothing here saves, but an unmocked write would be a silent network error rather than a failure.
    await page.route("**/api/monthly-touches/synthetic", (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { items: after } }) }));
    const url = `http://127.0.0.1:${server.address().port}`;

    await page.goto(url);
    await row(page, RECAP).waitFor();

    // 1. Nothing unsaved: the rebuilt list is adopted without asking.
    await page.getByRole("button", { name: "Simulate rebuild", exact: true }).click();
    await row(page, ADDED).waitFor();
    assert.equal(await row(page, RECAP).count(), 0, "the dropped recap ticket should be gone");
    assert.equal(await row(page, KEPT).count(), 1, "the ticket that only sounds like the recap should stay");
    assert.equal(await notice(page).count(), 0, "an untouched list needs no notice");

    // 2. Something unsaved: a decision on the first row, then the same rebuild.
    await page.reload();
    await row(page, RECAP).waitFor();
    await page.getByRole("group", { name: "Decision" }).first().getByRole("button", { name: "Approve", exact: true }).click();
    await page.getByRole("button", { name: "Simulate rebuild", exact: true }).click();
    await notice(page).waitFor();
    assert.equal(await row(page, RECAP).count(), 1, "the AM's own list should be left standing");
    assert.equal(await row(page, ADDED).count(), 0, "and the rebuilt one should not have replaced it");

    // 3. The notice is a choice, and taking the rebuilt list works from it.
    await page.getByRole("button", { name: "Take the rebuilt list", exact: true }).click();
    await row(page, ADDED).waitFor();
    assert.equal(await row(page, RECAP).count(), 0, "taking the rebuilt list should drop the recap ticket");
    assert.equal(await notice(page).count(), 0, "and clear the notice");

    assert.deepEqual(errors, []);
    console.log("PASS an untouched list adopts a rebuild; an edited one is kept and the AM is asked; the notice can take the rebuilt list; no browser errors");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
